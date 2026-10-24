from __future__ import annotations

from pathlib import Path

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from data_trust.validate import SchemaError, register_trips, trust_report

from .conftest import DEFECTS, MONTH, make_trip, write_trips


def test_each_defect_row_trips_exactly_its_expected_rules(tmp_path: Path):
    for label, (row, expected) in DEFECTS.items():
        path = write_trips(tmp_path / f"{label}.parquet", [row])
        con = duckdb.connect()
        rules, _ = register_trips(con, path, MONTH)
        fired = {
            r.id
            for r in rules
            if con.execute(f"SELECT {r.id.lower()} FROM trips_flagged").fetchone()[0]
        }
        con.close()
        assert fired == expected, f"{label}: expected {expected}, got {fired}"


def test_clean_row_is_trusted(tmp_path: Path, clean_row: dict):
    path = write_trips(tmp_path / "clean.parquet", [clean_row])
    report = trust_report(path, MONTH)
    assert report["rows"] == 1
    assert report["trusted_rows"] == 1
    assert all(r["violations"] == 0 for r in report["rules"])


def test_report_counts_match_fixture(trip_file: Path, fixture_rows: list[dict]):
    report = trust_report(trip_file, MONTH)
    assert report["rows"] == len(fixture_rows) == 15
    by_id = {r["id"]: r["violations"] for r in report["rules"]}
    expected: dict[str, int] = {}
    for _, rules in DEFECTS.values():
        for rid in rules:
            expected[rid] = expected.get(rid, 0) + 1
    for rid, count in by_id.items():
        assert count == expected.get(rid, 0), rid
    # 12 defective rows are untrusted; the 2 clean rows and the duplicate stay trusted.
    assert report["trusted_rows"] == 3
    assert report["duplicate_rows"] == 1
    assert report["trusted_rate"] == pytest.approx(3 / 15, abs=1e-6)


def test_rates_are_fractions_of_total(trip_file: Path):
    report = trust_report(trip_file, MONTH)
    for r in report["rules"]:
        assert r["rate"] == pytest.approx(r["violations"] / report["rows"], abs=1e-6)


def test_column_names_are_case_insensitive_and_airport_fee_alias(tmp_path: Path):
    # 2025 files rename Airport_fee -> airport_fee and add cbd_congestion_fee.
    row = make_trip()
    row = {k.replace("Airport_fee", "airport_fee"): v for k, v in row.items()}
    row["cbd_congestion_fee"] = 0.75
    row["total_amount"] = 23.75
    table = pa.table({k: [v] for k, v in row.items()})
    path = tmp_path / "y2025.parquet"
    pq.write_table(table, path)
    report = trust_report(path, MONTH)
    assert report["trusted_rows"] == 1  # cbd fee counted toward the total reconciliation


def test_missing_required_column_raises(tmp_path: Path):
    path = tmp_path / "bad.parquet"
    pq.write_table(pa.table({"tpep_pickup_datetime": [None]}), path)
    with pytest.raises(SchemaError, match="missing required columns"):
        trust_report(path, MONTH)


def test_invalid_month_rejected(trip_file: Path):
    with pytest.raises(ValueError):
        trust_report(trip_file, "2024-13")
