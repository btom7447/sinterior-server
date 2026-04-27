# Sintherior — Server

Express + Mongoose REST API for **Sintherior**. Powers the marketplace, real-time chat, payments, super-admin CMS, and verification workflow.

---

## Tech Stack

| Layer            | Technology                                                              |
|------------------|-------------------------------------------------------------------------|
| Runtime          | Node.js 22, ES Modules                                                  |
| Framework        | Express 4                                                               |
| Database         | MongoDB Atlas + Mongoose 8 (2dsphere geo index on artisans)             |
| Auth             | JWT (access in body + refresh as httpOnly cookie), bcrypt 12            |
| Real-Time        | Socket.IO 4 (chat, typing, presence, notifications)                     |
| Uploads          | Multer (memory) → Cloudinary (image/video/PDF)                          |
| Email            | Resend SDK                                                              |
| Payments         | Paystack (initialize, verify, webhook, transfers, refunds, account-resolve) |
| Escrow           | Custom 3-bucket wallet ledger + EscrowEntry + PayoutRequest             |
| Cron             | node-cron + Mongo-backed leases (multi-instance safe)                   |
| Validation       | express-validator                                                        |
| Security         | Helmet, CORS, express-mongo-sanitize, rate limiting, raw-body HMAC for webhook |

---

## Getting Started

### Prerequisites
- Node 22+
- MongoDB Atlas cluster (or local Mongo)
- Cloudinary account
- Optional: Resend, Paystack

### Install
```bash
cd server
npm install
cp .env.example .env.local
npm run dev    # nodemon, http://localhost:5000
```

Health check: `GET /health` returns 200 when DB is connected.

### Seed scripts
```bash
node --env-file=.env.local src/scripts/seedAdmin.js          # admin@sintherior.com / Admin@12345
node --env-file=.env.local src/scripts/seedContent.js        # blog posts + careers listings
node --env-file=.env.local src/scripts/seedHelpAndFeed.js    # help articles + feed posts
node --env-file=.env.local src/scripts/verifyEmail.js <email># mark a user verified in dev
```

---

## Environment

| Variable                  | Required | Notes                                                |
|---------------------------|----------|------------------------------------------------------|
| `NODE_ENV`                | No       | `development` / `production`                         |
| `PORT`                    | No       | Default `5000`                                       |
| `MONGO_URI`               | Yes      | Connection string                                    |
| `CLIENT_URL`              | No       | CORS origin (comma-separated for multi)              |
| `CLIENT_APP_URL`          | No       | Canonical client URL for email links + Paystack callback |
| `JWT_ACCESS_SECRET`       | Yes      | 64+ char hex                                         |
| `JWT_REFRESH_SECRET`      | Yes      | 64+ char hex                                         |
| `JWT_ACCESS_EXPIRES_IN`   | No       | Default `15m`                                        |
| `JWT_REFRESH_EXPIRES_IN`  | No       | Default `7d`                                         |
| `MAX_FILE_SIZE_MB`        | No       | Default `5`                                          |
| `CLOUDINARY_CLOUD_NAME`   | Yes\*    | For all uploads                                      |
| `CLOUDINARY_API_KEY`      | Yes\*    |                                                      |
| `CLOUDINARY_API_SECRET`   | Yes\*    |                                                      |
| `RESEND_API_KEY`          | No       | Falls back to console log in dev                     |
| `EMAIL_FROM`              | No       | Default `Sintherior <noreply@sintherior.com>`        |
| `PAYSTACK_SECRET_KEY`     | Yes\*\*  | Required for live escrow + payouts. HMAC-checked on webhook. |
| `PAYSTACK_PUBLIC_KEY`     | No       | Optional, used for client-side init flows.           |
| `RATE_LIMIT_WINDOW_MS`    | No       | Default 900000 (15m)                                 |
| `RATE_LIMIT_MAX`          | No       | General limiter                                      |
| `AUTH_RATE_LIMIT_MAX`     | No       | Tighter limit on `/auth/*`                           |

\* Cloudinary required wherever files are uploaded.

\*\* Paystack required for the escrow + payouts pipeline. Without a secret key the webhook can't verify HMAC signatures and transfers won't dispatch.

