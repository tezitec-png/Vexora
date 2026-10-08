# Security policy

## Status

Vexora is **archived**. No security patches will be released for this repository. If you run a fork, you own its security.

## Reporting

Historical contact: **login.vexora@gmail.com** (project founder). The original Discord server is no longer under the founder's control — do **not** report vulnerabilities through Discord.

## Security design notes (for fork maintainers)

- **Secrets live only in environment variables / bindings.** Nothing is committed. If you audit history: two Groq API keys leaked in an old source bundle (pre-2.3.2.50) and were rotated; the delivery packer (`srcpack.cjs`, not included here) has scrubbed them since.
- **Auth model**: riders get bearer tokens (`vexora.riderTok`) issued after signup/verify or login; agents sign into the console via Discord OAuth + HMAC console tokens; admins use a password-derived HMAC token (`exp + HMAC(SHA256("vexora-admin-key:"+pwd))`). All three are checked server-side on every request.
- **Rate limits everywhere**: signup 3/IP/6h (D1-enforced), comment 20/5min, like/follow/cmt-like buckets per minute, reports 5/h, views 90/5min, resets with 30 s cooldown, login lockout 5/15min. Expect 429 with `{wait:N}`.
- **Emails**: `RESEND_API_KEY` with `test-key`/`stub`/empty disables real sending — codes surface via the admin API (stub mode). Never run a real instance without a real key if you value your sender reputation.
- **CORS**: API mutations require same-origin (`Origin` check). The worker blocks `/cfw/bases/` from public access.
- **Retention is a feature**: IPs 7/45/90 days per table, DMs 30 days, DM media 7 days, notifications 30 days, events 90 days. GDPR export/delete is implemented and tested (`test/gdpr-smoke.js`).
- **Obfuscation is not security**: `protected/` is obfuscated for anti-tamper only. Trust the readable sources, rotate every secret when you fork, and put the app behind your own domain with your own bindings.
