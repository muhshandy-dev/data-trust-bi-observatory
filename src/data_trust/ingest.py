"""Download TLC files idempotently and record size + SHA-256 in a manifest.

TLC publishes no checksums, so the manifest pins what *we* downloaded: re-runs verify the
local file against it, and a changed upstream file is surfaced instead of silently reused.
"""

from __future__ import annotations

import hashlib
import json
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from pathlib import Path

import pyarrow.parquet as pq

from .config import TRIP_URL_TEMPLATE, ZONE_LOOKUP_URL, Paths, parse_month

CHUNK = 1024 * 1024
USER_AGENT = "data-trust-bi-observatory/0.1 (+portfolio project)"


class IngestError(RuntimeError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        while chunk := fh.read(CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


def load_manifest(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}
    return json.loads(path.read_text())


def save_manifest(path: Path, manifest: dict[str, dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    tmp.replace(path)


def download(
    url: str,
    dest: Path,
    *,
    retries: int = 4,
    backoff: float = 2.0,
    sleep: Callable[[float], None] = time.sleep,
) -> None:
    """Stream ``url`` to ``dest`` via a ``.part`` file; retry transient failures."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")
    last: Exception | None = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=60) as resp, part.open("wb") as out:
                expected = resp.headers.get("Content-Length")
                written = 0
                while chunk := resp.read(CHUNK):
                    out.write(chunk)
                    written += len(chunk)
            if expected is not None and written != int(expected):
                raise IngestError(f"truncated download: got {written} of {expected} bytes")
            part.replace(dest)
            return
        except urllib.error.HTTPError as exc:
            last = exc
            if 400 <= exc.code < 500 and exc.code != 429:
                break  # client errors will not heal on retry
        except (urllib.error.URLError, TimeoutError, ConnectionError, IngestError) as exc:
            last = exc
        if attempt < retries:
            sleep(backoff * 2**attempt)
    part.unlink(missing_ok=True)
    raise IngestError(f"failed to download {url}: {last}")


def verify_parquet(path: Path) -> int:
    """Return the row count from the Parquet footer; raise if the file is not valid Parquet."""
    try:
        return pq.ParquetFile(path).metadata.num_rows
    except Exception as exc:  # pyarrow raises several types for corrupt files
        raise IngestError(f"{path.name} is not a readable Parquet file: {exc}") from exc


def fetch_month(
    month: str,
    paths: Paths,
    *,
    url_template: str = TRIP_URL_TEMPLATE,
    force: bool = False,
    **download_kwargs,
) -> dict:
    """Ensure the file for ``month`` exists locally and matches the manifest entry."""
    month = parse_month(month)
    dest = paths.trip_file(month)
    manifest = load_manifest(paths.manifest)
    key = dest.name
    entry = manifest.get(key)

    if dest.exists() and entry and not force:
        if sha256_file(dest) == entry["sha256"]:
            return entry
        raise IngestError(
            f"{key} no longer matches the manifest checksum; re-run with --force to re-download"
        )

    download(url_template.format(month=month), dest, **download_kwargs)
    rows = verify_parquet(dest)
    entry = {
        "url": url_template.format(month=month),
        "bytes": dest.stat().st_size,
        "sha256": sha256_file(dest),
        "rows": rows,
    }
    manifest[key] = entry
    save_manifest(paths.manifest, manifest)
    return entry


def fetch_zone_lookup(paths: Paths, *, url: str = ZONE_LOOKUP_URL, force: bool = False) -> Path:
    if force or not paths.zone_file.exists():
        download(url, paths.zone_file)
    return paths.zone_file