---

## Project Structure

```
server.js                              # Entry — env validation, DB connect, Socket.IO attach, graceful shutdown
src/
├── app.js                             # Express setup — middleware, route registration, error handler
├── config/
│   ├── db.js                          # Mongoose connection
│   └── env.js                         # Env validation + config object
├── controllers/
│   ├── auth.controller.js             # Register, login, refresh, password reset, email verify
│   ├── profile.controller.js          # Profile CRUD, avatar upload
│   ├── artisan.controller.js          # List + nearby (city fallback) + getMine + onboarding
│   ├── supplier.controller.js         # Onboarding, business details
│   ├── product.controller.js          # CRUD + search
│   ├── property.controller.js         # CRUD + search
│   ├── order.controller.js            # Create, list, status updates, approve-delivery (+ escrow release / COD fee accrual)
│   ├── job.controller.js              # Create, accept/reject/cancel/approve-start/approve-end, accept-work, getActiveJobs
│   ├── payment.controller.js          # Initialize, verify (amount-checked), webhook (raw-body HMAC),
│   │                                  #   idempotent escrow creation, transfer success/failure handling
│   ├── project.controller.js
│   ├── appointment.controller.js
│   ├── chat.controller.js             # Conversations, messages, search, canChat() guard
│   ├── notification.controller.js
│   ├── review.controller.js
│   ├── bookmark.controller.js
│   ├── dashboard.controller.js        # Role-specific stats + recent orders
│   └── admin.controller.js            # Stats, page-stats, users, orders, products, blog, careers,
│                                      #   help, feed, disputes, verifications, settings, escrow
│                                      #   refund/release, payouts release/cancel, platform & seller
│                                      #   wallets, suspend/unsuspend, fee reminders, global pause
├── services/
│   ├── wallet.service.js              # Single source of truth for wallet mutations:
│   │                                  #   creditEscrow / releaseEscrow / promoteExpiredHolds /
│   │                                  #   debitPayout (atomic) / reversePayout / refundFromSeller /
│   │                                  #   accrueCodFee / adjust. Bucket whitelist + lifetime totals.
│   └── refund.service.js              # Issue refund with Paystack rollback if seller-debit succeeded
│                                      #   but Paystack call fails.
├── jobs/
│   ├── index.js                       # Cron registration. Each handler wrapped in withLock for
│   │                                  #   multi-instance safety.
│   ├── expireHoldPeriod.js            # Hourly :05 — promote holding → available for entries past availableAt
│   ├── processPayoutCooldown.js       # Hourly :15 — fire pending payouts whose scheduledFor elapsed
│   │                                  #   (atomic claim, stable Paystack reference)
│   ├── autoAcceptJobs.js              # Daily 02:00 — auto-release escrow on completed+paid jobs the
│   │                                  #   client never accepted (uses workAutoAcceptAt; legacy fallback)
│   └── invoiceScheduledFees.js        # Mondays 02:00 — deduct accrued feesOwed from seller wallets,
│                                      #   force-pause + admin notify if balance goes negative
├── middleware/
│   ├── auth.js                        # protect + restrictTo(...roles)
│   ├── errorHandler.js
│   ├── rateLimiter.js                 # generalLimiter + authLimiter
│   ├── upload.js                      # Multer (memory) → Cloudinary stream upload
│   └── validate.js                    # express-validator wrapper
├── models/
│   ├── User.js                        # email, passwordHash, role, isEmailVerified, isBanned
│   ├── Profile.js                     # userId, fullName, avatarUrl, phone, city, state, role
│   ├── ArtisanProfile.js              # skill, skillCategory, portfolio[], certifications[],
│   │                                  #   pricePerDay, location (2dsphere), isVerified, etc.
│   ├── SupplierProfile.js             # businessName, description, deliveryStates[], isVerified
│   ├── Product.js                     # supplierId, name, category, price, stock, isActive
│   ├── Property.js
│   ├── Order.js                       # buyerId, items[], status, paymentStatus,
│   │                                  #   buyerDeliveryApproved, supplierDeliveryApproved,
│   │                                  #   deliveredAt, escrowEntryId, cancellationReason, cancelledBy
│   ├── Job.js                         # clientId, artisanId, bookingType, scheduledDate,
│   │                                  #   dailyRate, dual-approval flags, daysCharged, totalAmount,
│   │                                  #   workAccepted, workAcceptedAt, workAutoAcceptAt,
│   │                                  #   escrowEntryId, cancellationReason, cancelledBy
│   ├── Project.js
│   ├── Appointment.js
│   ├── Message.js                     # + Chat.js for conversation metadata
│   ├── Notification.js
│   ├── Review.js
│   ├── Bookmark.js
│   ├── ContactInquiry.js
│   ├── BlogPost.js                    # admin CMS — slug, body, status, tags, publishedAt
│   ├── CareerListing.js               # admin CMS
│   ├── HelpArticle.js                 # admin CMS — category, emoji, body, order
│   ├── FeedPost.js                    # admin CMS — mediaType (image/video), mediaUrl, posterUrl
│   ├── VerificationRequest.js         # kind (business|individual), documents[], status, reviewNote
│   ├── Dispute.js                     # type (order|job), raisedBy, against, reason, status
│   ├── PlatformSetting.js             # key/value store + getPaymentConfig() merging defaults
│   ├── Wallet.js                      # 3-bucket per-seller (or platform) wallet:
│   │                                  #   pending / holding / available + feesOwed; per-seller
│   │                                  #   feeMode, customHoldHours, customPayoutReviewHours,
│   │                                  #   customMinPayoutKobo, withdrawalsPaused, lifetime totals.
│   │                                  #   Atomic findOrCreate / getPlatform via upsert.
│   ├── WalletTransaction.js           # Append-only ledger with type, signed amount, bucket, source,
│   │                                  #   referenceId, availableAt, balanceSnapshot, promotedAt.
│   ├── EscrowEntry.js                 # One per (entityType, entityId, sellerProfileId).
│   │                                  #   status: held|released|refunded|partially_refunded.
│   │                                  #   Unique on (paystackReference, sellerProfileId).
│   ├── BankAccount.js                 # Paystack recipient_code per seller bank, nameMismatch flag.
│   ├── PayoutRequest.js               # pending → processing → completed|failed|cancelled.
│   │                                  #   scheduledFor drives the cooldown cron.
│   └── CronLock.js                    # Mongo-backed lease + TTL for distributed cron coordination.
├── routes/
│   ├── auth.routes.js
│   ├── profile.routes.js
│   ├── artisan.routes.js              # /artisans, /artisans/me, /nearby, /onboarding, /location, etc.
│   ├── supplier.routes.js
│   ├── product.routes.js
│   ├── property.routes.js
│   ├── order.routes.js                # CRUD + PATCH /:id/status + POST /:id/approve-delivery
│   ├── job.routes.js                  # CRUD + accept/reject/cancel/approve-start/approve-end + /active
│   ├── project.routes.js
│   ├── appointment.routes.js
│   ├── chat.routes.js
│   ├── notification.routes.js
│   ├── review.routes.js
│   ├── bookmark.routes.js
│   ├── dashboard.routes.js
│   ├── payment.routes.js              # Initialize, verify, Paystack webhook (express.raw HMAC)
│   ├── wallet.routes.js               # GET /wallet/me, /wallet/me/escrow, /wallet/me/transactions
│   ├── bank.routes.js                 # GET /banks, /banks/resolve, CRUD /bank-accounts
│   ├── payout.routes.js               # POST /payouts, GET /payouts/me, /payouts/:id
│   ├── contact.routes.js
│   ├── blog.routes.js                 # public list + slug
│   ├── careers.routes.js              # public list + id
│   ├── help.routes.js                 # public list grouped by category + slug
│   ├── feed.routes.js                 # merged admin posts + artisan portfolio
│   ├── verification.routes.js         # POST /upload, POST /, GET /my
│   ├── dispute.routes.js              # POST /, GET /my
│   └── admin.routes.js                # stats, page-stats, analytics, users, orders, products,
│                                      #   blog, careers, help, feed, disputes, verifications, settings,
│                                      #   escrow, payouts, platform/seller wallets, suspend/unsuspend
├── socket/
│   └── index.js                       # JWT auth, chat events, presence, canChat() check
├── utils/
│   ├── AppError.js
│   ├── apiResponse.js                 # sendSuccess, sendPaginated
│   ├── asyncHandler.js
│   ├── generateTokens.js
│   ├── paginate.js
│   ├── paystack.js                    # initializeTransaction, verifyTransaction, refundCharge,
│   │                                  #   listBanks, resolveAccount, createTransferRecipient, initiateTransfer
│   ├── cronLock.js                    # withLock(name, leaseSeconds, fn) — Mongo-backed cron leases
│   ├── sendEmail.js                   # sendEmail + sendEmailSafe (fire-and-forget)
│   ├── emitNotification.js            # Socket.IO notification fan-out helper
│   ├── emailTemplates.js              # Branded HTML for every transactional email
│   └── resolveUrl.js                  # Convert legacy /uploads/* paths to absolute
└── scripts/
    ├── seedAdmin.js
    ├── seedContent.js
    ├── seedHelpAndFeed.js
    └── verifyEmail.js
```

