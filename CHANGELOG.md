# Changelog

All notable changes of the final public line (2.3.2.x). The project is archived; this list is a snapshot of how it grew.

## 2.3.2.60 (final release)

- **Theme**: rider community feed in black + green; per-zone buttons in the app's community tab (white "open feed" CTA, blue account buttons).
- **Flow**: after verifying the 6-digit code, new riders land directly on the community feed.
- **Database**: 5 new D1 indexes (`comm_follow(target,rid)`, `comm_post(rid,id)`, `comm_like(rid)`, `events(ts)`, `chat(token,id)`) to kill full-table scans caused by per-row "do you follow" / count subqueries in the feed — the fix for the "database overloaded" errors.

## 2.3.2.5x — the community era

- **2.3.2.51–.52 · Rider community**: Discord-linked rider accounts, photos on R2 with permanent retention (cap 100/rider · 10/day), TikTok-style feed (full-screen snap, right action rail, double-tap like, For you / Following tabs, red active heart), DM photos with limits, Discord-style report modal.
- **2.3.2.53**: per-photo view counting, weekly Top tab (most-liked of 7 days), in-app activity bell with badge and clickable notifications, 30-day notification retention.
- **2.3.2.54**: clean mobile header, comment threads with replies, delete-your-own-comment by long-press, in-feed report button with reason picker + AI verdict.
- **2.3.2.55**: likes on comments (most-liked comments float up), swipe right on a photo opens the author's profile, photos-only feed decision.
- **2.3.2.55–.57 · mobile polish**: fixed misaligned bell, locked every slide to exact 9:16 (photo dimensions no longer break the layout), always-visible report button under comments, rider identity row (avatar + name + Follow) under each photo, follow button with real state, follower/following lists, TikTok comment sheet (slides up, avatars, clear authorship, ↳ reply markers), animations, zero header/nav collisions.

## 2.3.2.4x — hardening & i18n

- **Anti-raid signup**: 3 accounts / 6h per IP, resend cooldowns, login lockout, step-by-step account creation with one primary action per screen.
- **Moderation**: local insult filter + AI (Groq) on comments/DMs; report queue with AI triage in the admin dashboard; DM photos with limits; 30-day DM retention.
- **Full i18n audit**: the community tab's 59 strings translated ×5 languages; step subtitles ("Step 1 of 3 — …") so users always know where they are.
- **GDPR suite**: export + cascading delete, retention buckets 7/45/90 days, real-IP accounting.

## 2.3.2.3x — support console maturity

- Live chat with read receipts (✓✓), typing indicators, photos and voice notes, bidirectional auto-translation, Web Push for agents, Discord-style chat layout on desktop, always-free navigation.
- Admin dashboard: SHU-style stat cards, rider codes viewer (stubbed when email keys are absent), IP rules with migration from legacy bans.

## 2.3.2.2x — foundations

- Worker-first Pages architecture (`_worker.js` advanced mode), D1 auto-migrating schema, feature flags in DB, events analytics with 90-day retention.
- TEA-container firmware builds with signed unlock stamps and server-side safety clamps; `/cfw/bases/` blocked from public.
- Service-worker versioned cache, 5-language i18n with parity checks, 11 automated suites (~870 checks) run before every release.

---

*Vexora 2.3.2.60 was the last version. The lights are off, the repo stays open.*
