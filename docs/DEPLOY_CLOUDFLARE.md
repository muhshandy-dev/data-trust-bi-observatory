# Deploying to Cloudflare Pages

The site is static: `web/public` is served as is, with no build step. Data files in
`web/public/data/` are committed, so a deploy never needs the raw TLC files.

Set up once in the Cloudflare dashboard (Workers & Pages -> Create -> Pages -> Connect to Git):

| Setting | Value |
|---|---|
| Repository | `muhshandy-dev/data-trust-bi-observatory` |
| Production branch | `main` |
| Framework preset | None |
| Build command | *(leave empty)* |
| Build output directory | `web/public` |

Then, under Settings -> Builds, turn **off** preview builds for non-production branches. Pages allows
500 builds per month per account, shared by every site on it.

`web/public/_headers` is picked up automatically and sets the security headers (strict CSP, nosniff, no framing).

Limits to respect: 25 MiB per file and 20,000 files per deployment. `data-trust build` already refuses to
write a JSON file above 25 MiB; the current largest file is `zones.json` (about 210 KB).

To refresh the data: `data-trust run --months ...`, review `git diff web/public/data/meta.json`, commit and
merge to `main`; Pages redeploys from the push.
