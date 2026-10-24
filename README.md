# Data Trust & BI Observatory

Data-quality audit and *trust-adjusted* BI metrics over the public
[NYC TLC Yellow Taxi trip records](https://www.nyc.gov/site/tlc/about/tlc-trip-record-data.page).
For each month the pipeline answers two questions: **how much of the data can be trusted**, and
**how much do the headline metrics move once untrusted rows are removed?**

> **Status: pipeline v0 + static frontend.** Ingest, validation, aggregation, JSON export, CLI,
> tests, CI and a static dashboard (`web/public`) are implemented. Tests use synthetic fixtures.
> The pipeline has **not** yet been run on the real TLC files, and nothing is deployed. Findings about the real data
> will be added here only after they have been computed.

## How it works

```
TLC Parquet (CloudFront) ──ingest──▶ data/raw/ + manifest.json (size, rows, SHA-256)
                                          │
                       DuckDB view `trips_flagged`: 12 row-level trust rules + is_trusted
                                          │
              ┌───────────────────────────┴──────────────────────────┐
        trust_report (violations per rule,            aggregates: raw vs trusted metrics, daily,
        duplicate rows, trusted rate)                 hour-of-week, pickup zones, payment types
              └───────────────────────────┬──────────────────────────┘
                              web/public/data/*.json  (each file < 25 MiB for Cloudflare Pages)
```

Trust rules (`src/data_trust/validate.py`): missing timestamp, dropoff before pickup, pickup outside the
file's month, duration > 24 h, non-positive distance, distance > 100 mi, speed > 80 mph, negative
fare, non-positive total, invalid passenger count, unknown/placeholder zone (264/265), and
`total_amount` not reconciling with its fee components. Thresholds are constants in that module.
Exact duplicate rows are counted per month but not (yet) excluded from the trusted subset.

Design choices worth knowing:

- **One definition of "trusted".** The report and every aggregate query the same DuckDB view.
- **Ingest is idempotent and tamper-evident.** TLC publishes no checksums, so the manifest pins the
  SHA-256 of what was downloaded; a changed local file raises an error unless `--force` is given.
- **Schema drift is handled.** Column names are matched case-insensitively and fee columns are used
  only if present (`Airport_fee` → `airport_fee`, `cbd_congestion_fee` added in later files).
- **Aggregate scope:** rows with a pickup inside the file's month, so daily series stay readable.

## Usage

```bash
make install                      # venv + dev dependencies
.venv/bin/data-trust run --months 2024-01 2024-02 2024-03   # ingest, then build JSON
.venv/bin/data-trust validate --months 2024-01              # print the trust report
make check                        # ruff + pytest with coverage
```

`ingest` accepts `--base-url` to point at a mirror of the TLC host. Raw files go to `data/raw/`
(git-ignored); published aggregates go to `web/public/data/`.

## Frontend

`web/public` is plain HTML/CSS/ES modules with inline SVG charts (no framework, no build step, so
Cloudflare Pages deploys do not spend build minutes). It reads `web/public/data/*.json`; until the
pipeline has produced them it shows an explicit empty state. Preview locally with
`python -m http.server -d web/public`. Light/dark themes, keyboard-focusable bars, and a table view
for every chart. The JSON fields the page reads are pinned by a contract test.

## Tests

`pytest` runs unit and end-to-end tests against synthetic Parquet fixtures with known defects (one
row per rule) and against a local HTTP server (success, retries with backoff, 404 without retry,
truncated/non-Parquet payloads, checksum mismatch, idempotent re-run). The fixtures are not TLC
data, so passing tests demonstrate that the code does what it claims, not what the real data
contains. CI (`.github/workflows/ci.yml`) runs ruff and pytest on Python 3.11 and 3.13.

## Hosting constraints that shape the design

Cloudflare Pages: 25 MiB per file and a shared 500 builds/month across the portfolio, so the web
app consumes small pre-aggregated JSON and CI avoids needless deploy builds. GitHub Actions
schedules are disabled after 60 days without repository activity.

## Roadmap

1. ~~Pipeline v0 + tests + CI~~ (this repo state)
2. Run on real TLC months; record real findings and the exact months/checksums used
3. ~~Web UI~~ (static site in `web/public`, no build step; shows an empty state until data exists); deploy to Cloudflare Pages
4. Extract the repo scaffolding (CI, Makefile, size guard) as a template for the other projects

## License

MIT. TLC data is public; see the TLC site for its terms and data dictionary.
