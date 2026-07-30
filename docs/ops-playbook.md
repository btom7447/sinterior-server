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

## Chat reports (member → staff)

Members cannot find staff by name: `GET /profiles/search` excludes `role: 'admin'`
and the caller themselves. That closes the impersonation route through search —
"Sintherior Support" is the easiest name in the world to type into a profile — but
it also removes the only way a member could reach us from inside a thread. The
report control in the chat header replaces it.

**How it arrives.** `POST /chat/conversations/:conversationId/report` with a fixed
`reason` and an optional `note`. Only a participant may report; the person being
reported is read from the thread, never from the body. One live report per
reporter per conversation (partial unique index on `status: open|reviewing`), so
reporting three times is one row in the queue rather than three people reading the
same messages. A resolved report does not block a new complaint about later
behaviour.

**Reasons**, in the order they are offered, which is roughly the order they occur:
`scam`, `off_platform_payment`, `harassment`, `no_show`, `impersonation`, `spam`,
`other`. `off_platform_payment` is second on purpose — it is the one that costs
somebody their deposit and their escrow protection at the same time.

**The queue.** `ChatReport` carries `conversationId`, `reporter`, `reported`,
`reason`, `note`, `lastMessageAt` (the thread as the reporter saw it) and
`status: open | reviewing | actioned | dismissed`, indexed `{ status, createdAt }`
for oldest-open-first triage.

### NOT BUILT YET — admin side

There is no admin UI and no admin endpoints for this. Reports land in the
collection and nothing surfaces them, so **until the admin side exists, reports
have to be read out of Atlas directly**. Treat that as the interim runbook, not as
a working flow.

What the admin side needs, on both web and mobile:

- `GET /admin/chat-reports` — oldest open first, filterable by status and reason,
  with the reporter and reported profiles populated.
- `GET /admin/chat-reports/:id` — the report plus the conversation transcript.
  Reading the thread is the whole point; asking the member to re-explain it is how
  a dispute becomes unresolvable.
- `PATCH /admin/chat-reports/:id` — set `status`, stamp `resolvedAt`/`resolvedBy`.
  Append-only notes rather than editable ones, since this is evidence.
- Actions from the report: suspend the reported account (existing ban tooling on
  `User`), or dismiss. Both should notify the reporter, because a complaint with
  no answer teaches people to stop reporting.
- Staff-initiated threads: admins can already message anyone, and the
  `isStaff` flag draws the verified badge on their side of the conversation. A
  "message the reporter" action from a report is the natural entry point.
- An SLA to hold to. Same business day matches the content-moderation target
  above; anything money-related (`scam`, `off_platform_payment`) should jump the
  queue.

Open question for Sawyer: whether a report should freeze escrow on any job shared
by the two profiles. It is the strongest lever available and also the easiest to
abuse — a client could stall a payout by filing a complaint.

## Contacts / consoles

Railway (project Sintherior) · Vercel (btom7447s-projects) · MongoDB Atlas · Cloudinary · Paystack (business "sintherior", currently test-mode ops) · Resend · Meta developer console (bot, shelved). Domain DNS: Vercel.