---

## API Surface (`/api/v1`)

### Auth — `/auth`
Register, login, refresh, logout, `me`, send-verification, verify-email/`:token`, forgot-password, reset-password/`:token`, change-password.

### Profile — `/profiles`
GET / PATCH `/me`, POST `/me/avatar`, GET / PATCH `/me/settings`.

### Artisans — `/artisans`
`GET /` (filter `?category`, `?skill`, `?search`, `?page`, `?limit`)
`GET /nearby` (`?lat&lng&radiusKm`, optional `?city&state` fallback, `?category`, `?skill`)
`GET /me` (own artisan profile, protected)
`GET /:id`
`PATCH /onboarding` (skill, category, portfolio, certs, availability, rates, address, etc.)
`PATCH /location`
`POST /portfolio` (multipart, multi-image upload to Cloudinary)
`POST /certifications` (multipart, single file)

### Suppliers — `/suppliers`
`GET /me`, `PATCH /onboarding`, `POST /logo`.

### Products / Properties — `/products`, `/properties`
CRUD + filters. Restricted to suppliers for write operations.

### Orders — `/orders`
- `POST /` — create
- `GET /` — list (`?as=buyer|seller` overrides role default; `?status` filter)
- `GET /:id` — detail
- `PATCH /:id/status` — confirm / ship / cancel (with required reason). **`delivered` is rejected** here — use the dual-approval endpoint.
- `POST /:id/approve-delivery` — flips the caller's approval flag. Transitions to `delivered` only when **both** `buyerDeliveryApproved` and `supplierDeliveryApproved` are true AND `paymentStatus === 'paid'`. Pay-on-delivery: supplier passes `cashCollected: true` to also flip payment.

