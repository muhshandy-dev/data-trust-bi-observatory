# Data Trust & BI Observatory

Data-quality audit and *trust-adjusted* BI metrics over the public
[NYC TLC Yellow Taxi trip records](https://www.nyc.gov/site/tlc/about/tlc-trip-record-data.page).
For each month the pipeline answers two questions: **how much of the data can be trusted**, and
**how much do the headline metrics move once untrusted rows are removed?**

**Live demo:** https://data-trust-bi-observatory.pages.dev/ (static site on Cloudflare Pages; there is no
server that can go to sleep) · [![CI](https://github.com/muhshandy-dev/data-trust-bi-observatory/actions/workflows/ci.yml/badge.svg)](https://github.com/muhshandy-dev/data-trust-bi-observatory/actions/workflows/ci.yml)

> **Status:** pipeline run on six real Yellow Taxi months (2024-01..03 and 2025-01..03); the aggregates
> are committed in `web/public/data/` and shown by the dashboard. See
> [Findings](#findings-on-real-tlc-data) and [Evaluation and limitations](#evaluation-and-limitations).

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

Trust rules (`src/data_trust/validate.py`) come in two severities. **Error** rules exclude a row from the
trusted subset; **warning** rules (R10, R12) are reported and broken down by vendor and payment type but
keep the row, because on real data they fire on large, systematic slices of otherwise valid trips (see
Findings). The rules: missing timestamp, dropoff before pickup, pickup outside the
file's month, duration > 24 h, non-positive distance, distance > 100 mi, speed > 80 mph, negative
fare, non-positive total, invalid passenger count, unknown/placeholder zone (264/265), and
`total_amount` not reconciling with its fee components. Thresholds are constants in that module.
Exact duplicate rows are counted per month but not (yet) excluded from the trusted subset. Each report gives
`trusted_rate` (no error rule fired) and `clean_rate` (no rule fired at all, warnings included).

Design choices worth knowing:

- **One definition of "trusted".** The report and every aggregate query the same DuckDB view.
- **Ingest is idempotent and tamper-evident.** TLC publishes no checksums, so the manifest pins the
  SHA-256 of what was downloaded; a changed local file raises an error unless `--force` is given.
- **Schema drift is handled.** Column names are matched case-insensitively and fee columns are used
  only if present (`Airport_fee` → `airport_fee`, `cbd_congestion_fee` added in later files).
- **Aggregate scope:** rows with a pickup inside the file's month, so daily series stay readable.

## Findings on real TLC data

Run on the official files from `d37ci6vzurychx.cloudfront.net` (SHA-256 of each file is in
`web/public/data/meta.json`). Scope: Yellow Taxi, six months. These are observations about the files, not
claims about why TLC or the vendors record them this way.

| Month | Rows | Trusted (no error rule) | Clean (no rule at all) |
|---|---:|---:|---:|
| 2024-01 | 2,964,624 | 95.85% | 71.07% |
| 2024-02 | 3,007,526 | 95.62% | 70.17% |
| 2024-03 | 3,582,628 | 95.15% | 65.72% |
| 2025-01 | 3,475,226 | 92.89% | 63.96% |
| 2025-02 | 3,577,543 | 91.91% | 58.19% |
| 2025-03 | 4,145,257 | 92.23% | 59.35% |

- **R12 (total does not reconcile) is a vendor/encoding pattern, not noise.** It fires on 89-93% of
  Vendor 1 rows in every month. In 2024-01 most mismatches (591,045 of 761,838) have `total_amount` exactly
  2.50 below the sum of the fee columns, i.e. the congestion surcharge is recorded in its column but not in
  the total. It also fires on 80-92% of payment type 0 (flex fare) rows, where the fee column is NULL but the
  total appears to include it. Vendor 2 is at 4-21%.
- **R10 (passenger count) is NULL for 100% of payment type 0 (flex fare) rows.** Those rows grew from
  140,162 (2024-01) to 916,663 (2025-03), which is why R10 rises from 5.8% to 22.7% of all rows. Outside flex
  fares the field is invalid on about 1% of card and cash trips.
- **A few absurd distances dominate the raw mean.** 2025-03 has 165 trips over 1,000 miles (max 320,136 mi)
  that account for 13.8M of the 27.3M miles in the file. Raw average distance is 6.58 mi vs 3.28 mi trusted
  (-50%); in 2024-01 it is 3.65 vs 3.23 mi.
- **Error rules reject 4.2-8.1% of rows**, mostly negative fares (1.3% in 2024-01, 5.0% in 2025-03) and
  non-positive distance (2.0-2.8%). Trusted revenue is 2.9-3.5% below raw revenue; average fare is 0.0-6.5%
  higher after removing refunds, zero-distance and negative rows.
- Impossible timestamps and durations are rare (R01-R04 together below 0.01% of rows). Exact duplicate rows:
  0 in five of the six months, 1 in 2024-02.

Design consequence: a first version treated every rule as an exclusion. That left only 58-71% of rows and
removed almost all Vendor 1 and flex-fare trips, which would have biased every trusted metric. Rules that fire
on a whole vendor or payment type are now warnings.

## Usage

```bash
make install                      # venv + dev dependencies
.venv/bin/data-trust run --months 2024-01 2024-02 2024-03   # ingest, then build JSON
.venv/bin/data-trust validate --months 2024-01              # print the trust report
make check                        # ruff + pytest with coverage
.venv/bin/python tools/recompute_check.py   # recompute published numbers from the raw files
```

`ingest` accepts `--base-url` to point at a mirror of the TLC host. Raw files go to `data/raw/`
(git-ignored); published aggregates go to `web/public/data/`.

## Frontend

`web/public` is plain HTML/CSS/ES modules (no framework, no build step, so Cloudflare Pages deploys do
not spend build minutes). It reads `web/public/data/*.json` and shows: trust tiles, the trusted / clean
share by month, violation rate per rule (warning rules in orange), where warnings concentrate by vendor
and payment type, raw vs trusted metrics, daily trips, a weekday x hour heatmap and the top pickup zones,
plus a "Method and limitations" section. Charts are responsive (bars reflow on phones, line charts redraw
at the container width), light and dark themes follow the OS setting, every chart has a table view and
rule rows are keyboard-focusable. Preview locally with `python -m http.server -d web/public`. The JSON
fields the page reads are pinned by a contract test. If the data files are missing it shows an explicit
empty state instead of a blank page.

## Tests

`pytest` runs unit and end-to-end tests against synthetic Parquet fixtures with known defects (one
row per rule) and against a local HTTP server (success, retries with backoff, 404 without retry,
truncated/non-Parquet payloads, checksum mismatch, idempotent re-run). The fixtures are not TLC
data, so passing tests demonstrate that the code does what it claims, not what the real data
contains. CI (`.github/workflows/ci.yml`) runs ruff and pytest on Python 3.11 and 3.13.

## Evaluation and limitations

How the results are checked, and what they do **not** show:

- **No ground truth.** There are no labelled bad rows, so there is no precision or recall. Results are
  rule violation counts and the movement of metrics under a stated definition of "trusted". Thresholds
  (100 miles, 80 mph, 24 hours, 6 passengers, 1 cent reconciliation tolerance) are heuristics in
  `validate.py`; changing them changes the numbers.
- **Trusted is not correct.** A row can satisfy every rule and still be wrong. Revenue is the sum of
  `total_amount` (tips, taxes and surcharges included), not driver earnings.
- **Scope.** Yellow Taxi, six months only. Nothing is claimed about green taxis, for-hire vehicles or
  other years. Duplicates are counted but not removed. Timestamps are used as published (no time-zone
  handling).
- **Warning rules are a judgement call.** R10 and R12 are not excluded because they fire on whole
  vendors / payment types (see Findings). The error/warning split is a documented design choice, and the
  report exposes both `trusted_rate` and the stricter `clean_rate` so a reader can pick.
- **Verification.** (1) `tests/` (unit, end-to-end, JSON contract) run in CI. (2)
  `tests/test_published_data.py` checks the committed aggregates are internally consistent (daily, hourly,
  zone and payment totals equal the monthly trusted trips), under the Pages size limit and served with a
  strict CSP. (3) `tools/recompute_check.py` re-implements the error rules as one standalone SQL query
  and compares row counts, revenue and mean distance with the published JSON; it matched for all six
  months when last run, but it was written by the same author as the pipeline, so it is a cross-check,
  not an independent audit. (4) The SHA-256 of every source file is published in `meta.json`.
- **Browser checks.** The dashboard was exercised in headless Chromium (desktop, tablet, 375 px phone;
  month switching, tooltips, theme toggle, table views, window resize) under the production CSP with no
  console errors or failed requests. That is a smoke test, not cross-browser testing.

## Deployment

Cloudflare Pages serves `web/public` directly (build command empty, output directory `web/public`,
production branch `main`). It is static, so there is no process to hibernate; the only runtime
dependency is Cloudflare's edge. `web/public/_headers` sets a strict Content-Security-Policy (no inline
script or style, no third-party requests), `nosniff`, frame denial and a minimal permissions policy.
No secrets, tokens or API keys are used anywhere. Setup steps: [docs/DEPLOY_CLOUDFLARE.md](docs/DEPLOY_CLOUDFLARE.md).
To refresh data, run the pipeline locally, review the diff of `web/public/data/meta.json`, and merge to
`main`; Pages redeploys on push.

## Hosting constraints that shape the design

Cloudflare Pages: 25 MiB per file and a shared 500 builds/month across the portfolio, so the web
app consumes small pre-aggregated JSON and CI avoids needless deploy builds. GitHub Actions
schedules are disabled after 60 days without repository activity, so nothing here depends on one.

## Roadmap

1. ~~Pipeline v0 + tests + CI~~ (this repo state)
2. ~~Run on real TLC months; record findings and checksums~~
3. ~~Web UI and Cloudflare Pages deployment~~
4. Possible next steps: more months, threshold sensitivity analysis, green taxi / HVFHV
5. Extract the repo scaffolding (CI, Makefile, size guard) as a template for the other projects

## License

MIT. TLC data is public; see the TLC site for its terms and data dictionary.
