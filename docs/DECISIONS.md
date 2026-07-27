# Decision Log

_Platform-canonical decision log — other repos reference this file._

_Newest first. Every entry: date · decision · why · what it forecloses._

## 2026-07-27 — Pinterest-style pivot: four scope decisions
1. **Feed becomes home** — sintherior.com lands on the masonry feed; old home → `/about`. Full commitment to inspiration-first identity.
2. **Native pin creation: artisans + suppliers only** (clients browse/save/act). Keeps every pin commercially actionable and moderation load low.
3. **Engagement = saves + boards + follows; no likes/comments in v1.** Saves are the only engagement currency → saving must be one-tap frictionless.
4. **Video ships in v1** (overriding an images-first recommendation) — with guardrails: ≤60s, 720p transcode cap, poster + tap-to-play, no autoplay on mobile data, monthly Cloudinary cost review + images-only kill-switch.

Also: **Pin becomes the canonical entity** for feed media (derived pins auto-upsert from Products/Properties; legacy embedded portfolios backfilled once, then read-only). Docs restructured to cover all four surfaces (server, website, bot, mobile app).

## 2026-07-27 — WhatsApp bot shelved (Meta business verification failed)
Meta business verification could not be obtained; client is pursuing it. Bot stays deployed on Railway (near-zero idle cost, minutes to resume — resume checklist in the bot repo's docs/build-plan.md). Priority shifted to the feed pivot. Forecloses: no WhatsApp channel until verification clears; the 250-contact unverified tier was deemed not worth going live on.

## 2026-07-27 — Mobile app: React Native + Expo (decided)
Feed-first native app consuming the same API. Stack: **React Native + Expo** — Sawyer has RN experience and a paid Expo account (EAS builds/updates available day one); TS continuity with the web client. Forecloses: no Flutter/native-Swift/Kotlin track.

## 2026-07-27 — Docs split per repo (no monorepo)
The three (soon four) codebases are independent git repos; a workspace-root docs folder would be unversioned and cross-cutting. Each repo carries its own tailored `/docs`; the **server repo holds the platform-canonical** north-star, glossary, and this decision log (server is the hub every surface consumes). Other repos keep repo-scoped docs and point here for platform context.

## 2026-07-04 — Legacy uploads purged instead of migrated
All 10 DB references to dead `/uploads/` disk files nulled (8 chat attachments pulled, 2 avatars unset; backup JSON retained). The physical files died with Render's disk; hand-matching survivors was disproportionate. Forecloses: those assets are gone; affected users re-upload.

## 2026-07-04 — Vercel production tracks `v1.1`
Production branch corrected from `master` (repo's live branch is `v1.1`). Every push to `v1.1` is a production release.

## 2026-07-04 — Migrated all backend compute Render → Railway (paid)
Render free tier's 15-min spin-down + shared instance-hours were unusable for webhook receivers; paid Railway removes keep-alive hacks. Custom domains: api/bot.sintherior.com (Vercel DNS). Render services suspended. Forecloses: Render configs are dead; do not resurrect.

## 2026-07-04 — Paystack webhook re-pointed; server stays on test key
Webhook URL set (Live + Test) to the Railway host. Live-key swap deferred — an explicit client decision, one Railway variable when taken.

## 2026-06-25 — Official Meta Cloud API over unofficial (Baileys)
Business is CAC-registered → pursue official verification; bot code already speaks Cloud API and is transport-abstracted (`src/services/whatsapp.js`). Fallback if self-serve verification failed: BSP 360dialog PLBV. (Superseded in practice by the 2026-07-27 shelving; architecture choice stands.)

## 2026-06-09 — WhatsApp bot isolated from the web marketplace
Own phone-keyed models + own Mongo DB (`sintherior-bot`), API-only admin. The web app's email/password models don't fit WhatsApp phone-keyed users. Forecloses: no shared collections between bot and web app.

## 2026-07-27 — Feed M0 contract decisions
Budget bands: **explicit ₦ ranges** (5 band ids with kobo ranges server-side: under-100k / 100k-500k / 500k-2m / 2m-10m / 10m-plus). View counts: **schema now, tracking endpoint P2** — saves are v1's only live ranking signal. Taxonomy (trades/rooms/bands): **server-side code constants** exposed at `GET /api/v1/pins/taxonomy`; trade ids reuse the client's existing skill-category ids; changes require a commit (deliberate churn). Rooms are nullable on pins.
