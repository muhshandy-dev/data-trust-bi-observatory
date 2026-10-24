from __future__ import annotations

import json
from pathlib import Path

import pytest

from data_trust import export
from data_trust.cli import main

from .conftest import MONTH, make_trip, write_trips
from .test_ingest import _Server


@pytest.fixture
def project(tmp_path: Path, fixture_rows: list[dict]) -> Path:
    write_trips(tmp_path / "data" / "raw" / f"yellow_tripdata_{MONTH}.parquet", fixture_rows)
    (tmp_path / "data" / "raw" / "taxi_zone_lookup.csv").write_text(
        '"LocationID","Borough","Zone","service_zone"\n'
        '100,"Manhattan","Garment District","Yellow Zone"\n'
        '7,"Queens","Astoria","Boro Zone"\n'
    )
    return tmp_path


def test_build_writes_all_site_files(project: Path, capsys):
    assert main(["--root", str(project), "build", "--months", MONTH]) == 0
    out = project / "web" / "public" / "data"
    names = {p.name for p in out.glob("*.json")}
    assert names == {
        "trust_report.json",
        "metrics_monthly.json",
        "daily.json",
        "hourly.json",
        "zones.json",
        "payments.json",
        "meta.json",
    }
    report = json.loads((out / "trust_report.json").read_text())
    assert report[0]["month"] == MONTH and report[0]["rows"] == 15
    zones = json.loads((out / "zones.json").read_text())
    assert {z["zone"] for z in zones} == {"Garment District", "Astoria"}
    assert all(p.stat().st_size < export.PAGES_MAX_FILE_BYTES for p in out.glob("*.json"))


def test_build_is_deterministic(project: Path):
    out = project / "web" / "public" / "data"
    main(["--root", str(project), "build", "--months", MONTH])
    first = {p.name: p.read_bytes() for p in out.glob("*.json")}
    main(["--root", str(project), "build", "--months", MONTH])
    assert first == {p.name: p.read_bytes() for p in out.glob("*.json")}


def test_validate_prints_report(project: Path, capsys):
    assert main(["--root", str(project), "validate", "--months", MONTH]) == 0
    out = capsys.readouterr().out
    assert "R02 dropoff_before_pickup" in out and "trusted 20.00%" in out


def test_missing_file_is_a_clean_error(tmp_path: Path, capsys):
    assert main(["--root", str(tmp_path), "validate", "--months", MONTH]) == 1
    assert "error:" in capsys.readouterr().err


def test_invalid_month_is_rejected_by_argparse(tmp_path: Path):
    with pytest.raises(SystemExit) as exc:
        main(["--root", str(tmp_path), "build", "--months", "2024-1"])
    assert exc.value.code == 2


def test_export_enforces_pages_size_limit(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(export, "PAGES_MAX_FILE_BYTES", 10)
    with pytest.raises(ValueError, match="Pages limit"):
        export.export_site_data(tmp_path, [{"month": MONTH, "rows": 1}], [], {})


def test_zone_names_missing_file_is_empty(tmp_path: Path):
    assert export.load_zone_names(tmp_path / "nope.csv") == {}


def test_make_trip_total_reconciles():
    r = make_trip()
    parts = [
        "fare_amount",
        "extra",
        "mta_tax",
        "tip_amount",
        "tolls_amount",
        "improvement_surcharge",
        "congestion_surcharge",
        "Airport_fee",
    ]
    assert sum(r[p] for p in parts) == pytest.approx(r["total_amount"])


def test_ingest_then_build_end_to_end_against_local_mirror(tmp_path: Path, capsys):
    src = write_trips(tmp_path / "src.parquet", [make_trip(), make_trip(trip_distance=0.0)])
    zones = (
        b'"LocationID","Borough","Zone","service_zone"\n100,"Manhattan","Midtown","Yellow Zone"\n'
    )
    root = tmp_path / "proj"
    with _Server(src.read_bytes(), csv=zones) as srv:
        argv = ["--root", str(root), "run", "--months", MONTH, "--base-url", srv.base]
        assert main(argv) == 0
    out = root / "web" / "public" / "data"
    report = json.loads((out / "trust_report.json").read_text())
    assert (report[0]["rows"], report[0]["trusted_rows"]) == (2, 1)
    meta = json.loads((out / "meta.json").read_text())
    assert meta["sources"][f"yellow_tripdata_{MONTH}.parquet"]["rows"] == 2


def test_ingest_failure_is_a_clean_error(tmp_path: Path, capsys):
    with _Server(b"", fail_first=99, status=404) as srv:
        argv = ["--root", str(tmp_path), "ingest", "--months", MONTH, "--base-url", srv.base]
        assert main(argv) == 1
    assert "error:" in capsys.readouterr().err
