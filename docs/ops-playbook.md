# Ops Playbook

_Last updated: 2026-07-27 · Most incidents land here (the server) — this copy is platform-canonical._

## Daily signals

- `https://api.sintherior.com/health` → `ok / connected / production`
- `https://bot.sintherior.com/health` → `ok` (+ `dryRun:false` once live)
- `railway logs` from `server/` or `whatsapp-bot/` (dirs are CLI-linked)
- Vercel: newest deployment ● Ready + Production

## Incident: API down / crash-looping

1. `railway logs` — read the boot sequence.
2. `[FATAL] Missing required environment variables` → a var got deleted; restore in Variables (see deploy-railway.md).
3. Mongo connect retries then exit ≈25s → **check Atlas first**: cluster paused? Network Access lost `0.0.0.0/0`? (Most likely cause on Railway's dynamic IPs.)
4. Crash right after a push → bad deploy: Railway → Deployments → previous good → Redeploy, then fix forward.
5. `/health` says `degraded` but process is up → Mongo blip; it self-heals; don't restart-storm it.

## Incident: frontend can't reach API

1. Browser console: CORS error → `CLIENT_URL` on Railway must contain the exact origin (comma-separated list).
2. 404s on API calls → check `NEXT_PUBLIC_API_URL` ends with `/api/v1` AND the deployed bundle actually inlined it (client repo's deploy-vercel.md rule 2 — build cache replays are real).
3. Socket not connecting → same env var (socket URL derives from it); confirm wss to api.sintherior.com.

## Incident: payments/payouts stuck

1. Paystack dashboard → webhook delivery logs — are events reaching `https://api.sintherior.com/api/v1/payments/webhook`? Failing signature = key mismatch (test event vs live key or vice versa; server currently runs **sk_test**).
2. Payouts sit in cooldown by design (hourly cron :15). Check `railway logs` for `[cron]` lines; CronLock prevents double-fires.
3. Never hand-edit wallet balances — append a correcting WalletTransaction with an actor.

## Incident: images broken

- New uploads → Cloudinary creds on Railway; check upload response in logs.
- Rendered via next/image with 400s → host missing from `next.config.ts` remotePatterns (client repo; needs rebuild).

## Routine: deploy

Server/bot: push to tracked branch → Railway auto-deploys → verify /health + logs. Client: push `v1.1` → Vercel Production → verify ● Ready. Rollbacks: deploy-railway.md (server) / client repo's deploy-vercel.md.

## Routine: rotate a secret

Railway/Vercel env store → replace value (Git Bash `printf` method for Vercel) → redeploy → verify → invalidate old credential at the provider (Paystack/Cloudinary/Resend/Meta).

## Routine: DB

- Backups: Atlas (M0 has no continuous backup — before any bulk write, dump the affected docs to JSON first; precedent: the 2026-07-04 uploads cleanup kept a backup file).
- Ad-hoc scripts: pattern in `server/src/scripts/` (read-only `listUsers.js` is the template — always print which DB you connected to; idempotent; dry-run flags on anything that writes).

## Content moderation (feed, once live)

Reported/offending pin → admin hide (instant, reversible) → review → remove or restore. Takedown target: same business day. Repeat-offender authors → existing ban tooling on User.

## Contacts / consoles

Railway (project Sintherior) · Vercel (btom7447s-projects) · MongoDB Atlas · Cloudinary · Paystack (business "sintherior", currently test-mode ops) · Resend · Meta developer console (bot, shelved). Domain DNS: Vercel.
