/**
 * taxonomy.js — canonical pin taxonomy (trades, rooms, budget bands).
 *
 * Server-owned by decision (docs/DECISIONS.md 2026-07-27): changes require a
 * commit. Exposed to all surfaces via GET /api/v1/pins/taxonomy so web and
 * mobile never hardcode these lists.
 *
 * TRADES mirror the client's ARTISAN_SKILL_CATEGORIES ids — keep in sync with
 * sinterior-client/src/lib/constants.ts until the client switches to fetching.
 */

export const TRADES = [
  'carpentry',
  'masonry',
  'metalwork',
  'painting',
  'ceilings',
  'wall-decoration',
  'flooring',
  'electrical',
  'plumbing',
  'roofing',
  'landscaping',
  'curtains',
  'bathroom-kitchen',
  'acp',
  'cleaning',
  'traditional',
  'modern',
  'tools',
  'acoustic',
];

export const ROOMS = [
  'living-room',
  'bedroom',
  'kitchen',
  'bathroom',
  'dining',
  'office-shop',
  'exterior-compound',
  'whole-home',
];

// Amounts in kobo (₦1 = 100 kobo). `max: null` = unbounded.
export const BUDGET_BANDS = [
  { id: 'under-100k', label: 'Under ₦100k', min: 0, max: 100_000_00 },
  { id: '100k-500k', label: '₦100k – ₦500k', min: 100_000_00, max: 500_000_00 },
  { id: '500k-2m', label: '₦500k – ₦2m', min: 500_000_00, max: 2_000_000_00 },
  { id: '2m-10m', label: '₦2m – ₦10m', min: 2_000_000_00, max: 10_000_000_00 },
  { id: '10m-plus', label: '₦10m+', min: 10_000_000_00, max: null },
];

export const BUDGET_BAND_IDS = BUDGET_BANDS.map((b) => b.id);

/** Map a kobo amount to its budget band id (null when amount is not a number). */
export const bandForAmount = (kobo) => {
  if (typeof kobo !== 'number' || Number.isNaN(kobo) || kobo < 0) return null;
  const band = BUDGET_BANDS.find((b) => kobo >= b.min && (b.max === null || kobo < b.max));
  return band ? band.id : null;
};
