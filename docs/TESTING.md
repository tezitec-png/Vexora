# Testing

Vexora shipped with 11 Node suites (~870 checks) run before every release, against a local `wrangler pages dev` instance with a **fresh D1**.

## Setup

```bash
npm install
node build-protect.js
npx wrangler pages dev protected --port 8788 --ip 127.0.0.1 \
  --d1 DB --r2 BUCKET \
  --binding ADMIN_PASSWORD=vexora-test-admin \
  --binding BOT_SECRET=e2e-bot-secret \
  --binding DISCORD_CLIENT_ID=1234567890123456789 \
  --binding DISCORD_CLIENT_SECRET=test-secret-local \
  --binding SUPPORT_GUILD_ID=1552688525034397849 \
  --binding SUPPORT_ROLE_ID=1552688525034397849 \
  --binding FOUNDER_ROLE_ID=1552688525034397849 \
  --binding RESEND_API_KEY=test-key \
  --binding GROQ_API_KEY=test-groq-key \
  --persist-to .wrangler/state
# wait for: curl http://127.0.0.1:8788/api/health → {"maint":1,...}
```

`RESEND_API_KEY=test-key` activates **stub mode** (no real emails; codes readable via `/admin/api/riders/codes` with an admin token). `GROQ_API_KEY=test-groq-key` makes Groq calls fall back gracefully.

## Order matters

1. **Fresh DB**: `rm -rf .wrangler` before the cycle (signup limits are per-IP and the e2e is one-shot by design).
2. `test/e2e-210.js` — the big API end-to-end (585 checks: firmware builds, auth, anti-raid, DMs, GDPR, community API, admin).
3. UI smokes (jsdom, in any order): `rider-smoke.js` (25–30), `community-smoke.js` (54), `chat-ui-smoke.js`, `console-ui-smoke.js`, `console-mobile-smoke.js`, `dash-smoke.js`, `guide-smoke.js`, `gdpr-smoke.js`, `push-crypto.js` (pure crypto, no server needed).
4. **`admin-smoke.js` ALWAYS last** — it asserts on state created by the others.

## Re-running smokes

Signup smokes are not idempotent (anti-raid limits!). Pass fresh identities:

```bash
COMM_SMOKE_NAME=comm_smoke_abc COMM_SMOKE_IP=10.9.9.9 BASE=http://127.0.0.1:8788 node test/community-smoke.js
```

## Gotchas baked into the suites (learn the hard way)

- jsdom has no `document` global in Node scope — use the suite's `$()` helper.
- `el.hidden === true` is the truth; CSS can still paint it — assert computed styles for modal/guard rules.
- Stub `IntersectionObserver`, `HTMLCanvasElement.prototype.getContext`, `matchMedia`, `SVGElement.getTotalLength/getPointAtLength/getBBox`.
- After restructuring a modal, make tests **wait for the new content** (a button/list item), never the container or fixed sleeps.
- Never assert on literals inside `protected/` assets — the production build obfuscates strings. Assert on behavior, or on `public/` sources.
- The feed/community smokes must select slides via `#cFeedList .c-slide[...]` (the comment sheet renders in `#cPostBox`).
- `fetch(...).body` in Node is a ReadableStream — the e2e has `jpost()`/`jadmin()` helpers that return `{status, body}`.
- Reset-password flows consume the 30 s resend cooldown — plan mail usage across riders.
