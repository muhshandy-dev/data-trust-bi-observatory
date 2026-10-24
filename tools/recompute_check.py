"""Recompute the published headline numbers straight from the raw TLC Parquet files.

This re-implements the *error* rules in one standalone SQL statement (it does not import
``data_trust``), so a bug in the pipeline's view or aggregation code would show up as a mismatch
against ``web/public/data``. Needs the files from ``data-trust ingest`` in ``data/raw/``.

    python tools/recompute_check.py [--root .]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import duckdb

MONTH_SQL = "date_trunc('month', tpep_pickup_datetime) = DATE '{m}-01'"

QUERY = """
WITH t AS (
    SELECT *, epoch(tpep_dropoff_datetime - tpep_pickup_datetime) / 60.0 AS dur
    FROM read_parquet('{path}')
), f AS (
    SELECT *, (
        tpep_pickup_datetime IS NULL OR tpep_dropoff_datetime IS NULL
        OR tpep_dropoff_datetime < tpep_pickup_datetime
        OR NOT ({in_month})
        OR dur > 1440 OR trip_distance <= 0 OR trip_distance > 100
        OR (dur >= 1 AND trip_distance / (dur / 60.0) > 80)
        OR fare_amount < 0 OR total_amount <= 0
        OR PULocationID IS NULL OR DOLocationID IS NULL
        OR PULocationID NOT BETWEEN 1 AND 263 OR DOLocationID NOT BETWEEN 1 AND 263
    ) AS err
    FROM t
)
SELECT count(*),
       count(*) FILTER (WHERE NOT err),
       count(*) FILTER (WHERE {in_month}),
       count(*) FILTER (WHERE {in_month} AND NOT err),
       sum(total_amount) FILTER (WHERE {in_month}),
       sum(total_amount) FILTER (WHERE {in_month} AND NOT err),
       avg(trip_distance) FILTER (WHERE {in_month}),
       avg(trip_distance) FILTER (WHERE {in_month} AND NOT err)
FROM f
"""


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--root", type=Path, default=Path.cwd())
    root = ap.parse_args().root
    data = root / "web" / "public" / "data"
    load = lambda name: json.loads((data / name).read_text())  # noqa: E731
    meta = load("meta.json")
    reports = {r["month"]: r for r in load("trust_report.json")}
    metrics = {r["month"]: r for r in load("metrics_monthly.json")}
    failures = 0
    con = duckdb.connect()
    for month in meta["months"]:
        path = root / "data" / "raw" / f"yellow_tripdata_{month}.parquet"
        in_month = MONTH_SQL.format(m=month)
        n, trusted, raw_n, trusted_n, raw_rev, tr_rev, raw_d, tr_d = con.execute(
            QUERY.format(path=path.as_posix(), in_month=in_month)
        ).fetchone()
        raw, tr = metrics[month]["raw"], metrics[month]["trusted"]
        checks = {
            "rows": n == reports[month]["rows"],
            "trusted_rows": trusted == reports[month]["trusted_rows"],
            "raw_trips": raw_n == raw["trips"],
            "trusted_trips": trusted_n == tr["trips"],
            "raw_revenue": abs(raw_rev - raw["revenue"]) < 1,
            "trusted_revenue": abs(tr_rev - tr["revenue"]) < 1,
            "raw_avg_distance": abs(raw_d - raw["avg_distance_mi"]) < 1e-3,
            "trusted_avg_distance": abs(tr_d - tr["avg_distance_mi"]) < 1e-3,
        }
        bad = [k for k, ok in checks.items() if not ok]
        failures += len(bad)
        print(f"{month}: {'OK' if not bad else 'MISMATCH ' + ', '.join(bad)}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
