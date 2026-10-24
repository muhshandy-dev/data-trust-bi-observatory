"""Synthetic Parquet fixtures. These are hand-built rows with known defects for unit tests;
they are NOT TLC data and no test result here says anything about the real dataset."""

from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

MONTH = "2024-01"


def make_trip(**overrides) -> dict:
    """A clean 20-minute, 3-mile card trip on 2024-01-05, total reconciles to its components."""
    pickup = overrides.pop("pickup", datetime(2024, 1, 5, 10, 0))
    minutes = overrides.pop("minutes", 20)
    row = {
        "VendorID": 1,
        "tpep_pickup_datetime": pickup,
        "tpep_dropoff_datetime": pickup + timedelta(minutes=minutes),
        "passenger_count": 1.0,
        "trip_distance": 3.0,
        "RatecodeID": 1.0,
        "store_and_fwd_flag": "N",
        "PULocationID": 100,
        "DOLocationID": 200,
        "payment_type": 1,
        "fare_amount": 15.0,
        "extra": 1.0,
        "mta_tax": 0.5,
        "tip_amount": 3.0,
        "tolls_amount": 0.0,
        "improvement_surcharge": 1.0,
        "total_amount": 23.0,  # 15 + 1 + 0.5 + 3 + 0 + 1 + 2.5 + 0
        "congestion_surcharge": 2.5,
        "Airport_fee": 0.0,
    }
    row.update(overrides)
    return row


# (label, row) -> exactly which rules each defective row should trip.
DEFECTS: dict[str, tuple[dict, set[str]]] = {
    "dropoff_before_pickup": (make_trip(minutes=-10), {"R02"}),
    "pickup_in_december": (make_trip(pickup=datetime(2023, 12, 31, 23, 50)), {"R03"}),
    "zero_distance": (make_trip(trip_distance=0.0), {"R05"}),
    "distance_150mi_in_20min": (make_trip(trip_distance=150.0), {"R06", "R07"}),
    "negative_fare": (
        make_trip(fare_amount=-5.0, total_amount=-5.0 + 1 + 0.5 + 3 + 1 + 2.5, tip_amount=3.0),
        {"R08"},
    ),
    "zero_passengers": (make_trip(passenger_count=0.0), {"R10"}),
    "null_passengers": (make_trip(passenger_count=None), {"R10"}),
    "unknown_pickup_zone": (make_trip(PULocationID=264), {"R11"}),
    "total_mismatch": (make_trip(total_amount=99.0), {"R12"}),
    "speed_120mph": (make_trip(trip_distance=20.0, minutes=10), {"R07"}),
    "duration_30h": (make_trip(minutes=30 * 60, trip_distance=5.0), {"R04"}),
    "zero_total": (
        make_trip(
            total_amount=0.0,
            fare_amount=0.0,
            extra=0.0,
            mta_tax=0.0,
            tip_amount=0.0,
            improvement_surcharge=0.0,
            congestion_surcharge=0.0,
        ),
        {"R09"},
    ),
}


def write_trips(path: Path, rows: list[dict]) -> Path:
    columns = {key: [r.get(key) for r in rows] for key in rows[0]}
    schema = pa.schema(
        [
            ("VendorID", pa.int32()),
            ("tpep_pickup_datetime", pa.timestamp("us")),
            ("tpep_dropoff_datetime", pa.timestamp("us")),
            ("passenger_count", pa.float64()),
            ("trip_distance", pa.float64()),
            ("RatecodeID", pa.float64()),
            ("store_and_fwd_flag", pa.string()),
            ("PULocationID", pa.int32()),
            ("DOLocationID", pa.int32()),
            ("payment_type", pa.int64()),
            ("fare_amount", pa.float64()),
            ("extra", pa.float64()),
            ("mta_tax", pa.float64()),
            ("tip_amount", pa.float64()),
            ("tolls_amount", pa.float64()),
            ("improvement_surcharge", pa.float64()),
            ("total_amount", pa.float64()),
            ("congestion_surcharge", pa.float64()),
            ("Airport_fee", pa.float64()),
        ]
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(pa.table(columns, schema=schema), path)
    return path


@pytest.fixture
def clean_row() -> dict:
    return make_trip()


@pytest.fixture
def fixture_rows() -> list[dict]:
    """2 clean trips on different days + one exact duplicate + one row per defect."""
    clean_a = make_trip()
    clean_b = make_trip(pickup=datetime(2024, 1, 6, 23, 30), PULocationID=7)
    rows = [clean_a, clean_b, dict(clean_a)]  # third row is an exact duplicate of the first
    rows += [row for row, _ in DEFECTS.values()]
    return rows


@pytest.fixture
def trip_file(tmp_path: Path, fixture_rows: list[dict]) -> Path:
    return write_trips(tmp_path / f"yellow_tripdata_{MONTH}.parquet", fixture_rows)
