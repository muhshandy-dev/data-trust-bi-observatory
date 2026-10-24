"""Row-level data-trust rules evaluated in DuckDB over a TLC Yellow Taxi Parquet file.

``register_trips`` exposes a view ``trips_flagged`` with normalized lower-case columns,
one boolean flag per rule, ``is_trusted`` (no error-severity rule fired) and ``is_clean`` (no
rule at all fired, warnings included). Both the trust report and the
BI aggregates query that single view, so the two can never disagree about what "trusted" means.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from pathlib import Path

import duckdb

from .config import MAX_VALID_ZONE_ID, month_bounds, parse_month

REQUIRED_COLUMNS = (
    "tpep_pickup_datetime",
    "tpep_dropoff_datetime",
    "passenger_count",
    "trip_distance",
    "pulocationid",
    "dolocationid",
    "payment_type",
    "fare_amount",
    "total_amount",
)

# Money components that add up to total_amount; only those present in a given file are used
# (TLC added airport_fee / cbd_congestion_fee in later years and renamed Airport_fee in 2025).
AMOUNT_COMPONENTS = (
    "fare_amount",
    "extra",
    "mta_tax",
    "tip_amount",
    "tolls_amount",
    "improvement_surcharge",
    "congestion_surcharge",
    "airport_fee",
    "cbd_congestion_fee",
)

MAX_PASSENGERS = 6
MAX_TRIP_MILES = 100
MAX_SPEED_MPH = 80
MAX_DURATION_MIN = 24 * 60
AMOUNT_TOLERANCE = 0.011
# Breakdown groups smaller than this share of the month's rows are left out of the report.
BREAKDOWN_MIN_SHARE = 0.001


# Rules that are reported but do not exclude a row. On real 2024-2025 files each one fires on a
# large, systematic slice of otherwise valid trips, so excluding them would bias the trusted
# subset instead of cleaning it:
#   R10  passenger_count is NULL for every payment_type 0 (flex fare) trip, a column the vendor
#        simply does not fill; it does not affect revenue, distance or duration metrics.
#   R12  the parts do not reconcile with the total mostly for one vendor (congestion/CBD fee
#        recorded in its column but not in total_amount) and for flex fares (fee in total_amount
#        but NULL in its column). The rule is kept so the problem stays visible, per vendor.
WARNING_RULES = frozenset({"R10", "R12"})


class SchemaError(ValueError):
    pass


@dataclass(frozen=True)
class Rule:
    id: str
    name: str
    description: str
    # SQL boolean expression over the columns of ``base`` (see _flagged_sql); NULL counts as pass.
    predicate: str
    # "error": the row is impossible or unusable, so it is excluded from the trusted subset.
    # "warning": reported, but the row stays trusted (see WARNING_RULES for why).
    severity: str = "error"


def build_rules(columns: set[str], month: str) -> list[Rule]:
    start, end = month_bounds(month)
    present = [c for c in AMOUNT_COMPONENTS if c in columns]
    amount_sum = " + ".join(f"coalesce({c}, 0)" for c in present)
    rules = [
        Rule(
            "R01",
            "missing_timestamp",
            "Pickup or dropoff timestamp is missing",
            "tpep_pickup_datetime IS NULL OR tpep_dropoff_datetime IS NULL",
        ),
        Rule(
            "R02",
            "dropoff_before_pickup",
            "Dropoff happens before pickup",
            "tpep_dropoff_datetime < tpep_pickup_datetime",
        ),
        Rule(
            "R03",
            "pickup_outside_month",
            f"Pickup timestamp falls outside the file's month ({month})",
            f"tpep_pickup_datetime < TIMESTAMP '{start}' "
            f"OR tpep_pickup_datetime >= TIMESTAMP '{end}'",
        ),
        Rule(
            "R04",
            "duration_over_24h",
            "Trip duration exceeds 24 hours",
            f"duration_min > {MAX_DURATION_MIN}",
        ),
        Rule(
            "R05",
            "non_positive_distance",
            "Trip distance is zero or negative",
            "trip_distance <= 0",
        ),
        Rule(
            "R06",
            "distance_over_100mi",
            f"Trip distance exceeds {MAX_TRIP_MILES} miles",
            f"trip_distance > {MAX_TRIP_MILES}",
        ),
        Rule(
            "R07",
            "implausible_speed",
            f"Average speed above {MAX_SPEED_MPH} mph (trips of at least 1 minute)",
            f"duration_min >= 1 AND trip_distance / (duration_min / 60.0) > {MAX_SPEED_MPH}",
        ),
        Rule("R08", "negative_fare", "Fare amount is negative", "fare_amount < 0"),
        Rule("R09", "non_positive_total", "Total amount is zero or negative", "total_amount <= 0"),
        Rule(
            "R10",
            "invalid_passenger_count",
            f"Passenger count is missing or outside 1-{MAX_PASSENGERS}",
            f"passenger_count IS NULL OR passenger_count < 1 OR passenger_count > {MAX_PASSENGERS}",
        ),
        Rule(
            "R11",
            "unknown_zone",
            "Pickup or dropoff zone is missing or a placeholder (264/265)",
            f"pulocationid IS NULL OR dolocationid IS NULL OR pulocationid NOT BETWEEN 1 AND "
            f"{MAX_VALID_ZONE_ID} OR dolocationid NOT BETWEEN 1 AND {MAX_VALID_ZONE_ID}",
        ),
        Rule(
            "R12",
            "total_amount_mismatch",
            "total_amount differs from the sum of its fare components by more than 1 cent",
            f"abs(total_amount - ({amount_sum})) > {AMOUNT_TOLERANCE}",
        ),
    ]
    return [replace(r, severity="warning") if r.id in WARNING_RULES else r for r in rules]


def _normalized_select(con: duckdb.DuckDBPyConnection, path: Path) -> tuple[str, set[str]]:
    if not path.is_file():
        raise FileNotFoundError(f"{path} not found; run `data-trust ingest` first")
    desc = con.execute("DESCRIBE SELECT * FROM read_parquet(?)", [str(path)]).fetchall()
    originals = {name.lower(): name for name, *_ in desc}
    missing = [c for c in REQUIRED_COLUMNS if c not in originals]
    if missing:
        raise SchemaError(f"{path.name} is missing required columns: {', '.join(missing)}")
    select = ", ".join(f'"{orig}" AS {low}' for low, orig in originals.items())
    return f"SELECT {select} FROM read_parquet('{path.as_posix()}')", set(originals)


def register_trips(
    con: duckdb.DuckDBPyConnection, path: Path, month: str
) -> tuple[list[Rule], set[str]]:
    """Create views ``trips`` (normalized) and ``trips_flagged``; return the rules and columns."""
    parse_month(month)
    normalized, columns = _normalized_select(con, path)
    rules = build_rules(columns, month)
    flags = ",\n    ".join(f"coalesce(({r.predicate}), FALSE) AS {r.id.lower()}" for r in rules)
    any_error = " OR ".join(r.id.lower() for r in rules if r.severity == "error")
    any_flag = " OR ".join(r.id.lower() for r in rules)
    con.execute(f"CREATE OR REPLACE VIEW trips AS {normalized}")
    con.execute(
        f"""
        CREATE OR REPLACE VIEW trips_flagged AS
        WITH base AS (
            SELECT *,
                epoch(tpep_dropoff_datetime - tpep_pickup_datetime) / 60.0 AS duration_min
            FROM trips
        ), flagged AS (
            SELECT *,
                {flags}
            FROM base
        )
        SELECT *, NOT ({any_error}) AS is_trusted, NOT ({any_flag}) AS is_clean FROM flagged
        """
    )
    return rules, columns


def _breakdown(con: duckdb.DuckDBPyConnection, rule: Rule, column: str, total: int) -> list[dict]:
    """Violation rate of ``rule`` per value of ``column``, largest groups first."""
    rows = con.execute(
        f"""
        SELECT {column}, count(*), count(*) FILTER (WHERE {rule.id.lower()})
        FROM trips_flagged GROUP BY 1 ORDER BY 2 DESC
        """
    ).fetchall()
    return [
        {"key": k, "rows": int(n), "violations": int(v), "rate": round(v / n, 6) if n else 0.0}
        for k, n, v in rows
        if n and n / total >= BREAKDOWN_MIN_SHARE
    ]


def trust_report(path: Path, month: str) -> dict:
    """Violation counts per rule, duplicate rows, and the trusted share for one month file."""
    con = duckdb.connect()
    try:
        rules, columns = register_trips(con, path, month)
        agg = ", ".join(f"count(*) FILTER (WHERE {r.id.lower()}) AS {r.id.lower()}" for r in rules)
        row = con.execute(
            f"SELECT count(*), {agg}, count(*) FILTER (WHERE is_trusted), "
            "count(*) FILTER (WHERE is_clean) FROM trips_flagged"
        ).fetchone()
        total, *rest = row
        counts, trusted, clean = rest[:-2], rest[-2], rest[-1]
        # duplicate rows = rows that are exact copies of an earlier row (all columns equal)
        dup = con.execute(
            "SELECT (SELECT count(*) FROM trips) "
            "- (SELECT count(*) FROM (SELECT DISTINCT * FROM trips))"
        ).fetchone()[0]
        # Where do the warning-rule violations concentrate? Only groups above a share threshold.
        dims = [("vendor_id", "vendorid"), ("payment_type", "payment_type")]
        breakdowns = [
            {"rule": r.id, "by": label, "groups": _breakdown(con, r, col, total)}
            for r in rules
            if r.severity == "warning"
            for label, col in dims
            if col in columns
        ]
    finally:
        con.close()

    def rate(n: int) -> float:
        return round(n / total, 6) if total else 0.0

    return {
        "month": month,
        "rows": total,
        "trusted_rows": trusted,
        "trusted_rate": rate(trusted),
        "clean_rows": clean,
        "clean_rate": rate(clean),
        "duplicate_rows": int(dup),
        "rules": [
            {
                "id": r.id,
                "name": r.name,
                "description": r.description,
                "severity": r.severity,
                "violations": int(n),
                "rate": rate(n),
            }
            for r, n in zip(rules, counts, strict=True)
        ],
        "breakdowns": breakdowns,
    }
