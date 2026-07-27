# Deploy Runbook — Railway (sinterior-server)

_Last updated: 2026-07-27 · Project: **Sintherior** · Environment: **production** · Account: tombenjamin7447@gmail.com_

This runbook covers the **server** service. The whatsapp-bot service deploys from its own repo — its deploy detail (vars, resume checklist, Meta config) lives in the bot repo's docs. The services table below stays for platform context.

## Services

| Service | Repo / branch | Domain | Port | DB |
|---|---|---|---|---|
| `sinterior-server` | `btom7447/sinterior-server` · `master` | https://api.sintherior.com | 5000 | Atlas `sinterior-prod` |
| `sintherior-whatsapp-bot` | `btom7447/sintherior-whatsapp-bot` · `main` | https://bot.sintherior.com | 8080 | Atlas `sintherior-bot` |

Auto-deploy on push to the tracked branch (`master`) — **treat every push as a production deploy.** Custom domains are CNAMEs on **Vercel DNS** (`vercel dns ls sintherior.com`).

## CLI (already linked)

```bash
# server/ dir is railway-linked — run from it:
railway status          # confirm which service you're pointed at
railway logs            # tail runtime logs (snapshot: run with a timeout)
railway variables --json
railway variables --set "KEY=value" [--skip-deploys]
railway redeploy --yes  # re-run current deployment (applies staged var changes)
railway domain          # list/generate domains
```

## Environment variables (server)

- **Boot-critical** (exit(1) if missing): `MONGO_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`.
- **Functionally required:** `NODE_ENV=production`, `CLIENT_URL` (CORS allowlist, comma-separated: vercel app + apex + www), `SERVER_URL=https://api.sintherior.com`, `PAYSTACK_SECRET_KEY` (currently **sk_test** — live swap is a client decision), `CLOUDINARY_CLOUD_NAME/_API_KEY/_API_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`.
- **Optional tuning:** rate-limit vars, JWT TTLs, `CLIENT_APP_URL` (defaults correctly in prod).

New env vars: add to `src/config/env.js` (+ REQUIRED list if boot-critical), `.env.example`, and this file in the same change (see coding-guideline.md).

## Standing rules (from system-architecture.md — do not violate)

- **1 replica. No App Sleeping.** (In-memory state; in-process crons — a slept instance misses money-moving ticks.)
- Atlas Network Access keeps `0.0.0.0/0` (dynamic egress IPs).
- `/health` 503s during Mongo reconnects — tolerate in restart policies (boot retry window ≈25s).

## Verify a deploy

```bash
curl https://api.sintherior.com/health   # expect ok / connected / production
railway logs                             # boot lines: MongoDB connected, crons scheduled, no warnings
```

## Rollback

Railway dashboard → service → Deployments → previous successful deployment → ⋮ → **Redeploy**. (Or `git revert` + push.)

## External integrations pointing at this host

- **Paystack** webhook (Live + Test): `https://api.sintherior.com/api/v1/payments/webhook` — set in dashboard (done 2026-07-04). Callback URL stays empty (per-transaction callback overrides). IP whitelist stays empty. The webhook route must receive the **raw body** for HMAC verification — never add global body middleware ahead of it.

## History

Migrated off Render 2026-07-04 (Render services suspended; free tier's 15-min spin-down was unusable for webhook receivers). Do not resurrect Render configs.
