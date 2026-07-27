# Feature Map — Server view

_Last updated: 2026-07-27 · Phases: **P1** = feed launch · **P2** = fast-follow · **P3** = growth · **Live** = already shipped_

Website-UI-only rows are condensed to cross-references here; the full UI feature list lives in the client repo's docs.

## Feed (the pivot — see prd.md)

| Feature | Phase |
|---|---|
| Pin entity + backfill from portfolios/products/properties | P1 |
| Feed endpoint: ranking aggregation + cursor pagination (client renders masonry SSR feed, pin modal `/pin/[id]` — see client repo docs) | P1 |
| Save to boards; board management; boards on profile | P1 |
| Follow artisans/suppliers + feed boost | P1 |
| Native pin upload (image + ≤60s video, tap-to-play) | P1 |
| Filters (trade/room/budget) + text search | P1 |
| Admin moderation (hide/remove/feature) | P1 |
| Pin view/save counters + artisan-facing stats | P2 |
| Notifications: followed author posted, pin saved | P2 |
| Pin reporting (user-flagged) | P2 |
| Budget bands surfaced across all pin types | P2 |
| SEO: pin/board indexing polish, sitemaps for pins (client-rendered — see client repo docs) | P2 |
| Onboarding taste-picker → affinity seed (client UI — see client repo docs) | P3 |
| "More like this" (tag/taxonomy related pins) | P3 |
| Autoplay-on-WiFi setting (client UI — see client repo docs) | P3 |
| Search overhaul (facets, typo-tolerance) | P3 |

## Marketplace (existing, stays)

| Feature | Phase |
|---|---|
| Auth (JWT + refresh cookie), 3 roles, email verification | Live |
| Artisan discovery/geolocation search, profiles, portfolios | Live |
| Products, cart, checkout, orders; properties + viewings | Live |
| Jobs, quotes, appointments, projects | Live |
| Paystack payments, escrow, wallets, payouts, disputes | Live |
| Real-time chat (Socket.IO), notifications | Live |
| Admin panel (users, verification, disputes, content, analytics) | Live |
| Blog, careers, help center, contact | Live |
| Paystack live-key switch (client decision) | Parked |

## Mobile app (new surface — consumes this API)

| Feature | Phase |
|---|---|
| Stack decision (recommendation: React Native + Expo) | P2 — decide during P1 |
| Feed, pin detail, boards, follows against same API | P2 |
| Auth reusing JWT flow; secure token storage | P2 |
| Native share-to-WhatsApp, camera-roll pin upload | P2 |
| Push notifications (requires server FCM/APNs work) | P3 |
| Offline board viewing | P3 |

## WhatsApp bot (shelved — resumable)

| Feature | Phase |
|---|---|
| Full conversational flows (register/search/estimate/track), admin API, broadcast | Built |
| Meta business verification → webhook go-live | **Blocked on client** |
| Permanent System-User token + live round-trip test | On unblock |
| Feed→WhatsApp bridge (share pin to bot, bot replies with artisan card) | P3 idea |

## Won't build (recorded so we stop re-discussing)

Likes/comments (v1), client-authored pins, ads/promoted pins, ML visual search, native video >60s.
