from __future__ import annotations

import http.server
import threading
from pathlib import Path

import pytest

from data_trust.config import Paths
from data_trust.ingest import (
    IngestError,
    download,
    fetch_month,
    load_manifest,
    sha256_file,
    verify_parquet,
)

from .conftest import MONTH, make_trip, write_trips


class _Server:
    """Local HTTP server serving one file; counts hits and can fail the first N requests."""

    def __init__(self, body: bytes, fail_first: int = 0, status: int = 500, csv: bytes = b""):
        self.body, self.fail_first, self.status, self.hits = body, fail_first, status, 0
        self.csv = csv
        outer = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802
                outer.hits += 1
                if outer.hits <= outer.fail_first:
                    self.send_response(outer.status)
                    self.end_headers()
                    return
                body = outer.csv if self.path.endswith(".csv") else outer.body
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.base = f"http://127.0.0.1:{self.httpd.server_port}"
        self.url = self.base + "/yellow_tripdata_{month}.parquet"
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *exc):
        self.httpd.shutdown()
        self.httpd.server_close()


@pytest.fixture
def parquet_bytes(tmp_path: Path) -> bytes:
    return write_trips(tmp_path / "src.parquet", [make_trip()]).read_bytes()


def test_fetch_downloads_and_records_manifest(tmp_path: Path, parquet_bytes: bytes):
    paths = Paths(tmp_path / "proj")
    with _Server(parquet_bytes) as srv:
        entry = fetch_month(MONTH, paths, url_template=srv.url)
    dest = paths.trip_file(MONTH)
    assert dest.read_bytes() == parquet_bytes
    assert entry["rows"] == 1
    assert entry["bytes"] == len(parquet_bytes)
    assert entry["sha256"] == sha256_file(dest)
    assert load_manifest(paths.manifest)[dest.name] == entry
    assert not list(paths.raw.glob("*.part"))


def test_second_fetch_is_idempotent_and_makes_no_request(tmp_path: Path, parquet_bytes: bytes):
    paths = Paths(tmp_path / "proj")
    with _Server(parquet_bytes) as srv:
        fetch_month(MONTH, paths, url_template=srv.url)
        fetch_month(MONTH, paths, url_template=srv.url)
        assert srv.hits == 1


def test_modified_local_file_is_detected(tmp_path: Path, parquet_bytes: bytes):
    paths = Paths(tmp_path / "proj")
    with _Server(parquet_bytes) as srv:
        fetch_month(MONTH, paths, url_template=srv.url)
        paths.trip_file(MONTH).write_bytes(parquet_bytes + b"tampered")
        with pytest.raises(IngestError, match="manifest checksum"):
            fetch_month(MONTH, paths, url_template=srv.url)
        entry = fetch_month(MONTH, paths, url_template=srv.url, force=True)
    assert entry["sha256"] == sha256_file(paths.trip_file(MONTH))


def test_retries_transient_server_errors(tmp_path: Path):
    sleeps: list[float] = []
    with _Server(b"hello", fail_first=2) as srv:
        download(srv.url.format(month=MONTH), tmp_path / "f.bin", sleep=sleeps.append)
        assert srv.hits == 3
    assert (tmp_path / "f.bin").read_bytes() == b"hello"
    assert sleeps == [2.0, 4.0]


def test_client_error_is_not_retried(tmp_path: Path):
    with _Server(b"", fail_first=99, status=404) as srv:
        with pytest.raises(IngestError, match="404"):
            download(srv.url.format(month=MONTH), tmp_path / "f.bin", sleep=lambda s: None)
        assert srv.hits == 1
    assert not (tmp_path / "f.bin").exists()
    assert not list(tmp_path.glob("*.part"))


def test_gives_up_after_retries(tmp_path: Path):
    with _Server(b"", fail_first=99, status=503) as srv:
        with pytest.raises(IngestError):
            download(
                srv.url.format(month=MONTH), tmp_path / "f.bin", retries=2, sleep=lambda s: None
            )
        assert srv.hits == 3


def test_non_parquet_download_is_rejected_and_not_recorded(tmp_path: Path):
    paths = Paths(tmp_path / "proj")
    with (
        _Server(b"<html>not parquet</html>") as srv,
        pytest.raises(IngestError, match="not a readable Parquet"),
    ):
        fetch_month(MONTH, paths, url_template=srv.url)
    assert load_manifest(paths.manifest) == {}


def test_verify_parquet_returns_row_count(tmp_path: Path):
    path = write_trips(tmp_path / "x.parquet", [make_trip(), make_trip()])
    assert verify_parquet(path) == 2
