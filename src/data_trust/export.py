"""Write compact JSON for the web app and enforce the Cloudflare Pages per-file size limit."""

from __future__ import annotations

import csv
import json
from pathlib import Path

from . import __version__
from .config import PAGES_MAX_FILE_BYTES


def load_zone_names(path: Path) -> dict[int, dict]:
    if not path.exists():
        return {}
    with path.open(newline="", encoding="utf-8") as fh:
        return {
            int(r["LocationID"]): {"borough": r["Borough"], "zone": r["Zone"]}
            for r in csv.DictReader(fh)
            if r.get("LocationID", "").isdigit()
        }


def _write_json(path: Path, payload) -> int:
    data = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    if len(data) > PAGES_MAX_FILE_BYTES:
        raise ValueError(
            f"{path.name} is {len(data)} bytes, above the {PAGES_MAX_FILE_BYTES}-byte Pages limit"
        )
    path.write_bytes(data)
    return len(data)


def export_site_data(
    out_dir: Path,
    reports: list[dict],
    aggregates: list[dict],
    source_manifest: dict[str, dict],
    zone_names: dict[int, dict] | None = None,
) -> dict[str, int]:
    """Write one JSON file per dataset; return ``{filename: bytes}``."""
    out_dir.mkdir(parents=True, exist_ok=True)
    zone_names = zone_names or {}
    months = sorted(r["month"] for r in reports)

    zones = []
    for agg in aggregates:
        for z in agg["zones"]:
            info = zone_names.get(z["zone_id"], {})
            zones.append({"month": agg["month"], **z, **info})

    files = {
        "trust_report.json": sorted(reports, key=lambda r: r["month"]),
        "metrics_monthly.json": [
            {"month": a["month"], **a["metrics"]}
            for a in sorted(aggregates, key=lambda a: a["month"])
        ],
        "daily.json": [
            {"month": a["month"], "days": a["daily"]}
            for a in sorted(aggregates, key=lambda a: a["month"])
        ],
        "hourly.json": [
            {"month": a["month"], "cells": a["hourly"]}
            for a in sorted(aggregates, key=lambda a: a["month"])
        ],
        "zones.json": zones,
        "payments.json": [
            {"month": a["month"], "payments": a["payments"]}
            for a in sorted(aggregates, key=lambda a: a["month"])
        ],
        "meta.json": {
            "pipeline_version": __version__,
            "months": months,
            "sources": {
                k: {"url": v["url"], "bytes": v["bytes"], "sha256": v["sha256"], "rows": v["rows"]}
                for k, v in sorted(source_manifest.items())
            },
        },
    }
    return {name: _write_json(out_dir / name, payload) for name, payload in files.items()}
