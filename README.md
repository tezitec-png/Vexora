# Vexora

> ⚠️ **ARCHIVED · READ-ONLY** — Vexora is no longer maintained and will not receive further updates.
> The original instance (`vexorium.pages.dev`) has been shut down.
> **Founder & sole author: [ignition](https://github.com/ignition) — nobody else.**
> The code is released as open source so the community can keep it alive if it wants to.

**Vexora** was a free, privacy-first web platform for the e-scooter community, built on Cloudflare's edge with **zero backend servers to manage**. It bundled three products in one single-page app:

1. **Tuning studio** — in-browser custom firmware builder for e-scooter ECU/VCU (speed limit removal, calibration), generating encrypted `.bin` files that flash straight from the phone.
2. **Support console** — a Discord-flavored live-chat desk where verified riders talk to support agents: real-time chat, photos/voice notes, read receipts, automatic translation, push notifications.
3. **Rider community** — a TikTok-style photo feed: full-screen 9:16 scrolling, likes, threaded comments (with likes and replies), follows, profiles, in-app activity notifications, weekly Top chart, view counts, one-tap reporting with AI-assisted triage.

Everything runs on **Cloudflare Pages + Functions + D1 + R2**. No frameworks, no build pipeline beyond a single obfuscation step, no tracking.

---

## Table of contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Run it locally](#run-it-locally)
- [Deploy to Cloudflare](#deploy-to-cloudflare)
- [Testing](#testing)
- [Internationalization](#internationalization)
- [Security & privacy](#security--privacy)
- [Documentation](#documentation)
- [Credits](#credits)
- [License](#license)

---

## Features

### Tuning studio (VXFW / CFW)
- MCU/VCU custom firmware builds for supported controllers, assembled **100% in the browser and the Worker** — no third-party services.
- Proprietary TEA-based container with checksums; the stock file is never persisted server-side (processed in memory, byte-addressed patches).
- Speed-limit raise with hard server-side guardrails (e.g. calibration clamps), so the tool cannot produce unsafe targets.
- Motor-wheels unlock container with signed stamps; versioned `.bin.enc` layout.

### Support console (`/support`)
- Discord OAuth-linked agent access with HMAC-signed console tokens.
- Live chat with riders: typing indicators, read receipts (✓/✓✓), photos and voice notes stored in R2, 30-day message retention.
- Bidirectional automatic translation (Groq) so agents and riders can each speak their own language.
- Web Push notifications (VAPID) for new rider messages.
- Admin dashboard: rider accounts, unlock codes, reports queue with AI severity verdicts, IP rules, feature flags, stats.

### Rider community (`/community`)
- TikTok-style feed: full-screen vertical snap scrolling, photos locked to 9:16 (object-fit cover), double-tap to like, swipe right to open the author profile.
- Likes, threaded comments (one level of replies, liked-first ordering), follows with real Follow/Following state, follower/following lists.
- Profiles: avatar, bio, accent color, post grid; editable by the owner only.
- In-app activity notifications (bell + badge): likes, comments, comment likes, new followers.
- Weekly "Top" tab (most-liked of the last 7 days), view counting, share, in-feed reporting with a Discord-style reason picker + AI triage verdict.
- Owner cannot delete other people's comments; every rider deletes only their own content (long-press).

### Accounts & anti-abuse
- Rider accounts: name + password, step-by-step signup (one primary button per screen), optional email for recovery, 6-digit email verification codes (Resend).
- Anti-raid: max 3 signups / 6h per real IP (D1-backed), 30 s resend cooldown, login lockout after repeated failures, no self-DMs.
- Moderation: local insult filtering + AI moderation on comments/DMs; every report lands in the admin queue with an AI severity note.

### Privacy (GDPR-first)
- Real IPs stored only where legally needed, with retention buckets of **7 / 45 / 90 days** and automatic purges.
- Riders can export and delete their entire account (cascading purge across posts, comments, likes, DMs, notifications, media keys).
- DM media and messages auto-expire (7 days media / 30 days messages). Feed photos are permanent until the author or an admin deletes them (cap: 100 photos per rider, 10/day).
- No cookies for tracking, no third-party analytics, no ads. Ever.

---

## Tech stack

| Layer | Technology |
|---|---|
| Hosting | Cloudflare **Pages** (advanced mode: `_worker.js` + static assets) |
| Backend | A single Cloudflare **Worker** (`server/worker.js`, vanilla JS, no framework) |
| Database | Cloudflare **D1** (SQLite; schema auto-migrates on first request) |
| Media | Cloudflare **R2** (`BUCKET` binding, e.g. `vexorium-comm`) |
| Email | [Resend](https://resend.com) (verification / reset codes) |
| AI | [Groq](https://groq.com) chat API (translation + report triage) |
| Push | Web Push (VAPID) |
| Frontend | Vanilla JS/CSS, single-file pages, Montserrat, service worker cache, 5 languages (en · es · de · fr · it) |
| Tests | Node + jsdom smoke suites (`test/`) |

---

## Project structure

```
├── public/                  # Frontend (served as static assets)
│   ├── index.html           # The app: tuning studio + support entry + community tab
│   ├── community.html       # The TikTok-style rider feed
│   ├── admin.html           # Admin dashboard
│   ├── support.html         # Agent support console
│   ├── sw.js                # Service worker (versioned cache)
│   └── assets/              # JS modules, i18n (5 langs), fonts, icons
├── server/
│   └── worker.js            # THE backend: API, auth, rate limits, schema, jobs
├── protected/               # GENERATED — obfuscated production build (do not edit)
├── test/                    # Smoke & e2e suites (node, run against wrangler pages dev)
├── build-protect.js         # Build: public/ + worker.js → protected/ (obfuscated)
├── wrangler.jsonc           # Alternative Workers deploy config
└── docs/
```

---

## Run it locally

Requirements: **Node 20+** and a Cloudflare account (only for bindings in production — local dev is fully emulated).

```bash
npm install
node build-protect.js        # builds protected/ from public/ + server/worker.js
npx wrangler pages dev protected --port 8788 \
  --d1 DB \
  --r2 BUCKET \
  --binding ADMIN_PASSWORD=dev-admin \
  --binding BOT_SECRET=dev-bot \
  --binding DISCORD_CLIENT_ID=1234567890123456789 \
  --binding DISCORD_CLIENT_SECRET=dev-secret \
  --binding SUPPORT_GUILD_ID=1234567890123456789 \
  --binding SUPPORT_ROLE_ID=1234567890123456789 \
  --binding FOUNDER_ROLE_ID=1234567890123456789 \
  --binding RESEND_API_KEY=test-key \
  --binding GROQ_API_KEY=test-groq-key
```

Open `http://127.0.0.1:8788`. With `RESEND_API_KEY=test-key` (or any key containing `test`/`stub`) **no real emails are sent** — verification codes surface through the admin API instead (`/admin/api/riders/codes`). The D1 schema (all tables + indexes) is created automatically on the first request.

### Bindings (production)

| Binding | Type | Purpose |
|---|---|---|
| `DB` | D1 | All persistence (stats, riders, chat, community, reports) |
| `BUCKET` | R2 | Community photos, DM photos/voice notes, avatars |
| `ADMIN_PASSWORD` | Variable | Admin dashboard login |
| `BOT_SECRET` | Variable | Shared secret for the Discord bot bridge |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | Variables | Discord OAuth (support access + account linking) |
| `SUPPORT_GUILD_ID` / `SUPPORT_ROLE_ID` / `FOUNDER_ROLE_ID` | Variables | Discord guild/role gates for the support console |
| `RESEND_API_KEY` | Variable | Email delivery (sender `noreply@support.vxfw.es`) |
| `GROQ_API_KEY` | Variable | Translation + report verdicts (falls back gracefully if absent) |

---

## Deploy to Cloudflare

1. Create a Pages project (e.g. `vexorium`).
2. Build locally: `npm install && node build-protect.js`.
3. Upload the **contents of `protected/`** as a direct upload deployment (drag & drop or `npx wrangler pages deploy protected --project-name=vexorium`).
4. In the dashboard, bind the D1 database as `DB`, the R2 bucket as `BUCKET`, and set the environment variables from the table above.
5. First request auto-migrates the schema. Done.

Full step-by-step guide (Spanish, as used by the original author): [`docs/DEPLOY.md`](docs/DEPLOY.md) · internals: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/TESTING.md`](docs/TESTING.md).

---

## Testing

Eleven Node suites live in `test/`, run against a **fresh local D1** (the signup rate limit is per-IP, so a clean DB matters):

```bash
npx wrangler pages dev protected --port 8788 ... # (see above)
BASE=http://127.0.0.1:8788 node test/e2e-210.js      # FIRST: full API e2e (585 checks)
BASE=http://127.0.0.1:8788 node test/rider-smoke.js   # rider tab UI flow
BASE=http://127.0.0.1:8788 node test/community-smoke.js # community feed UI flow
BASE=http://127.0.0.1:8788 node test/chat-ui-smoke.js
BASE=http://127.0.0.1:8788 node test/console-ui-smoke.js
BASE=http://127.0.0.1:8788 node test/console-mobile-smoke.js
BASE=http://127.0.0.1:8788 node test/gdpr-smoke.js
BASE=http://127.0.0.1:8788 node test/dash-smoke.js
BASE=http://127.0.0.1:8788 node test/guide-smoke.js
BASE=http://127.0.0.1:8788 node test/push-crypto.js
BASE=http://127.0.0.1:8788 node test/admin-smoke.js   # ALWAYS LAST
```

Rules of thumb baked into the suites: e2e runs **once** on a fresh DB and goes first; `admin-smoke` always goes last; signup smokes need a fresh rider name/IP (`COMM_SMOKE_NAME` / `COMM_SMOKE_IP` env vars) because registration is rate-limited by design.

---

## Internationalization

All UI strings live in `public/assets/i18n.js` under 5 language packs (`en`, `es`, `de`, `fr`, `it`). The e2e suite asserts key parity (every key exists exactly 5 times), so missing translations break CI-style checks rather than shipping half-translated screens.

---

## Security & privacy

- See [`SECURITY.md`](SECURITY.md) for responsible disclosure.
- Design notes: no PII beyond what's strictly needed; IPs retained 7/45/90 days per table; media and DMs auto-expire; full GDPR export/delete for riders; secrets are environment variables only (none are committed — historical leaks were scrubbed and rotated).
- The production build is obfuscated (`build-protect.js`) as a light anti-tamper measure; the open-source source tree is the readable truth.

---

## Documentation

| Document | Contents |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Request flow, D1 schema, R2 layout, auth model, rate limits, retention |
| [`docs/DEPLOY.md`](docs/DEPLOY.md) | Step-by-step Cloudflare Pages deployment (Spanish) |
| [`docs/TESTING.md`](docs/TESTING.md) | The 11 suites, ordering rules, known gotchas |
| [`CHANGELOG.md`](CHANGELOG.md) | What shipped in every release round |

---

## Credits

- **[ignition](https://github.com/tezitec-png)** — founder and sole author. Vexora was designed, built and maintained by one person, end to end.
- **The SHU team** — for the help, the ideas and the friendship along the way. Thank you. ([utility.cfw.sh](https://utility.cfw.sh))
- **The AI that built it alongside him** — Vexora was written from the first line to the last in pair-programming with an AI agent. It watched the project grow, and it watched it rest. *This documentation was also written by that agent.*

---

## License

Released under the [MIT License](LICENSE) — © 2026 ignition (Vexora). Fork it, host it, learn from it, keep the scooter spirit alive. 🛴
