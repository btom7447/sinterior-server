/**
 * One search across everything.
 *
 * Work, people and materials each had their own field on their own screen,
 * which put the burden of knowing which index they were in onto the person
 * searching. Nobody thinks "I am in the artisan directory" — they think "who
 * can lay terrazzo and what does it cost", and that is one question.
 *
 * So one box, three groups, one request. Three requests would be three chances
 * to fail on a bad connection and three sets of latency for one intention.
 */
import asyncHandler from '../utils/asyncHandler.js';
import ArtisanProfile from '../models/ArtisanProfile.js';
import Pin from '../models/Pin.js';
import Product from '../models/Product.js';
import Profile from '../models/Profile.js';
import SearchQuery from '../models/SearchQuery.js';
import escapeRegex from '../utils/escapeRegex.js';
import { resolvePinAlbum, resolveUploadUrl } from '../utils/resolveUrl.js';

/** Enough of each group to show it is there; "see all" goes to its own screen. */
const PER_GROUP = 8;

/** Lower-cased, trimmed, inner whitespace collapsed — so counts aggregate. */
export const normaliseTerm = (raw) =>
  String(raw ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);

// ── GET /search?q= ────────────────────────────────────────────────────────────
export const searchEverything = asyncHandler(async (req, res) => {
  const q = normaliseTerm(req.query.q);
  if (!q) {
    return res.status(200).json({
      success: true,
      data: { pins: [], artisans: [], products: [], counts: { pins: 0, artisans: 0, products: 0 } },
    });
  }

  const rx = new RegExp(escapeRegex(q), 'i');

  const [pins, artisans, products] = await Promise.all([
    // $text is the right tool for pins: they carry a text index over title,
    // caption and tags, which is where a search term actually lands.
    Pin.find({ status: 'active', $text: { $search: q } }, { score: { $meta: 'textScore' } })
      .sort({ score: { $meta: 'textScore' } })
      .limit(PER_GROUP)
      .populate('author', 'fullName avatarUrl role city state')
      .lean(),

    // People have no text index, and a name is the commonest thing anyone
    // types, so this resolves matching profiles first and folds them in.
    Profile.find({ fullName: rx })
      .select('_id')
      .lean()
      .then((profiles) =>
        ArtisanProfile.find({
          isAvailable: true,
          $or: [
            { skill: rx },
            { skillCategory: rx },
            { city: rx },
            ...(profiles.length ? [{ profileId: { $in: profiles.map((p) => p._id) } }] : []),
          ],
        })
          .limit(PER_GROUP)
          .populate('profileId', 'fullName avatarUrl city state')
          .lean()
      ),

    Product.find({ isActive: true, $text: { $search: q } }, { score: { $meta: 'textScore' } })
      .sort({ score: { $meta: 'textScore' } })
      .limit(PER_GROUP)
      .populate('supplierId', 'fullName avatarUrl city state')
      .lean(),
  ]);

  const shapedPins = pins.map((p) => ({
    ...p,
    score: undefined,
    mediaUrl: resolveUploadUrl(p.mediaUrl),
    posterUrl: p.posterUrl ? resolveUploadUrl(p.posterUrl) : undefined,
    media: resolvePinAlbum(p.media),
    author: p.author ? { ...p.author, avatarUrl: resolveUploadUrl(p.author.avatarUrl) } : null,
  }));

  // Counted before the response goes out, and deliberately not awaited on the
  // request path — a failed count must never cost somebody their search.
  recordSearch(q, shapedPins.length + artisans.length + products.length === 0).catch(() => {});

  res.status(200).json({
    success: true,
    data: {
      pins: shapedPins,
      artisans: artisans.map((a) => ({
        ...a,
        profileId: a.profileId
          ? { ...a.profileId, avatarUrl: resolveUploadUrl(a.profileId.avatarUrl) }
          : null,
      })),
      products: products.map((p) => ({ ...p, score: undefined })),
      counts: {
        pins: shapedPins.length,
        artisans: artisans.length,
        products: products.length,
      },
    },
  });
});

/**
 * Increment the aggregate for a term.
 *
 * Upserted rather than inserted, so the collection stays one row per term
 * however many times it is searched — a log of every search would grow without
 * bound and answer no question this one cannot.
 */
async function recordSearch(term, wasEmpty) {
  if (!term) return;
  await SearchQuery.updateOne(
    { term },
    {
      $inc: { count: 1, emptyCount: wasEmpty ? 1 : 0 },
      $set: { lastSearchedAt: new Date() },
    },
    { upsert: true }
  );
}

// ── GET /search/gaps ──────────────────────────────────────────────────────────
// Admin only. What people are asking for and not finding, commonest first —
// the shortlist of what to commission next.
export const getSearchGaps = asyncHandler(async (req, res) => {
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));

  const gaps = await SearchQuery.find({ emptyCount: { $gt: 0 } })
    .sort({ emptyCount: -1, count: -1 })
    .limit(limit)
    .select('term count emptyCount lastSearchedAt')
    .lean();

  const popular = await SearchQuery.find()
    .sort({ count: -1 })
    .limit(limit)
    .select('term count emptyCount')
    .lean();

  res.status(200).json({ success: true, data: { gaps, popular } });
});
