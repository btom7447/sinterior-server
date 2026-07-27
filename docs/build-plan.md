# Build Plan — Feed Pivot (Server view)

_Last updated: 2026-07-27 · Timeline assumes one primary builder + Claude, part-week availability. Dates are targets, not promises._

Server-scoped items are listed in full; client-side items are one-line cross-references (full detail in the client repo's docs).

## Milestone 0 — Foundations (≈3–4 days) → target ~Aug 1

Server-side data layer, no user-visible change. **This milestone is entirely in this repo.**

- [ ] `Pin`, `Board`, `BoardPin`, `Follow` models + indexes
- [ ] Pin CRUD routes (`/api/v1/pins`) with role guards; board + follow routes
- [ ] Derived-pin upsert hooks on Product/Property mutations
- [ ] Backfill script: portfolios + products + properties + published FeedPosts → Pins (idempotent, dry-run flag)
- [ ] Ranking aggregation + cursor pagination endpoint (`/api/v1/pins/feed`)

**DoD:** backfill run against a staging copy produces a populated, correctly-ranked feed via curl; all new routes covered by validator rules; no client changes deployed.

## Milestone 1 — The feed ships (≈1.5–2 weeks) → target ~Aug 14

- Client: masonry home at `/`, pin modal `/pin/[id]`, save flow UI, follow buttons, filter chips + search UI, old home → `/about`, nav rework — see client repo docs.
- [ ] Admin: hide/remove/feature pin (repurpose admin feed screens)
- [ ] WCAF instrumentation: `source=pin:<id>` recorded on quote/order/viewing creation

**DoD:** a logged-out visitor lands on a full feed; can open, share, and (after signup) save a pin and request a quote from it; Lighthouse mobile ≥ 85 on the feed; zero CLS from images.

## Milestone 2 — Native creation + video (≈1 week) → target ~Aug 21

- [ ] Artisan/supplier "Create pin" flow (server side): image or ≤60s video, Cloudinary transcode (720p cap) + poster frame, taxonomy fields, per-author upload rate limit — client upload UI in client repo docs
- Client: tap-to-play video cells in feed + modal player — see client repo docs.
- [ ] Cloudinary cost dashboard check + images-only kill-switch flag

**DoD:** an artisan posts a video pin from a phone on mobile data; it appears in the feed with a poster frame and plays on tap; transcodes verified ≤720p.

## Milestone 3 — Retention loops (P2, ≈1–1.5 weeks) → target ~Sep 1

- [ ] Pin counters (views/saves) + artisan stats ("your pin got 40 saves")
- [ ] Notifications: followed author posted; your pin was saved
- [ ] Pin reporting + moderation queue
- Client: SEO — pin sitemap, board pages, structured data — see client repo docs.

**DoD:** artisan sees per-pin stats; reported pins reach admin queue; pins indexed.

## Milestone 4 — Mobile app spike (parallel to M3)

- [ ] Decide stack (recommendation: React Native + Expo) — log in DECISIONS.md
- [ ] Spike: auth + feed + pin modal against production API
- [ ] Scope v1 mobile release from spike learnings

## Parked (unblock conditions)

| Item | Unblocks when |
|---|---|
| WhatsApp bot go-live | Client obtains Meta business verification |
| Paystack live key swap | Client authorizes live payments |

## Standing rules

Every milestone lands as deployable increments behind the existing deploy flow (Railway auto-deploy on push, Vercel prod branch v1.1). Docs move with code — schema or scope changes update prd.md / system-architecture.md in the same unit of work. Money paths (escrow/wallet) are untouched by this pivot; any incidental change to them requires explicit review.
