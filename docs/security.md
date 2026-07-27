# Security & Threat Model

_Last updated: 2026-07-27 · Platform-canonical threat model — other repos reference this file._

## Standing rules

1. Secrets live in Railway/Vercel env stores only — never in git, chat logs, or client bundles. `NEXT_PUBLIC_*` is public by definition; nothing sensitive goes there.
2. Money paths (escrow, wallet, payout) are append-only with actors recorded; balances are derived. Any change to them is high-scrutiny review.
3. Every inbound webhook is signature-verified: Paystack HMAC-SHA512 over the **raw body**; Meta X-Hub-Signature-256 (active once `META_APP_SECRET` is set — it is).
4. All list/detail endpoints paginate and validate input (express-validator + mongo-sanitize strips operator injection).
5. New routes ship with role guards — default-deny, then open what the feature needs.

## Auth model

- JWT access (15m) held in memory client-side (never localStorage — XSS can't exfiltrate what isn't stored); httpOnly SameSite refresh cookie (7d); bcrypt passwords; email verification gate.
- Socket.IO handshake authenticates with the access token.
- Admin: role-gated panel on the web app; bot admin API is a separate `x-admin-key` shared secret (rotate via Railway var).

## Platform hardening (in place)

helmet, strict CORS allowlist (exact origins in prod), rate limiting (general 500/15min/IP + tighter auth bucket; `trust proxy` on so buckets are per-user), request size caps (10kb JSON), compression, morgan audit logging, graceful shutdown, DB fail-fast (503 instead of hanging when Mongo drops).

## Threat vectors & posture

| Vector | Posture |
|---|---|
| Credential stuffing / brute force | Auth rate bucket (30/15min/IP prod); bcrypt; no user enumeration in error copy — keep it that way |
| Payment forgery | Webhook HMAC on raw body; payment marking also verified server-side via Paystack verify API; test/live keys segregated (live swap is an explicit decision) |
| Payout fraud | Escrow hold period + payout cooldown crons; disputes freeze flow; bank accounts resolved via Paystack before payout |
| NoSQL injection | express-mongo-sanitize + validator rules |
| XSS → token theft | Access token in memory only; React escaping; no `dangerouslySetInnerHTML` without sanitization [REVIEW on any new use] |
| SSRF/upload abuse | Uploads stream to Cloudinary with type/size caps (5MB images; video caps per PRD); no user-supplied URLs fetched server-side today — revisit if pin "import from URL" is ever proposed |
| Scanner noise | Constant `/.env`, `/.git` probes in logs — 404s, harmless; never serve dotfiles |

## Feed pivot — new surface area (build these in, not after)

- **Upload abuse:** per-author pin rate limits; Cloudinary transcode strips EXIF (location data of people's homes — treat as PII).
- **Content moderation:** admin hide/remove day one; user reporting P2; takedown SLA is an ops-playbook entry.
- **Scraping:** feed is public by design; rate limits are the backstop. Don't expose emails/phones on pin/author cards — contact happens through in-app chat/quotes.
- **Board privacy:** private boards must be enforced server-side on every board/pin-listing query, not hidden client-side.
- **Counter gaming:** save/view counters are advisory ranking signals, not payouts — no financial incentive attached to them, keep it that way.

## Bot (shelved, still deployed)

Webhook signature checks active; admin API key set; broadcast feature is the riskiest surface (mass messaging) — before go-live, re-review throttling. DB is isolated from the web app's.

## Incident basics

Compromised secret → rotate in Railway/Vercel, redeploy, review morgan/Atlas logs for abuse window. See ops-playbook.md.