### Jobs — `/jobs`
- `POST /` — create (`bookingType: 'urgent' | 'scheduled'`, optional `scheduledDate`). Suspended artisans/clients are blocked.
- `GET /` — list (`?as=artisan|client`, `?status`, `?bookingType`)
- `GET /active` — in-progress jobs the user is part of (either side), with precomputed `daysRunning` + `costSoFar`
- `GET /:id`
- `POST /:id/accept` — artisan accepts pending request
- `POST /:id/reject` — artisan declines (required reason)
- `POST /:id/cancel` — either party cancels pending/accepted (required reason)
- `POST /:id/approve-start` — flip caller's start flag; transitions to `in_progress` when both flip
- `POST /:id/approve-end` — flip caller's end flag; transitions to `completed` when both flip, computes `daysCharged × dailyRate = totalAmount`
- `POST /:id/accept-work` — client confirms work meets standard. Atomically claims the held EscrowEntry and releases funds to the artisan's wallet (subject to platform hold period). Once accepted, no dispute can be raised — surfaced clearly in the client modal. Auto-fired by the daily cron after `workAcceptanceDays` if the client never acts.

### Wallet — `/wallet`
- `GET /me` — own wallet snapshot (3 buckets, feesOwed, pause flags, `holdHours`, `isNegative`)
- `GET /me/escrow` — held EscrowEntry rows for the caller
- `GET /me/transactions` — paginated WalletTransaction ledger

