# Decision Log

_Platform-canonical decision log — other repos reference this file._

_Newest first. Every entry: date · decision · why · what it forecloses._

## 2026-08-01 — All line pricing resolves in config/pricing.js, and nowhere else

Three things can decide what one line costs: the base price, the variant chosen,
and how many are being bought. One pure module resolves all three, and every
money path downstream — the escrow split, the supplier payout, the buyer's card
— derives from what it returns. Two implementations would eventually disagree
about what somebody owes.

Rules that hold throughout: **variant prices are absolute, never deltas** (a
"+₦500 for the large one" compounds unpredictably against a bulk tier and
neither party can work out the result); **the cheapest applicable price wins**,
so tiers entered out of order still charge what was meant; and **SKU keys are
canonical and sorted**, computed server-side and never accepted from a client,
because the key is what the stock decrement matches on.

The client mirrors this in lib/pricing.ts with the same tests written against
both, including one pinning the key format byte for byte. The server stays the
authority — it re-prices every order — but a cart that quotes the single-unit
price on a bulk order overstates the total by design.

Forecloses: no pricing arithmetic in a screen, a hook or a controller.

## 2026-08-01 — A pre-order is never judged on stock

`fulfilment` is 'stocked' or 'preorder'. A pre-order is by definition a thing
the supplier does not have, so treating it as ordinary stock would mean the only
listings nobody can order are exactly the ones that exist to be ordered in
advance. anyStock always passes them, priceLine reports no ceiling, check-stock
never calls them sold out, update stops deriving inStock from a count they do
not keep, and order creation skips the decrement entirely.

The line snapshots that it was a pre-order when placed, like the name and the
price, so a supplier who later starts stocking the item cannot make an old order
look as though it should have arrived in days.

## 2026-08-01 — Second-level vocabulary is fixed, not free text

config/catalogue.js holds the subcategories. Free text produces "Porcelain",
"porcelain tiles" and "Porcelian" within a week and a filter over them matches
none of the three. A subcategory borrowed from another category is dropped on
write rather than stored.

Facet rails are built from live listings rather than from the vocabulary, so a
rail can never offer something nobody stocks — tapping a dead filter teaches the
shopper the shop is empty. Brand became a first-class field for the same reason
it matters here at all: on a materials marketplace people buy Dangote or BUA,
not "cement", and it was buried inside the name string.

Forecloses: no free-text subcategories, and no filter rail generated from a
constant.

## 2026-08-01 — Reviews are of a seller, never of a product

`Product.rating` and `Product.reviewCount` exist on the schema and are written
by nothing — no controller, no script, no job. Anything reading them would show
every item in the shop as unrated forever. Reviews on this marketplace attach to
a **Profile**, gated on a delivered order or an accepted job with that person,
and `recomputeAggregates` writes the average onto the role's detail profile.

Product detail attaches the seller's standing (`product.seller`) rather than the
product's own dead fields. The list route deliberately does not: a grid of cards
from one seller would repeat the same score down the page.

Forecloses: no product-level ratings without a schema change — `Review` has no
`productId`, so the same bag of cement from two sellers cannot be scored
separately. The dead fields are left in place rather than dropped, because the
web client may read them; treat them as always zero.

## 2026-08-01 — Both role detail profiles are scaffolded at signup

Registration created an `ArtisanProfile` for artisans and nothing for suppliers.
That row is where a review's recomputed average lands, so a supplier who never
edited their storefront had nowhere for a rating to live — and recompute updated
both collections relying on exactly one matching, so when neither did it
silently no-opped. The review row survived; the score it earned did not.

Signup now scaffolds both. Recompute resolves the profile's role first and
upserts into the one collection that belongs to it. Upserting both would give
every reviewed profile an artisan record and a supplier record.

Forecloses: nothing may assume a detail row is absent as a signal of "not
onboarded yet" — an empty `SupplierProfile` now exists from registration.

## 2026-08-01 — Ref comparisons go through `utils/refId.js`

A Mongoose ref is an ObjectId until someone adds a `.populate()` upstream, at
which point `ref.toString()` returns the document rather than its id, and every
`ref.toString() === id` comparison silently stops matching. Adding a populate to
`getById` would have refused every supplier their own order; the same pattern
appears in the escrow split and the COD fee accrual, where being wrong misroutes
money.

