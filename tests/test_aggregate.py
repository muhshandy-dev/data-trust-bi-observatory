from __future__ import annotations

from pathlib import Path

import pytest

from data_trust.aggregate import aggregate_month

from .conftest import MONTH


@pytest.fixture
def agg(trip_file: Path) -> dict:
    return aggregate_month(trip_file, MONTH)


def test_raw_scope_excludes_out_of_month_rows(agg: dict):
    # 15 rows total; only the December pickup is out of scope.
    assert agg["metrics"]["raw"]["trips"] == 14
    assert agg["metrics"]["trusted"]["trips"] == 3


def test_trusted_is_a_subset_of_raw(agg: dict):
    raw, trusted = agg["metrics"]["raw"], agg["metrics"]["trusted"]
    assert trusted["trips"] <= raw["trips"]


def test_trusted_averages_match_clean_rows(agg: dict):
    t = agg["metrics"]["trusted"]
    assert t["avg_fare"] == pytest.approx(15.0)
    assert t["avg_distance_mi"] == pytest.approx(3.0)
    assert t["avg_duration_min"] == pytest.approx(20.0)
    assert t["avg_tip_rate"] == pytest.approx(3.0 / 15.0)
    assert t["revenue"] == pytest.approx(3 * 23.0)


def test_raw_average_distance_is_polluted_by_bad_rows(agg: dict):
    assert agg["metrics"]["raw"]["avg_distance_mi"] != pytest.approx(3.0)


def test_daily_series(agg: dict):
    days = {d["date"]: d for d in agg["daily"]}
    assert days["2024-01-05"]["trips_trusted"] == 2  # clean row + its duplicate
    assert days["2024-01-06"]["trips_trusted"] == 1
    assert days["2024-01-05"]["trips_raw"] > days["2024-01-05"]["trips_trusted"]
    assert "2023-12-31" not in days
    assert [d["date"] for d in agg["daily"]] == sorted(days)


def test_hourly_cells_cover_trusted_trips(agg: dict):
    assert sum(c["trips_trusted"] for c in agg["hourly"]) == 3
    cells = {(c["iso_dow"], c["hour"]) for c in agg["hourly"]}
    # 2024-01-05 is a Friday (iso 5) at 10:00; 2024-01-06 a Saturday (iso 6) at 23:00
    assert cells == {(5, 10), (6, 23)}


def test_zones_and_payments(agg: dict):
    assert {z["zone_id"]: z["trips_trusted"] for z in agg["zones"]} == {100: 2, 7: 1}
    assert agg["payments"] == [{"payment_type": 1, "trips_trusted": 3}]