### Banks / Bank Accounts — `/banks`, `/bank-accounts`
- `GET /banks` — Paystack NG banks list (24h cache)
- `GET /banks/resolve?accountNumber=&bankCode=` — server-side name resolution
- `POST /bank-accounts` — save (creates Paystack `transfer_recipient`, soft KYC name match flags `nameMismatch`, duplicate `(profileId, accountNumber, bankCode)` returns 409)
- `GET /bank-accounts/me` — list own
- `DELETE /bank-accounts/:id` — blocked if a pending/processing payout uses this account

### Payouts — `/payouts`
- `POST /` — request payout (atomic conditional debit; rejects if globalPaused, withdrawalsPaused, negative balance, below minPayout, or insufficient available)
- `GET /me` — own history (with bank details populated)
- `GET /:id` — own payout detail

### Verification — `/verification`
- `POST /upload` — Cloudinary upload, returns `{ fileUrl }` (artisans/suppliers)
- `POST /` — submit request (`kind`, `businessName`, `documents[]`). Suppliers must include a `cac_certificate`.
- `GET /my` — list own requests with status + reviewer reasons

### Disputes — `/disputes`
- `POST /` — raise (`type: 'order'|'job'`, `orderId|jobId`, `reason`); validates user is party to the entity, blocks duplicate open disputes
- `GET /my`

### Chat — `/chat`
Conversations, messages by conversation, send (with `canChat` guard — must share a Job or Order, except admin), search by email.

### Notifications — `/notifications`
List, mark single read, mark all read.

### Reviews — `/reviews`, Bookmarks — `/bookmarks`
Standard CRUD.

### Payments — `/payments`
- `POST /initialize` — open a Paystack transaction. Job payments require `status === 'completed'` and use `totalAmount` (legacy `budget` fallback).
- `GET /verify` — verifies Paystack txn, **asserts charged amount matches expected**, marks paid, and creates the EscrowEntry (idempotent via `(paystackReference, sellerProfileId)` unique index — multi-supplier orders fan out one entry per supplier).
- `POST /webhook` — Paystack callback. Mounted with `express.raw` so the HMAC signature can be verified against the exact bytes Paystack signed. Handles `charge.success` (escrow create), `transfer.success` (payout completed), `transfer.failed` / `transfer.reversed` (payout failure → wallet credited back via `reversePayout`).

### Dashboard — `/dashboard`
Role-specific stats + recent orders.

### Admin — `/admin` (all gated by `protect` + `restrictTo('admin')`)
- `GET /stats` — 10 grouped metrics: activeUsers, activeArtisans, activeSellers, activeOrders, productsInStock, activeJobs, totalRevenue, pendingVerifications, openDisputes, newUsersThisMonth.
- `GET /page-stats?page=users|orders|products|jobs|verification|disputes` — per-page metric strips.
- `GET /analytics` — time-series + role split + top categories/artisans.
- `GET /users`, `GET /users/:id`, `PATCH /users/:id` (ban/role).
- `GET /orders`, `GET /products` + `PATCH /products/:id` (visibility toggle).
- Blog, Careers, Help, Feed: full CRUD.
- `GET /verifications`, `PATCH /verifications/:id` — approve / reject / **revoke** (reason required for reject and revoke). On revoke, `isVerified: false` is synced back to the seller's profile.
- `GET /disputes`, `PATCH /disputes/:id` — resolve / dismiss with admin note. `ruleFor: 'buyer'` auto-triggers the refund flow.
- `GET /settings`, `PATCH /settings`.