All four sites read through `refId` / `isSameRef`. Forecloses: hand-rolled
`.toString()` comparisons on refs — new ones should be treated as a review
finding, not a style preference.

## 2026-07-30 — Staff are unsearchable; reporting replaces them

`GET /profiles/search` now excludes `role: 'admin'` and the caller. An admin
account findable by name means members opening private threads about jobs that
nothing is logged against, answered by whoever happens to be online — and it
makes impersonation trivial, since anyone can call themselves Sintherior Support.

The cost is that a member had no way to reach staff from inside a thread, so the
report control in the chat header is the replacement, and staff who do open a
conversation carry a verified badge (`isStaff`) so the absence of one is
meaningful.

Admin tooling for the resulting queue is **not built** — see ops-playbook.md,
"Chat reports". Reports currently have to be read out of Atlas.

## 2026-07-29 — Discovery gets three real axes, and ranking gets a denominator

The app had one working way to slice pins (trade), so every discovery surface was a variation on the same nineteen rails. Four decisions, taken together as the discovery model:

1. **Rooms are a first-class second axis.** Rooms already existed on the Pin but were only rendered as a chip. They are now a picker in create, a filter in the feed API, and the basis of intersection rails. The intersection is the point: "tiling" is a category, "tiling in bathrooms" is an idea, and only the second is worth a rail. Cost: two axes multiply, so rail generation is combinatorial and capped client-side.

2. **Tags are derived from a controlled vocabulary, never typed.** `src/config/vocabulary.js` holds ~50 Nigerian construction and interior terms (materials, styles, places) with their synonyms; the server reads them out of a pin's title and caption on create and on edit. This forecloses free-text hashtags: no user-authored tags, no autocomplete that writes new ones. Rationale: asking an artisan to hand-write tags after a twelve-hour job yields empty arrays, and free text yields "POP", "P.O.P" and "Pop Celing" as three separate tags. Growing the vocabulary is a commit plus a re-run of `src/scripts/backfillPinTags.js`, deliberately, like the taxonomy.

3. **Boards are the social layer.** They stay public by default and gain followers (`BoardFollow`, profile to board, mirroring `Follow`'s no-denormalized-counters rule). Featured boards rank on follower count. Following a person and following a board stay separate concepts, because a good curator is rarely the same account as a good maker.

4. **`counters.views` is live, and ranking has a denominator.** Supersedes "view counts: schema now, tracking endpoint P2" (2026-07-27). `POST /pins/:id/view` is public and unauthenticated; the client sends at most one per pin per session, and only when a pin is actually opened. `sort=top` is now dominated by the save-through rate (saves divided by max(views, 25)) with a capped absolute-saves term, so it stops rewarding whatever has been up longest. The endpoint is inflatable by design: it affects ranking only, never money or access. If gaming appears, the fix is a signed short-lived token issued with the pin, not auth.

Rejected: a separate "categories" concept on top of trades. Trades already are the categories; a third naming system would mean three places to keep in sync and three ways to file the same kitchen.

Also reverses part of the 2026-07-27 decision "no likes/comments in v1" — both shipped 2026-07-28.

## 2026-07-27 — SCOPE CORRECTION: the Pinterest-first surface is the MOBILE APP, not the website
Supersedes the "feed becomes home" decision below. The website keeps its original landing page and structure unchanged; the Pinterest-style pin feed lives on the web at **/feed** (restyled to match the mobile app, replacing the old admin-curated feed page). The mobile app (React Native + Expo) is the surface whose entry route is the feed. All server-side feed work (Pin/Board/Follow API, ranking, backfill) is surface-agnostic and unaffected. The home-swap that briefly shipped was reverted the same day (client `6fdf19c`).

## 2026-07-27 — Feed M0 contract decisions
Budget bands: **explicit ₦ ranges** (5 band ids with kobo ranges server-side: under-100k / 100k-500k / 500k-2m / 2m-10m / 10m-plus). View counts: **schema now, tracking endpoint P2** — saves are v1's only live ranking signal. Taxonomy (trades/rooms/bands): **server-side code constants** exposed at `GET /api/v1/pins/taxonomy`; trade ids reuse the client's existing skill-category ids; changes require a commit (deliberate churn). Rooms are nullable on pins.

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
