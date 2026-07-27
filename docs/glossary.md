# Glossary

_Last updated: 2026-07-27 · The domain language — keep code, UI, and docs on these exact terms._

## Roles

- **Client** — consumer who browses, saves, hires artisans, buys products, books property viewings.
- **Artisan** — service provider (tiler, POP installer, welder, painter…) with a profile, portfolio (→ pins), skills, geolocation, verification status.
- **Supplier** — seller of products (materials, furniture) and/or properties; business-verified.
- **Admin** — platform operator; moderates content, resolves disputes, manages verification.

## Feed (pivot vocabulary — use these, not synonyms)

- **Pin** — the atomic feed unit: one image or video + metadata, always attributed to an author. Never "post" or "card" in code/UI.
- **Native pin** — uploaded directly by an artisan/supplier through the create flow.
- **Derived pin** — auto-generated from a Product, Property, or legacy portfolio/FeedPost; stays in sync with its source.
- **Board** — a user's named collection of saved pins (e.g. "My Kitchen Project"). Public by default; private is enforced server-side.
- **Save** — adding a pin to a board; the platform's core engagement signal.
- **Follow** — subscribing to an author; boosts their pins in your feed.
- **Taxonomy** — a pin's three market axes: **trade** (skill), **room** (space), **budget band** (₦ tier) + free tags.
- **WCAF** — Weekly Commerce Actions from Feed; the north-star metric (quotes + orders + viewings originating from a pin).

## Marketplace & money

- **Job** — a client's work request to an artisan. **Quote** — an artisan's priced offer on a job.
- **Appointment / Viewing** — scheduled meeting (artisan consult or property viewing).
- **Order** — a product purchase through cart/checkout.
- **Escrow** — client's payment held by the platform (EscrowEntry) until the **hold period** elapses, then released to the seller's **wallet**.
- **Wallet** — a seller's platform balance; mutated only by append-only **WalletTransactions**.
- **Payout** — wallet → bank transfer via Paystack, after a **cooldown**; confirmed/reversed by webhook.
- **Dispute** — a client/seller conflict that freezes the related escrow until admin resolution.
- **Kobo** — all money is stored as integer kobo (₦1 = 100 kobo). Never floats.

## Verification

- **Email verification** — account-level gate (all roles).
- **Platform verification** — admin-reviewed artisan/supplier credibility (VerificationRequest → verified badge).
- **Meta business verification** — Meta's review of the CAC-registered business; currently the blocker shelving the WhatsApp bot. Distinct from platform verification.

## Infrastructure shorthand

- **Server / API** — `server/` on Railway at api.sintherior.com.
- **Client / website** — `sinterior-client/` on Vercel at sintherior.com.
- **Bot** — `whatsapp-bot/` on Railway at bot.sintherior.com (shelved; isolated DB `sintherior-bot`).
- **Mobile app** — planned fourth surface; same API, feed-first.
- **DRY_RUN** — bot mode where outbound WhatsApp sends are logged, not sent (dev default).
- **CronLock** — Mongo lease preventing scheduled jobs double-firing.
