"""Paths, source URLs, and month handling."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

TLC_BASE_URL = "https://d37ci6vzurychx.cloudfront.net"
TRIP_PATH_TEMPLATE = "/trip-data/yellow_tripdata_{month}.parquet"
ZONE_PATH = "/misc/taxi_zone_lookup.csv"
TRIP_URL_TEMPLATE = TLC_BASE_URL + TRIP_PATH_TEMPLATE
ZONE_LOOKUP_URL = TLC_BASE_URL + ZONE_PATH

MONTH_RE = re.compile(r"^(\d{4})-(0[1-9]|1[0-2])$")

# Zone IDs 1..263 are real NYC taxi zones; 264 ("Unknown") and 265 ("Outside of NYC")
# are placeholders in the TLC zone lookup and cannot be mapped to a location.
MAX_VALID_ZONE_ID = 263

# Cloudflare Pages rejects any single file above 25 MiB; keep published JSON well below it.
PAGES_MAX_FILE_BYTES = 25 * 1024 * 1024


@dataclass(frozen=True)
class Paths:
    root: Path

    @property
    def raw(self) -> Path:
        return self.root / "data" / "raw"

    @property
    def manifest(self) -> Path:
        return self.raw / "manifest.json"

    @property
    def public_data(self) -> Path:
        return self.root / "web" / "public" / "data"

    def trip_file(self, month: str) -> Path:
        return self.raw / f"yellow_tripdata_{month}.parquet"

    @property
    def zone_file(self) -> Path:
        return self.raw / "taxi_zone_lookup.csv"


def parse_month(value: str) -> str:
    """Return ``value`` if it is a valid ``YYYY-MM`` string, else raise ValueError."""
    if not MONTH_RE.match(value):
        raise ValueError(f"invalid month {value!r}; expected YYYY-MM")
    return value


def month_bounds(month: str) -> tuple[str, str]:
    """Half-open [start, end) timestamp literals for ``month``."""
    year, mon = (int(p) for p in parse_month(month).split("-"))
    ny, nm = (year + 1, 1) if mon == 12 else (year, mon + 1)
    return f"{year:04d}-{mon:02d}-01 00:00:00", f"{ny:04d}-{nm:02d}-01 00:00:00"
