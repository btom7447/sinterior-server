# Sintherior — North Star

_Last updated: 2026-07-27 · Platform-canonical (this repo is the hub every surface consumes)._

## Vision

**The visual front door to Nigerian construction and interior design.** People plan builds and renovations with pictures — saved WhatsApp images, Instagram screenshots — disconnected from anyone who can actually do the work. Sintherior closes that gap: every image on the platform is attached to a verified artisan you can hire, a product you can buy, or a property you can view. Inspiration and transaction in one loop.

## North-star metric

**Weekly Commerce Actions from Feed (WCAF):** quote requests + orders + viewing bookings that originate from a pin.

This single number captures the whole thesis — content is working (people browse), trust is working (people act), and supply is working (there's something worth acting on). Supporting metrics: weekly saves, D7 retention of savers, artisan posting rate, save→quote conversion.

## Strategy

1. **Inspiration-first discovery.** The feed is the product. Search ("find a plumber") is the fallback, not the front door. Pins carry the three axes this market thinks in: **trade, room, budget band**.
2. **Supply-side cold start is solved structurally, not socially.** Pins are auto-derived from every portfolio item, product, and property already on the platform — the feed is full on day one without waiting for creator adoption.
3. **Every pin terminates in commerce.** The pin modal leads with the CTA (Request quote / Add to cart / Book viewing). We are a marketplace wearing an inspiration app's clothes, not the reverse.
4. **Artisan retention through vanity + money.** Artisans stay because pins bring them jobs AND because we show them "your pin got 40 saves." Both loops matter.
5. **Built for Nigerian mobile reality.** Data-cost-aware media (poster frames, tap-to-play video, capped 720p), WhatsApp-shareable pin URLs, mobile-first layouts.

## Surfaces

| Surface | Role | Status |
|---|---|---|
| **Server** (`server/`) | Single API + realtime hub for all surfaces | Live (Railway, api.sintherior.com) |
| **Website** (`sinterior-client/`) | Primary product — feed-first after the Pinterest pivot | Live (Vercel, sintherior.com); pivot in build |
| **Mobile app** | Feed-first native packaging of the same experience, same API | Planned — stack decision pending (leaning React Native/Expo) |
| **WhatsApp bot** (`whatsapp-bot/`) | Conversational marketplace access for low-bandwidth users | Built & deployed; **shelved** pending Meta business verification |

## What we are not

- Not a social network — no comments/DMs-for-fun in v1; chat exists to close deals.
- Not a content platform monetized by ads — monetization rides transactions (escrow fees), not attention.
- Not a directory — listings without imagery are second-class citizens by design.