#### Admin — payments + wallets
- `GET /escrow` — list escrow entries
- `POST /escrow/:id/refund` — full or partial refund (Paystack rollback on Paystack failure; required reason)
- `POST /escrow/:id/release` — force-release an held entry (atomic claim, records `adminOverrideReason` + `adminOverrideBy`)
- `GET /payouts` — list payouts
- `POST /payouts/:id/release-now` — skip cooldown for a pending payout
- `POST /payouts/:id/cancel` — cancel a pending payout, refund the wallet
- `GET /wallets/platform` — platform fee wallet + recent ledger
- `GET /wallets/:profileId` — inspect any seller wallet + recent ledger
- `PATCH /wallets/:profileId` — toggle pause, set feeMode, custom hold/cooldown/min-payout (range-validated)
- `POST /wallets/:profileId/adjust` — manual ledger entry (whitelisted bucket + non-zero amount + reason)
- `POST /wallets/:profileId/suspend` — suspend seller (blocks new orders/jobs at controller level, force-pauses payouts, notifies seller)
- `POST /wallets/:profileId/unsuspend` — reinstate (keeps payouts paused if wallet still negative)
- `POST /wallets/:profileId/send-fee-reminder` — manual nudge for outstanding feesOwed
- `POST /settings/global-pause` — emergency global payouts kill switch

### Public CMS — `/blog`, `/careers`, `/help`, `/feed`
Read-only public endpoints serving published content for the public website.

### Health / Contact
`GET /health`, `POST /contact`.

---

## Real-Time (Socket.IO)

Authenticated handshake (`auth: { token }`) joins each socket to `user:{userId}`.

| Client → Server          | Payload                              | Description                      |
|--------------------------|--------------------------------------|----------------------------------|
| `message:send`           | `{ receiverId, content }`            | Returns ack with saved message   |
| `message:read`           | `{ conversationId }`                 | Mark messages as read            |
| `typing:start` / `stop`  | `{ conversationId }`                 |                                  |
| `user:check-online`      | `{ profileIds: string[] }`           | Returns presence map             |

| Server → Client          | Payload                              | Description                      |
|--------------------------|--------------------------------------|----------------------------------|
| `message:new`            | `ChatMessage`                        |                                  |
| `conversation:updated`   | `{ conversationId, lastMessage }`    |                                  |
| `message:read`           | `{ conversationId }`                 | Read receipt                     |
| `typing:start` / `stop`  | `{ conversationId }`                 |                                  |
| `user:online` / `offline`| `{ profileId }`                      |                                  |
| `notification:new`       | `Notification`                       | Drives the bell + admin header   |

Chat **access control**: the `canChat()` check requires participants to share a Job (client ↔ artisan) or Order (buyer ↔ supplier). Admins bypass.

---

## Notable Behaviour

- **Cross-role views**: `/orders?as=buyer|seller` and `/jobs?as=artisan|client` let any role see whichever side they're acting on.
- **Verification kinds**: `kind: 'business'` (suppliers — CAC required) vs `kind: 'individual'` (artisans — government ID).
- **Dual-approval flows**: jobs require both parties to approve start (→ `in_progress`) and end (→ `completed`). Orders require both parties to approve delivery (→ `delivered`), with a payment guard.
- **Cancellation reasons**: jobs and orders both record the reason and the cancelling side, surfaced to the other party in their dashboard.
- **Admin notifications**: verification submissions fan-out to every admin in real time.
- **Defensive geo**: `/artisans/nearby` only includes docs with valid GeoJSON Points and falls back to `?city`/`?state` matching when geo returns nothing.

---

## Escrow + Payouts Pipeline

All amounts are stored in **kobo** (integers). NGN-denominated `Order.totalAmount` / `Job.totalAmount` are converted via `toKobo` at boundaries.

### Buyer pays → escrow held
1. `POST /payments/initialize` opens a Paystack transaction.
2. Buyer completes payment on Paystack hosted page.
3. Either `GET /payments/verify` (browser redirect) or `POST /payments/webhook` (server-to-server) lands first — both are idempotent. Each:
   - asserts `data.amount === toKobo(expected)` before marking paid;
   - calls `createEscrowFor` which inserts one `EscrowEntry` per supplier (multi-supplier orders) or one for the artisan (jobs);
   - calls `creditEscrow` to bump each seller's `pendingBalance`;
   - sets `Job.workAutoAcceptAt = now + workAcceptanceDays` for jobs.
4. Unique index on `(paystackReference, sellerProfileId)` makes step 3 race-safe (E11000 from a duplicate insert is swallowed).

