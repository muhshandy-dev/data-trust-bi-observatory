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
    assert (
        "R02 err  dropoff_before_pickup" in out
        and "trusted 40.00%" in out
        and "clean 20.00%" in out
    )


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


def test_exported_json_has_the_fields_the_frontend_reads(project: Path):
    """web/public/app.js reads exactly these keys; renaming one must fail here, not in a browser."""
    entry = {"url": "u", "bytes": 1, "sha256": "x", "rows": 15}
    manifest = {f"yellow_tripdata_{MONTH}.parquet": entry}
    (project / "data" / "raw" / "manifest.json").write_text(json.dumps(manifest))
    main(["--root", str(project), "build", "--months", MONTH])
    out = project / "web" / "public" / "data"
    load = lambda name: json.loads((out / name).read_text())  # noqa: E731

    meta = load("meta.json")
    assert {"months", "pipeline_version", "sources"} <= meta.keys()
    assert {"url", "bytes", "sha256", "rows"} <= meta["sources"][
        f"yellow_tripdata_{MONTH}.parquet"
    ].keys()

    report = load("trust_report.json")[0]
    assert {
        "month",
        "rows",
        "trusted_rows",
        "trusted_rate",
        "clean_rows",
        "clean_rate",
        "duplicate_rows",
        "rules",
        "breakdowns",
    } <= report.keys()
    assert {"id", "name", "description", "severity", "violations", "rate"} <= report["rules"][
        0
    ].keys()
    assert {"rule", "by", "groups"} <= report["breakdowns"][0].keys()
    assert {"key", "rows", "violations", "rate"} <= report["breakdowns"][0]["groups"][0].keys()

    metrics = load("metrics_monthly.json")[0]
    assert {"month", "raw", "trusted"} <= metrics.keys()
    keys = {"trips", "revenue", "avg_fare", "avg_distance_mi", "avg_duration_min", "avg_tip_rate"}
    assert keys <= metrics["raw"].keys() and keys <= metrics["trusted"].keys()

    day = load("daily.json")[0]["days"][0]
    assert {"date", "trips_raw", "trips_trusted", "revenue_trusted"} <= day.keys()

    hourly = load("hourly.json")[0]["cells"][0]
    assert {"iso_dow", "hour", "trips_trusted", "avg_fare"} <= hourly.keys()
    zone = load("zones.json")[0]
    assert {"month", "zone_id", "trips_trusted", "avg_fare", "avg_tip_rate"} <= zone.keys()
