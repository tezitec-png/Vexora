# Contributing

**Vexora is archived.** The original project will not accept pull requests, issues or feature requests — there is no active maintainer.

That said, the whole point of open-sourcing it is for the community:

- **Fork it** — the license (MIT) explicitly allows you to run, modify and re-publish it.
- If you fork and want to keep it alive, feel free to adopt the repo's structure: `test/` first, fresh-DB e2e before anything else, and the 5-language i18n parity checks.
- Please keep the spirit of the original: free, no tracking, no ads, privacy-first.

## Development quickstart

```bash
npm install
node build-protect.js
npx wrangler pages dev protected --port 8788 --d1 DB --r2 BUCKET ...
# see README.md for the full command
```

Rules of thumb learned the hard way (they will save you hours):

1. **e2e first, fresh DB** — `test/e2e-210.js` is not idempotent by design (signup rate limits are per-IP). Reset the local D1 (`rm -rf .wrangler`) and run it once before the smokes.
2. **admin-smoke last** — it depends on state the other suites create.
3. **Smoke re-runs need fresh identities** — `COMM_SMOKE_NAME` / `COMM_SMOKE_IP` env vars exist for that.
4. **Never assert on minified literals** — the production build obfuscates `app.js`; assert on behavior or on `public/` sources instead.
5. **jsdom has no `document` in Node scope** — use the suite's `$()` helper; stub `IntersectionObserver`; `hidden` needs `getComputedStyle` checks because CSS can lie.
6. **After any modal/HTML restructure, make the smoke wait for the new CONTENT** (a button, a row), not the container.
