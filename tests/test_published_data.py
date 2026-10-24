"""Checks on the committed aggregates in ``web/public/data`` (the files Cloudflare Pages serves).

These run without the raw TLC files: they verify that the published JSON is internally consistent,
within the Pages size limit, and that the hosting headers keep the strict content policy.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from data_trust.config import PAGES_MAX_FILE_BYTES

PUBLIC = Path(__file__).resolve().parents[1] / "web" / "public"
DATA = PUBLIC / "data"

pytestmark = pytest.mark.skipif(not DATA.exists(), reason="no published data in this checkout")


def load(name: str):
    return json.loads((DATA / name).read_text())


def by_month(rows: list[dict]) -> dict[str, dict]:
    return {r["month"]: r for r in rows}


def test_every_published_file_is_under_the_pages_limit():
    for path in DATA.glob("*.json"):
        assert path.stat().st_size < PAGES_MAX_FILE_BYTES, path.name


def test_months_agree_across_files():
    months = load("meta.json")["months"]
    assert months == sorted(months) and months
    for name in ("trust_report.json", "metrics_monthly.json", "daily.json", "hourly.json"):
        assert sorted(r["month"] for r in load(name)) == months, name
    assert {r["month"] for r in load("zones.json")} == set(months)
    assert set(load("meta.json")["sources"]) == {f"yellow_tripdata_{m}.parquet" for m in months}


def test_trusted_trip_counts_agree_across_breakdowns():
    metrics = by_month(load("metrics_monthly.json"))
    daily = by_month(load("daily.json"))
    hourly = by_month(load("hourly.json"))
    payments = by_month(load("payments.json"))
    zones: dict[str, int] = {}
    for z in load("zones.json"):
        zones[z["month"]] = zones.get(z["month"], 0) + z["trips_trusted"]
    for m, row in metrics.items():
        trusted, raw = row["trusted"]["trips"], row["raw"]["trips"]
        assert trusted <= raw
        assert sum(d["trips_trusted"] for d in daily[m]["days"]) == trusted
        assert sum(d["trips_raw"] for d in daily[m]["days"]) == raw
        assert sum(c["trips_trusted"] for c in hourly[m]["cells"]) == trusted
        assert sum(p["trips_trusted"] for p in payments[m]["payments"]) == trusted
        assert zones[m] == trusted


def test_trust_report_is_self_consistent():
    for r in load("trust_report.json"):
        assert 0 < r["trusted_rows"] <= r["rows"]
        assert r["clean_rows"] <= r["trusted_rows"]
        assert r["trusted_rate"] == pytest.approx(r["trusted_rows"] / r["rows"], abs=1e-6)
        assert r["clean_rate"] == pytest.approx(r["clean_rows"] / r["rows"], abs=1e-6)
        for rule in r["rules"]:
            assert rule["violations"] <= r["rows"]
            assert rule["severity"] in {"error", "warning"}
        # every rejected row fired at least one error rule, so rejections <= sum of error counts
        errors = sum(x["violations"] for x in r["rules"] if x["severity"] == "error")
        assert r["rows"] - r["trusted_rows"] <= errors


def test_manifest_hashes_are_sha256_hex():
    for src in load("meta.json")["sources"].values():
        assert len(src["sha256"]) == 64 and int(src["sha256"], 16) >= 0
        assert src["rows"] > 0 and src["bytes"] > 0


def test_headers_file_keeps_strict_csp_and_nosniff():
    text = (PUBLIC / "_headers").read_text()
    assert "Content-Security-Policy: default-src 'none'" in text
    assert "X-Content-Type-Options: nosniff" in text
    assert "unsafe-inline" not in text and "unsafe-eval" not in text


def test_page_has_no_inline_script_or_style():
    page = (PUBLIC / "index.html").read_text()
    assert "<style" not in page and ' style="' not in page
    assert page.count("<script") == 1 and "src=" in page.split("<script")[1].split(">")[0]
