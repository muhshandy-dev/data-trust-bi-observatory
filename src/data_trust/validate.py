"""Row-level data-trust rules evaluated in DuckDB over a TLC Yellow Taxi Parquet file.

``register_trips`` exposes a view ``trips_flagged`` with normalized lower-case columns,
one boolean flag per rule, and ``is_trusted`` (no rule fired). Both the trust report and the
BI aggregates query that single view, so the two can never disagree about what "trusted" means.
"""

from __future__ import annotations

from dataclasses import dataclass
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


class SchemaError(ValueError):
    pass


@dataclass(frozen=True)
class Rule:
    id: str
    name: str
    description: str
    # SQL boolean expression over the columns of ``base`` (see _flagged_sql); NULL counts as pass.
    predicate: str


def build_rules(columns: set[str], month: str) -> list[Rule]:
    start, end = month_bounds(month)
    present = [c for c in AMOUNT_COMPONENTS if c in columns]
    amount_sum = " + ".join(f"coalesce({c}, 0)" for c in present)
    return [
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
        SELECT *, NOT ({any_flag}) AS is_trusted FROM flagged
        """
    )
    return rules, columns


def trust_report(path: Path, month: str) -> dict:
    """Violation counts per rule, duplicate rows, and the trusted share for one month file."""
    con = duckdb.connect()
    try:
        rules, _ = register_trips(con, path, month)
        agg = ", ".join(f"count(*) FILTER (WHERE {r.id.lower()}) AS {r.id.lower()}" for r in rules)
        row = con.execute(
            f"SELECT count(*), {agg}, count(*) FILTER (WHERE is_trusted) FROM trips_flagged"
        ).fetchone()
        total, *rest = row
        counts, trusted = rest[:-1], rest[-1]
        # duplicate rows = rows that are exact copies of an earlier row (all columns equal)
        dup = con.execute(
            "SELECT (SELECT count(*) FROM trips) "
            "- (SELECT count(*) FROM (SELECT DISTINCT * FROM trips))"
        ).fetchone()[0]
    finally:
        con.close()

    def rate(n: int) -> float:
        return round(n / total, 6) if total else 0.0

    return {
        "month": month,
        "rows": total,
        "trusted_rows": trusted,
        "trusted_rate": rate(trusted),
        "duplicate_rows": int(dup),
        "rules": [
            {
                "id": r.id,
                "name": r.name,
                "description": r.description,
                "violations": int(n),
                "rate": rate(n),
            }
            for r, n in zip(rules, counts, strict=True)
        ],
    }