### Release condition met → pending → holding
- **Orders**: dual-approval delivery (`buyerDeliveryApproved && supplierDeliveryApproved && paymentStatus === 'paid'`) transitions to `delivered`, atomically claims each held EscrowEntry, calls `releaseEscrow`. COD orders (no escrow) accrue platform fee to seller's `feesOwed` instead.
- **Jobs**: client clicks "Accept work", or daily cron auto-accepts after `workAutoAcceptAt`.
- `releaseEscrow` computes `feeAmount = floor(amount * bps / 10000)` (orderFeeBps or jobFeeBps), debits `pending` by gross, credits `holding` by net, and either credits the platform wallet (per_transaction) or accrues to `feesOwed` (scheduled). `availableAt = now + holdHours`.

### Hold expires → holding → available
- Hourly cron at `:05` (`expireHoldPeriod`). Aggregation finds `escrow_release` ledger rows past `availableAt` with no paired `hold_expire`. Each candidate is atomically claimed via `promotedAt`, then walked through `applyDelta` to debit `holding` + credit `available`.

### Seller withdraws
1. `POST /payouts` — atomic conditional `findOneAndUpdate({ availableBalance: { $gte: amount }, withdrawalsPaused: { $ne: true } }, { $inc: { availableBalance: -amount } })`. If null, throws 400.
2. `PayoutRequest` row created with `status: 'pending'`, `scheduledFor = now + payoutReviewHours`.
3. Hourly cron at `:15` (`processPayoutCooldown`) atomically claims pending → processing, fires `initiateTransfer` with stable reference `payout_<id>` (so retries don't double-disburse).
4. `transfer.success` webhook → `status: completed`. `transfer.failed` / `transfer.reversed` → `status: failed`, wallet credited back via `reversePayout`.

### Refunds
- `issueRefund` (admin endpoint or dispute resolver):
  - Held entry → just call Paystack refund.
  - Released entry → `refundFromSeller` first (re-reads wallet per bucket; allows `available` to go negative; force-pauses payouts when negative), THEN Paystack refund. If Paystack call throws, the seller debit is reversed via `reversePayout`.

### Suspension
- `Profile.isSuspended` blocks new order/job creation at the controller layer.
- Admin endpoints `suspendSeller` / `unsuspendSeller` set the flag, sync `Wallet.withdrawalsPaused`, and fan out notifications.
- Public artisan + supplier endpoints expose `isSuspended` so the client UI can show "Currently unavailable" banners and disable hire/order CTAs.

### Cron coordination (multi-instance safe)
Each `cron.schedule(...)` handler is wrapped in `withLock(name, leaseSeconds, fn)`:
- Tries `findOneAndUpdate({ name, expiresAt: { $lte: now } }, { $set: { expiresAt: now + lease, ownedBy } }, { upsert: true })`.
- If we own the upserted doc, run. Otherwise skip — another instance is on it.
- TTL on `expiresAt` auto-cleans crashed leases.

### Idempotency + atomicity guards
| Concern                              | Guard                                                                        |
|--------------------------------------|------------------------------------------------------------------------------|
| Verify + webhook racing              | `(paystackReference, sellerProfileId)` unique index on EscrowEntry           |
| Double-release on parallel acceptWork | Atomic `EscrowEntry.findOneAndUpdate({ status: 'held' }, { status: 'released' })` |
| Two payouts draining wallet          | Atomic conditional `Wallet.findOneAndUpdate({ availableBalance: { $gte } })` |
| Cron firing in two instances         | `withLock` — Mongo CronLock with TTL                                         |
| Hold-expire cron racing itself       | Atomic `WalletTransaction.findOneAndUpdate({ promotedAt: { $exists: false } })` |
| Paystack transfer retried with new ref | Stable `payout_<id>` reference                                              |
| Webhook signature on parsed JSON     | `express.raw` keeps the raw buffer for HMAC                                  |
| Refund debited but Paystack failed   | `refundFromSeller` rollback in catch                                         |
| Platform wallet duplicates on boot   | Unique partial index on `isPlatform: true` + upsert `getPlatform`            |
| Typo'd bucket name silently mutating | Bucket whitelist in `applyDelta`                                             |

---

## Scripts

| Command         | Description                  |
|-----------------|------------------------------|
| `npm run dev`   | Nodemon (hot reload)         |
| `npm start`     | Production                   |
| `npm run lint`  | ESLint (when configured)     |
