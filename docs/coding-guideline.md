# Coding Guideline — Server

_Last updated: 2026-07-27 · Tags: **[LINT]** automatable · **[TEST]** needs a test · **[REVIEW]** human judgment_

Adapts Sawyer's house style to this codebase's reality (JS ESM server; three separate repos). TypeScript client/mobile rules live in `sinterior-client/docs` — this file covers the server.

## Repos & branches

- Three repos: `sinterior-server` (branch `master`), `sinterior-client` (branch `v1.1` = Vercel production), `sintherior-whatsapp-bot` (branch `main`). Pushes to those branches auto-deploy — **treat every push as a production deploy.** [REVIEW]
- Feature-scale work (e.g. feed milestones): branch per unit of work, merge when the increment is deployable. Small fixes may land directly per current practice. [REVIEW]
- **One summarized commit message covering all changes in the push** — not split-by-feature commit trains. (Established project convention.)
- Every commit builds: server `node --check` on touched files. [LINT]

## Server (Node 22, ESM, Express, Mongoose)

- ESM, frozen `config` from `src/config/env.js` — **never read `process.env` outside env.js**. New env vars: add to env.js (+ REQUIRED list if boot-critical), `.env.example`, and deploy-railway.md in the same change. [REVIEW]
- Route → controller → model layering; controllers wrapped in `asyncHandler`; errors via `AppError`; responses via `apiResponse` helpers. Match existing `[Tag]` log style. [REVIEW]
- express-validator rules on every new route. [TEST]
- Index every new query path; declare indexes once (inline `unique`/`index` OR `schema.index()` — never both; duplicate-index warnings are treated as bugs). [LINT]
- No filesystem writes — media goes to Cloudinary via memoryStorage multer. Railway disk is ephemeral. [REVIEW]

## Money [REVIEW — always]

- Integer minor units (**kobo**) end to end; never floats; convert at the display edge only.
- Wallet/escrow mutations are **append-only** WalletTransactions with an actor recorded; balances are derived, never hand-edited.
- Any change touching payment/escrow/payout paths gets an explicit review pass and a webhook-replay sanity check.

## Size ceilings [LINT]

Warn at 300 lines/file, error at 500 (split by responsibility); ≤60 lines/function. Known outliers are acknowledged debt — do not add to them; shrink when touched.

## Docs move with code [REVIEW]

Schema, env, deploy, or scope changes update the relevant `/docs` file in the same unit of work. Decisions of consequence get a dated DECISIONS.md entry (this repo holds the platform-canonical log).
