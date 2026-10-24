"""BI aggregates for one month, computed twice: over all in-month rows ("raw") and over the
trusted subset, so the dashboard can show how much each metric moves when bad rows are removed.

Scope: rows whose pickup timestamp falls inside the file's month. Out-of-month and null-pickup
rows are reported by the trust report (R01, R03) but excluded here so daily series stay readable.
"""

from __future__ import annotations

from pathlib import Path

import duckdb

from .validate import register_trips

IN_MONTH = "NOT r01 AND NOT r03"


def _metrics_sql(where: str) -> str:
    return f"""
        SELECT
            count(*) AS trips,
            coalesce(sum(total_amount), 0) AS revenue,
            avg(fare_amount) AS avg_fare,
            avg(trip_distance) AS avg_distance_mi,
            avg(duration_min) FILTER (WHERE duration_min >= 0) AS avg_duration_min,
            -- tips are only recorded for card payments (payment_type = 1)
            avg(tip_amount / fare_amount) FILTER (WHERE payment_type = 1 AND fare_amount > 0)
                AS avg_tip_rate
        FROM trips_flagged WHERE {where}
    """


def _row_dicts(con: duckdb.DuckDBPyConnection, sql: str) -> list[dict]:
    cur = con.execute(sql)
    names = [d[0] for d in cur.description]
    return [dict(zip(names, row, strict=True)) for row in cur.fetchall()]


def _round(rows: list[dict], digits: int = 4) -> list[dict]:
    return [
        {k: (round(v, digits) if isinstance(v, float) else v) for k, v in row.items()}
        for row in rows
    ]


def aggregate_month(path: Path, month: str) -> dict:
    con = duckdb.connect()
    try:
        register_trips(con, path, month)
        raw = _row_dicts(con, _metrics_sql(IN_MONTH))[0]
        trusted = _row_dicts(con, _metrics_sql(f"{IN_MONTH} AND is_trusted"))[0]
        daily = _row_dicts(
            con,
            f"""
            SELECT strftime(CAST(tpep_pickup_datetime AS DATE), '%Y-%m-%d') AS date,
                   count(*) AS trips_raw,
                   count(*) FILTER (WHERE is_trusted) AS trips_trusted,
                   coalesce(sum(total_amount) FILTER (WHERE is_trusted), 0) AS revenue_trusted
            FROM trips_flagged WHERE {IN_MONTH}
            GROUP BY 1 ORDER BY 1
            """,
        )
        hourly = _row_dicts(
            con,
            f"""
            SELECT isodow(tpep_pickup_datetime) AS iso_dow,
                   hour(tpep_pickup_datetime) AS hour,
                   count(*) AS trips_trusted,
                   avg(fare_amount) AS avg_fare
            FROM trips_flagged WHERE {IN_MONTH} AND is_trusted
            GROUP BY 1, 2 ORDER BY 1, 2
            """,
        )
        zones = _row_dicts(
            con,
            f"""
            SELECT pulocationid AS zone_id,
                   count(*) AS trips_trusted,
                   avg(fare_amount) AS avg_fare,
                   avg(tip_amount / fare_amount) FILTER (WHERE payment_type = 1 AND fare_amount > 0)
                       AS avg_tip_rate
            FROM trips_flagged WHERE {IN_MONTH} AND is_trusted
            GROUP BY 1 ORDER BY 2 DESC
            """,
        )
        payments = _row_dicts(
            con,
            f"""
            SELECT payment_type, count(*) AS trips_trusted
            FROM trips_flagged WHERE {IN_MONTH} AND is_trusted
            GROUP BY 1 ORDER BY 1
            """,
        )
    finally:
        con.close()
    return {
        "month": month,
        "metrics": {"raw": _round([raw])[0], "trusted": _round([trusted])[0]},
        "daily": _round(daily),
        "hourly": _round(hourly),
        "zones": _round(zones),
        "payments": payments,
    }
