"""Command line entry point: ``data-trust ingest|validate|build|run``."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .aggregate import aggregate_month
from .config import TLC_BASE_URL, TRIP_PATH_TEMPLATE, ZONE_PATH, Paths, parse_month
from .export import export_site_data, load_zone_names
from .ingest import IngestError, fetch_month, fetch_zone_lookup, load_manifest
from .validate import SchemaError, trust_report


def _months(value: str) -> str:
    try:
        return parse_month(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(str(exc)) from exc


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="data-trust", description=__doc__)
    p.add_argument("--root", type=Path, default=Path.cwd(), help="project root (default: cwd)")
    sub = p.add_subparsers(dest="command", required=True)
    for name, help_ in (
        ("ingest", "download TLC Yellow Taxi files and the zone lookup"),
        ("validate", "print the data-trust report for downloaded months"),
        ("build", "compute aggregates and write JSON for the web app"),
        ("run", "ingest, then build"),
    ):
        sp = sub.add_parser(name, help=help_)
        sp.add_argument("--months", nargs="+", type=_months, required=True, metavar="YYYY-MM")
        if name in ("ingest", "run"):
            sp.add_argument("--force", action="store_true", help="re-download even if present")
            sp.add_argument(
                "--base-url", default=TLC_BASE_URL, help="mirror of the TLC CloudFront host"
            )
    return p


def cmd_ingest(args, paths: Paths) -> int:
    base = args.base_url.rstrip("/")
    for month in args.months:
        entry = fetch_month(month, paths, url_template=base + TRIP_PATH_TEMPLATE, force=args.force)
        sha = entry["sha256"][:12]
        print(f"{month}: {entry['rows']:,} rows, {entry['bytes']:,} bytes, sha256 {sha}")
    fetch_zone_lookup(paths, url=base + ZONE_PATH, force=args.force)
    return 0


def cmd_validate(args, paths: Paths) -> int:
    for month in args.months:
        rep = trust_report(paths.trip_file(month), month)
        print(
            f"{month}: {rep['rows']:,} rows, trusted {rep['trusted_rate']:.2%}, "
            f"clean {rep['clean_rate']:.2%}, duplicates {rep['duplicate_rows']:,}"
        )
        for r in rep["rules"]:
            flag = "warn" if r["severity"] == "warning" else "err "
            print(f"  {r['id']} {flag} {r['name']:<24} {r['violations']:>10,}  {r['rate']:.3%}")
    return 0


def cmd_build(args, paths: Paths) -> int:
    reports = [trust_report(paths.trip_file(m), m) for m in args.months]
    aggregates = [aggregate_month(paths.trip_file(m), m) for m in args.months]
    sizes = export_site_data(
        paths.public_data,
        reports,
        aggregates,
        load_manifest(paths.manifest),
        load_zone_names(paths.zone_file),
    )
    print(json.dumps(sizes, indent=2))
    return 0


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    paths = Paths(args.root.resolve())
    try:
        if args.command == "ingest":
            return cmd_ingest(args, paths)
        if args.command == "validate":
            return cmd_validate(args, paths)
        if args.command == "build":
            return cmd_build(args, paths)
        rc = cmd_ingest(args, paths)
        return rc or cmd_build(args, paths)
    except (IngestError, SchemaError, FileNotFoundError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
