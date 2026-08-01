# System Architecture

_Last updated: 2026-07-27 · Platform-canonical topology — other repos reference this file._

## Topology (current, verified in production)

```
                    ┌─────────────────────────────┐
  sintherior.com    │  sinterior-client (Next 16) │  Vercel · prod branch v1.1
  www.sintherior.com│  React 19 · Tailwind 4      │  NEXT_PUBLIC_API_URL →
                    └──────────────┬──────────────┘  https://api.sintherior.com/api/v1
                                   │ REST + Socket.IO (socket URL = API URL minus /api/v1)
                    ┌──────────────▼──────────────┐
  api.sintherior.com│  server (Express 4, ESM)    │  Railway · repo btom7447/sinterior-server
                    │  Socket.IO · node-cron      │  branch master · port 5000 · 1 replica
                    └────┬─────────┬──────────┬───┘
                         │         │          │
              MongoDB Atlas   Cloudinary   Paystack (webhook → /api/v1/payments/webhook)
              db: sinterior-prod  (media)   Resend (email)
                         │
                    ┌────▼────────────────────────┐
  bot.sintherior.com│  whatsapp-bot (Express)     │  Railway · repo btom7447/sintherior-whatsapp-bot
  (SHELVED)         │  Meta Cloud API webhook     │  branch main · port 8080 · 1 replica
                    └─────────────────────────────┘  db: sintherior-bot (own DB, same cluster)

  Mobile app (planned): consumes the same API; no server changes required for v1 scope
  DNS: Vercel DNS hosts sintherior.com (manage via `vercel dns`)
```

## Load-bearing constraints (violate these and things break)

1. **Both Railway services must stay at exactly 1 replica.** Socket.IO presence is an in-process Map; rate limiting is in-memory; bot conversation sessions are an in-process Map. Scaling out requires a Redis adapter + shared stores first.
2. **No Railway "App Sleeping".** Crons run inside the web process (hourly escrow/payout ticks, daily auto-accept, weekly invoicing). A slept instance misses money-moving ticks. Cron double-fire across restarts is prevented by Mongo-backed leases (`CronLock`).
3. **Atlas IP allowlist must include 0.0.0.0/0** — Railway egress IPs are dynamic. On rejection the server exits after ~25s of retries → crash-loop.
4. **`trust proxy` stays on** (app.js). Without it every user shares one rate-limit bucket behind Railway's proxy.
5. **Paystack webhook route must receive the raw body** — express.json is skipped on that path for HMAC verification. Never add global body middleware ahead of it.
6. **NEXT_PUBLIC_* are build-time** — changing them on Vercel requires a rebuild (cache-less if the value must re-inline). Set values via `printf | vercel env add` (PowerShell pipes corrupt with BOM/CRLF).
7. **Bot `NODE_ENV=production` is mandatory** — otherwise a DRY_RUN heuristic can silently swallow all outbound sends.

## Data model (server, MongoDB)

**Live:** User, Profile, ArtisanProfile, SupplierProfile, Product, Property, Order, Job, Quote, Appointment, Project, Review, Message, Notification, Bookmark, FeedPost, BlogPost, CareerListing, HelpArticle, ContactInquiry, VerificationRequest, Dispute, Wallet, WalletTransaction, EscrowEntry, PayoutRequest, BankAccount, PlatformSetting, CronLock.

**Money flow:** Paystack charge → escrow hold (EscrowEntry) → **release trigger** → wallet credit (`holding`) → hold period expiry (cron) → `available` → payout request → cooldown (cron) → Paystack transfer → webhook confirms/reverses. Wallet mutations are append-only WalletTransactions.

**The release trigger is a person, not a timer.** This line previously read as
though the cron released escrow; it does not — it only promotes an already-
credited wallet balance from `holding` to `available`. Escrow itself is released
by an event:

- **Orders** — `POST /orders/:id/approve-delivery`, and only once *both* the
  buyer and the supplier have approved. Either alone does nothing.
- **Jobs** — work accepted by the client, or the auto-accept cron standing in
  for a client who never responded.
- **Admin** — manual release on a dispute.

Orders have no auto-accept equivalent. An order nobody confirms holds its money
indefinitely, which is why both confirmations need to be reachable in every
client — a missing button here is not a UI gap, it is a supplier not being paid.
Releases claim their entry with an atomic `findOneAndUpdate` on `status: 'held'`,
so two triggers racing cannot pay twice.

Cash-on-delivery orders never create an escrow entry at all — the money moved in
person. Their platform fee is accrued against the supplier instead (`accrueCodFee`)
and collected later.

### Feed pivot additions (P1)

```
Pin      { author→Profile, sourceType: native|product|property|admin, sourceRef,
           mediaType: image|video, mediaUrl, posterUrl, aspectRatio,
           title, caption, taxonomy{skill, room, budgetBand, tags[]},
           counters{saves, views}, status: active|hidden|removed, timestamps }
Board    { owner→Profile, name, coverPinId?, isPrivate, timestamps }
BoardPin { boardId, pinId, unique(boardId,pinId), timestamps }
Follow   { follower→Profile, followed→Profile, unique pair, timestamps }
```

- **Pin is canonical for artisan work media going forward.** Existing embedded `ArtisanProfile.portfolio` (subdocs with `_id:false` — not addressable) is backfilled into Pins once; profile pages render "pins by author"; the old field becomes read-only legacy.
- **Derived pins upsert on source mutation** (Product/Property create/update/delete hooks), never batch-sync — the feed cannot drift from inventory.
- `aspectRatio` is computed server-side at upload (Cloudinary metadata) so masonry renders with zero layout shift.
- Ranking = one aggregation: recency decay + save-velocity + followed-author boost + saver-affinity (from user's save history taxonomy) + author-diversity window. Cursor pagination.

## Media pipeline

Uploads: multer memoryStorage → Cloudinary (no disk writes; Railway FS is ephemeral). Images: auto format/quality. Video (feed v1): ≤60s, transcode capped 720p H.264, auto poster frame, tap-to-play in clients. Legacy `/uploads` disk paths were purged from the DB (2026-07-04); the static `/uploads` route in app.js is vestigial and removable.

## Auth

JWT access token (15m, in-memory on clients) + httpOnly refresh cookie (7d). Client auto-refreshes once on 401 then broadcasts `auth:unauthorized`. Socket.IO handshake carries the access token. Roles: client / artisan / supplier (+ admin flag). The mobile app reuses this flow with secure native storage for the refresh credential.

## Failure modes worth knowing

- `/health` returns 503 while Mongo reconnects (both services) — pair health checks with tolerant restart policies.
- Server fail-fasts API requests when Mongo is down (503) instead of hanging.
- Bot ACKs Meta webhooks before processing — messages in-flight during a redeploy are lost (Meta does not redeliver after 200).
- Bot sessions wipe on every deploy (in-memory) — mid-conversation users restart.
- An unhandled promise rejection restarts either service (by design, graceful SIGTERM shutdown is implemented).
