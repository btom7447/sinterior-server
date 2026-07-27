# PRD — Sintherior Feed (Pinterest-style pivot) · Server scope

_Last updated: 2026-07-27 · Owner: Sawyer · Status: approved for build_

This is the platform feed PRD tailored to the **server's** responsibilities: the Pin/Board/BoardPin/Follow data layer, the pins/boards/follows/feed API, derived-pin upsert hooks, the backfill script, ranking, WCAF instrumentation, and video upload/transcode constraints. Web rendering details live in the client repo's docs.

## Problem

Clients plan visually but our discovery is search-first ("find a plumber"). The inspiration behavior already happens — in WhatsApp saved images and Instagram screenshots — disconnected from hireable artisans and buyable products. We lose the highest-intent moment: "I want *this* — who made it?"

## Solution

Make the feed the app. `sintherior.com` lands on a masonry grid of artisan work, products, and properties. Users save pins to project boards, follow artisans, and act on any pin through the existing quote/order/viewing flows. The server provides the entire data layer and API for this — designed surface-agnostic so web and the planned mobile app consume the same endpoints.

## Decisions (locked 2026-07-27 — see DECISIONS.md)

1. **Feed becomes home** — replaces the current landing page; old home content moves to `/about` (client-side change).
2. **Native pin creation: artisans + suppliers only** (plus auto-derived pins). Clients browse/save/act. Enforce with role guards on pin creation routes.
3. **Engagement = saves + boards + follows.** No likes or comments in v1.
4. **Video ships in v1** — with hard data-cost guardrails (below).

## Users & stories (server-relevant slice)

**Client (browser/buyer)**
- Browse the feed without an account; filter by trade / room / budget band — public, paginated feed endpoint.
- Save a pin to a named board in one tap — board picker after the save, never a form first (API must support save-then-assign).
- Open a pin → author, details, price/budget context → **Request quote / Add to cart / Book viewing** wired to existing flows.
- Follow an artisan; followed authors boost in my feed (ranking input).
- Share any pin to WhatsApp via a real URL (client renders `/pin/[id]` — see client repo docs).

**Artisan / Supplier (creator/seller)**
- Existing portfolio/products appear as pins automatically — zero work to be in the feed (derived pins + backfill).
- Post a new pin (image or ≤60s video) with title, caption, trade, room, optional budget band, tags.
- See per-pin saves/views (P2) — evidence the platform brings work.

**Admin**
- Hide/remove any pin; existing admin feed tooling repurposed for moderation.

## Functional requirements — v1 (server view)

| # | Requirement |
|---|---|
| F1 | `Pin` is a first-class entity (see system-architecture.md). Derived pins auto-upsert from Product/Property create/update; one-time backfill seeds launch content from existing portfolios, products, properties. |
| F2 | Cursor-paginated feed endpoint with server-stored aspect ratio (client renders SSR masonry with no layout shift — see client repo docs). |
| F3 | Pin detail data for `/pin/[id]` with commerce CTA context wired to existing quote/cart/viewing flows (client renders the modal/intercepted route — see client repo docs). |
| F4 | Boards: create, rename, delete; save/unsave pin to board(s); board gallery on profile. |
| F5 | Follow/unfollow artisans & suppliers; feed boost for followed authors. |
| F6 | Native pin upload for artisan/supplier roles: image or video ≤60s, Cloudinary transcode capped 720p + auto poster frame, aspect ratio captured server-side. |
| F7 | Video guardrail: server stores poster frame + video URL; clients render **tap-to-play only** — no autoplay on mobile data (client rendering — see client repo docs). |
| F8 | Filterable feed: trade, room, budget band. Text search over title/caption/tags. (Chip UI is client-side — see client repo docs.) |
| F9 | Ranking: single Mongo aggregation — recency + save-velocity + followed-author boost + save-history category affinity + author diversity (no 3 consecutive pins from one author). |
| F10 | Admin: hide/remove pin, feature pin. Existing `FeedPost` admin cards become admin-authored pins. |

## Non-goals (v1)

Likes, comments, DMs beyond existing chat, ML personalization, visual search, autoplay video, client-authored pins, pin ads/promotion.

## Success metrics

- **WCAF** (north-star): commerce actions originating from a pin — instrument `source=pin:<id>` on quote/order/viewing creation.
- Save rate ≥ 5% of pin opens; D7 retention of users with ≥1 board noticeably above baseline; ≥30% of active artisans post natively within 60 days.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Video bandwidth costs (Cloudinary) | 720p cap, 60s cap, tap-to-play, monthly cost review — kill-switch to images-only if runaway |
| Low-quality uploads polluting feed | Ranking demotes zero-save pins fast; admin remove; upload rate-limit per author |
| SEO regression from replacing home | Client-side mitigation (SSR first feed page, `/about` keeps marketing copy, pin pages indexable — see client repo docs) |
| Derived pins drift from inventory | Upsert hooks on Product/Property mutations, not batch sync |

## Mobile app note

The mobile app (see north-star.md) ships the same feed-first experience against the same API. This PRD's API surface (pins, boards, follows, ranking) is designed surface-agnostic; nothing here is web-only except the Next.js rendering details (which live in the client repo).
