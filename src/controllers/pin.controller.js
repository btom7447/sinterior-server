import mongoose from 'mongoose';
import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/AppError.js';
import Pin from '../models/Pin.js';
import Profile from '../models/Profile.js';
import Follow from '../models/Follow.js';
import BoardPin from '../models/BoardPin.js';
import PinComment from '../models/PinComment.js';
import PinLike from '../models/PinLike.js';
import { TRADES, ROOMS, BUDGET_BANDS } from '../config/taxonomy.js';
import { TAG_VOCABULARY, deriveTags, sanitizeTags } from '../config/vocabulary.js';
import { getPagination, buildPaginationMeta } from '../utils/paginate.js';
import { resolvePinAlbum, resolveUploadUrl } from '../utils/resolveUrl.js';

const FEED_LIMIT_MAX = 50;
const EDITABLE_FIELDS = ['title', 'caption'];
const EDITABLE_TAXONOMY = ['trade', 'room', 'budgetBand', 'tags'];

const myProfile = async (userId) => {
  const profile = await Profile.findOne({ userId }).select('_id');
  if (!profile) throw new AppError('Profile not found.', 404);
  return profile;
};

// ── GET /pins/taxonomy ────────────────────────────────────────────────────────
export const getTaxonomy = asyncHandler(async (_req, res) => {
  res.status(200).json({
    success: true,
    data: { trades: TRADES, rooms: ROOMS, budgetBands: BUDGET_BANDS, tags: TAG_VOCABULARY },
  });
});

// ── GET /pins/feed ────────────────────────────────────────────────────────────
// Public, personalized when a token is present (optionalAuth). Cursor-paginated
// score ranking: recency decay + save-velocity + followed-author boost +
// save-history trade affinity + featured. Author diversity is applied within
// the returned page (max 2 consecutive per author) — cursor order stays the
// raw score order so pagination remains sound.
export const getFeed = asyncHandler(async (req, res) => {
  const limit = Math.min(FEED_LIMIT_MAX, Math.max(1, parseInt(req.query.limit, 10) || 24));
  const { trade, room, budgetBand, tag, author } = req.query;

  const match = { status: 'active' };
  if (trade) match['taxonomy.trade'] = trade;
  if (room) match['taxonomy.room'] = room;
  if (budgetBand) match['taxonomy.budgetBand'] = budgetBand;
  if (tag) match['taxonomy.tags'] = tag;
  if (author && mongoose.isValidObjectId(author)) match.author = new mongoose.Types.ObjectId(author);
  // Restrict to given source kinds, e.g. "native,product" for surfaces that
  // should only show hireable work and buyable goods (not property/admin).
  if (req.query.sourceType) {
    const allowed = ['native', 'product', 'property', 'admin'];
    const types = String(req.query.sourceType)
      .split(',')
      .map((s) => s.trim())
      .filter((s) => allowed.includes(s));
    if (types.length) match.sourceType = { $in: types };
  }
  // Free-text search (title/caption/tags) — $text must live in the pipeline's first $match.
  if (req.query.q) match.$text = { $search: String(req.query.q).slice(0, 100) };

  // Personalization inputs — cheap lookups, only when authenticated.
  let followedIds = [];
  let affinityTrades = [];
  if (req.user) {
    const profile = await Profile.findOne({ userId: req.user.id }).select('_id preferredTrades');
    if (profile) {
      const [follows, recentSaves] = await Promise.all([
        Follow.find({ follower: profile._id }).select('followed').lean(),
        BoardPin.find({ owner: profile._id })
          .sort({ createdAt: -1 })
          .limit(100)
          .select('pinId')
          .lean(),
      ]);
      followedIds = follows.map((f) => f.followed);
      if (recentSaves.length) {
        const savedPins = await Pin.find({ _id: { $in: recentSaves.map((s) => s.pinId) } })
          .select('taxonomy.trade')
          .lean();
        affinityTrades = [...new Set(savedPins.map((p) => p.taxonomy?.trade).filter(Boolean))];
      }
      // Onboarding taste-picker seed — matters most before any save history exists.
      affinityTrades = [...new Set([...affinityTrades, ...(profile.preferredTrades || [])])];
    }
  }

  // sort=top ranks by demonstrated popularity instead of freshness.
  //
  // Raw saves reward whatever has been up longest, so the main term is the
  // save-through rate: of the people who saw this, how many kept it. Views are
  // floored at VIEW_FLOOR so a pin seen three times and saved once cannot
  // outrank the whole platform on a 33% rate. Absolute saves still carry a
  // capped share, because rate alone would let a tiny, lucky pin dominate.
  const topFirst = req.query.sort === 'top';
  const VIEW_FLOOR = 25;

  const pipeline = [
    { $match: match },
    {
      $addFields: {
        score: topFirst
          ? {
              $add: [
                {
                  $multiply: [
                    {
                      $divide: [
                        '$counters.saves',
                        { $max: [{ $ifNull: ['$counters.views', 0] }, VIEW_FLOOR] },
                      ],
                    },
                    600,
                  ],
                },
                { $multiply: [{ $min: [{ $ifNull: ['$counters.saves', 0] }, 50] }, 20] },
                { $cond: ['$isFeatured', 250, 0] },
                // Gentle recency tiebreak so equal-save pins aren't frozen in
                // one order forever.
                {
                  $divide: [
                    50,
                    {
                      $add: [
                        1,
                        { $divide: [{ $subtract: ['$$NOW', '$createdAt'] }, 1000 * 60 * 60 * 24] },
                      ],
                    },
                  ],
                },
              ],
            }
          : {
          $add: [
            // Recency: 100 at birth, halved roughly every day of age.
            {
              $divide: [
                100,
                {
                  $add: [
                    1,
                    {
                      $divide: [
                        { $subtract: ['$$NOW', '$createdAt'] },
                        1000 * 60 * 60 * 24,
                      ],
                    },
                  ],
                },
              ],
            },
            // Saves: capped so a viral pin can't pin itself to the top forever.
            { $multiply: [{ $min: ['$counters.saves', 50] }, 2] },
            { $cond: [{ $in: ['$author', followedIds] }, 40, 0] },
            { $cond: [{ $in: ['$taxonomy.trade', affinityTrades] }, 20, 0] },
            { $cond: ['$isFeatured', 30, 0] },
          ],
        },
      },
    },
  ];

  // Cursor: "<score>_<id>" from the previous page's last raw-order item.
  if (req.query.cursor) {
    const [s, id] = String(req.query.cursor).split('_');
    const score = parseFloat(s);
    if (!Number.isNaN(score) && mongoose.isValidObjectId(id)) {
      pipeline.push({
        $match: {
          $or: [
            { score: { $lt: score } },
            { score, _id: { $lt: new mongoose.Types.ObjectId(id) } },
          ],
        },
      });
    }
  }

  pipeline.push({ $sort: { score: -1, _id: -1 } }, { $limit: limit });

  const raw = await Pin.aggregate(pipeline);
  const nextCursor = raw.length === limit ? `${raw[raw.length - 1].score}_${raw[raw.length - 1]._id}` : null;

  // Populate authors in one query.
  const authors = await Profile.find({ _id: { $in: raw.map((p) => p.author) } })
    .select('fullName avatarUrl role city state')
    .lean();
  const authorById = new Map(authors.map((a) => [a._id.toString(), a]));

  // Page-local author diversity: never 3 of the same author in a row.
  const pins = [];
  const deferred = [];
  for (const pin of raw) {
    const sameRun =
      pins.length >= 2 &&
      pins[pins.length - 1].author?.toString() === pin.author?.toString() &&
      pins[pins.length - 2].author?.toString() === pin.author?.toString();
    if (sameRun) deferred.push(pin);
    else pins.push(pin);
  }
  pins.push(...deferred);

  const data = pins.map((p) => {
    const a = authorById.get(p.author?.toString());
    return {
      ...p,
      mediaUrl: resolveUploadUrl(p.mediaUrl),
      posterUrl: p.posterUrl ? resolveUploadUrl(p.posterUrl) : undefined,
      media: resolvePinAlbum(p.media),
      author: a
        ? { _id: a._id, fullName: a.fullName, avatarUrl: resolveUploadUrl(a.avatarUrl), role: a.role, city: a.city, state: a.state }
        : null,
      score: undefined,
    };
  });

  res.status(200).json({
    success: true,
    data: { pins: data, nextCursor },
    message: 'Feed retrieved.',
  });
});

// ── GET /pins/:id ─────────────────────────────────────────────────────────────
export const getPin = asyncHandler(async (req, res) => {
  const pin = await Pin.findById(req.params.id).populate('author', 'fullName avatarUrl role city state');
  if (!pin || pin.status === 'removed') throw new AppError('Pin not found.', 404);
  if (pin.status === 'hidden' && req.user?.role !== 'admin') throw new AppError('Pin not found.', 404);

  let savedByMe = false;
  let likedByMe = false;
  if (req.user) {
    const profile = await Profile.findOne({ userId: req.user.id }).select('_id');
    if (profile) {
      const [saved, liked] = await Promise.all([
        BoardPin.exists({ owner: profile._id, pinId: pin._id }),
        PinLike.exists({ owner: profile._id, pinId: pin._id }),
      ]);
      savedByMe = !!saved;
      likedByMe = !!liked;
    }
  }

  res.status(200).json({ success: true, data: { pin, savedByMe, likedByMe } });
});

// ── POST /pins/:id/view ───────────────────────────────────────────────────────
// Counted when a pin is actually opened, not when it scrolls past in a grid: a
// view has to mean something for the save-through rate to mean anything.
//
// Public and unauthenticated by design, which makes it inflatable. That is an
// accepted trade for now (it only affects ranking, never money or access); the
// client sends at most one per pin per session. If gaming shows up, the fix is
// a signed, short-lived token issued with the pin, not auth.
export const recordView = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new AppError('Pin not found.', 404);
  await Pin.updateOne({ _id: req.params.id, status: 'active' }, { $inc: { 'counters.views': 1 } });
  res.status(204).end();
});

// ── POST/DELETE /pins/:id/like ────────────────────────────────────────────────
// Idempotent both ways: the unique index absorbs a double tap, and the counter
// only moves when the membership actually changed.
export const likePin = asyncHandler(async (req, res) => {
  const profile = await myProfile(req.user.id);
  const pin = await Pin.findById(req.params.id).select('_id status');
  if (!pin || pin.status !== 'active') throw new AppError('Pin not found.', 404);

  const existing = await PinLike.findOne({ pinId: pin._id, owner: profile._id });
  if (!existing) {
    await PinLike.create({ pinId: pin._id, owner: profile._id });
    await Pin.updateOne({ _id: pin._id }, { $inc: { 'counters.likes': 1 } });
  }

  const fresh = await Pin.findById(pin._id).select('counters.likes').lean();
  res.status(200).json({
    success: true,
    data: { likedByMe: true, likes: fresh?.counters?.likes ?? 0 },
  });
});

export const unlikePin = asyncHandler(async (req, res) => {
  const profile = await myProfile(req.user.id);
  const removed = await PinLike.findOneAndDelete({ pinId: req.params.id, owner: profile._id });
  if (removed) {
    await Pin.updateOne(
      { _id: req.params.id, 'counters.likes': { $gt: 0 } },
      { $inc: { 'counters.likes': -1 } }
    );
  }

  const fresh = await Pin.findById(req.params.id).select('counters.likes').lean();
  res.status(200).json({
    success: true,
    data: { likedByMe: false, likes: fresh?.counters?.likes ?? 0 },
  });
});

// ── GET /pins/:id/comments ────────────────────────────────────────────────────
export const listComments = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = { pinId: req.params.id, status: 'active' };

  const [comments, total] = await Promise.all([
    PinComment.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('author', 'fullName avatarUrl role')
      .lean(),
    PinComment.countDocuments(filter),
  ]);

  const data = comments.map((c) => ({
    ...c,
    author: c.author ? { ...c.author, avatarUrl: resolveUploadUrl(c.author.avatarUrl) } : null,
  }));

  res.status(200).json({
    success: true,
    data: { comments: data },
    pagination: buildPaginationMeta(total, page, limit),
  });
});

// ── POST /pins/:id/comments ───────────────────────────────────────────────────
export const addComment = asyncHandler(async (req, res) => {
  const profile = await myProfile(req.user.id);
  const pin = await Pin.findById(req.params.id).select('_id status');
  if (!pin || pin.status !== 'active') throw new AppError('Pin not found.', 404);

  const body = String(req.body.body ?? '').trim();
  if (!body) throw new AppError('Write something first.', 400);

  const created = await PinComment.create({ pinId: pin._id, author: profile._id, body });
  await Pin.updateOne({ _id: pin._id }, { $inc: { 'counters.comments': 1 } });

  const comment = await PinComment.findById(created._id)
    .populate('author', 'fullName avatarUrl role')
    .lean();

  res.status(201).json({
    success: true,
    data: {
      comment: {
        ...comment,
        author: comment.author
          ? { ...comment.author, avatarUrl: resolveUploadUrl(comment.author.avatarUrl) }
          : null,
      },
    },
    message: 'Comment posted.',
  });
});

// ── DELETE /pins/comments/:commentId ──────────────────────────────────────────
// The comment's author, the pin's author, or an admin. A pin owner needs to be
// able to clear their own wall without waiting on moderation.
export const deleteComment = asyncHandler(async (req, res) => {
  const comment = await PinComment.findById(req.params.commentId);
  if (!comment || comment.status === 'removed') throw new AppError('Comment not found.', 404);

  const profile = await Profile.findOne({ userId: req.user.id }).select('_id');
  const pin = await Pin.findById(comment.pinId).select('author');
  const mine = profile && comment.author.toString() === profile._id.toString();
  const myPin = profile && pin && pin.author.toString() === profile._id.toString();
  if (!mine && !myPin && req.user.role !== 'admin') {
    throw new AppError('You cannot remove this comment.', 403);
  }

  comment.status = 'removed';
  await comment.save();
  await Pin.updateOne(
    { _id: comment.pinId, 'counters.comments': { $gt: 0 } },
    { $inc: { 'counters.comments': -1 } }
  );

  res.status(200).json({ success: true, data: null, message: 'Comment removed.' });
});

// ── POST /pins/upload ─────────────────────────────────────────────────────────
// Photos for a pin, in one request, so an album is one upload rather than ten.
// Returns URLs only: the pin itself is created in a second call once the maker
// has written a title, which means a half-finished post leaves no pin behind.
export const uploadPinMedia = asyncHandler(async (req, res) => {
  if (!req.files?.length) {
    throw new AppError('Attach at least one photo.', 400);
  }
  res.status(200).json({
    success: true,
    data: { urls: req.files.map((f) => resolveUploadUrl(f.url)) },
    message: 'Photos uploaded.',
  });
});

// ── POST /pins ────────────────────────────────────────────────────────────────
// Native creation (artisan/supplier). M0 accepts already-uploaded Cloudinary
// URLs; M1 adds the dedicated upload flow with server-side dimension capture.
export const createPin = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id }).select('_id role');
  if (!profile) throw new AppError('Profile not found.', 404);

  const { mediaUrl, posterUrl, mediaType, aspectRatio, title, caption, taxonomy } = req.body;

  // Albums arrive as media[]; a single item may still arrive the old way. Both
  // end up stored the same: media[] holds the set, and the flat fields mirror
  // its first entry so nothing downstream has to branch.
  const album = Array.isArray(req.body.media)
    ? req.body.media
        .filter((m) => m && typeof m.url === 'string' && m.url.trim())
        .slice(0, 10)
        .map((m) => ({
          type: m.type === 'video' ? 'video' : 'image',
          url: m.url.trim(),
          posterUrl: m.posterUrl,
          aspectRatio: typeof m.aspectRatio === 'number' ? m.aspectRatio : 1,
        }))
    : [];

  const lead = album[0];
  const primaryUrl = lead?.url ?? mediaUrl;
  if (!primaryUrl || !title) throw new AppError('At least one image and a title are required.', 400);

  const pin = await Pin.create({
    author: profile._id,
    sourceType: 'native',
    mediaType: (lead?.type ?? mediaType) === 'video' ? 'video' : 'image',
    mediaUrl: primaryUrl,
    posterUrl: lead?.posterUrl ?? posterUrl,
    aspectRatio:
      typeof lead?.aspectRatio === 'number'
        ? lead.aspectRatio
        : typeof aspectRatio === 'number'
          ? aspectRatio
          : 1,
    media: album,
    title,
    caption,
    taxonomy: {
      trade: taxonomy?.trade ?? null,
      room: taxonomy?.room ?? null,
      budgetBand: taxonomy?.budgetBand ?? null,
      // Tags are read out of the pin's own words against the vocabulary, then
      // merged with anything the client explicitly chose.
      tags: sanitizeTags([...(taxonomy?.tags ?? []), ...deriveTags(title, caption)]),
    },
  });

  res.status(201).json({ success: true, data: { pin }, message: 'Pin created.' });
});

// ── PATCH /pins/:id ───────────────────────────────────────────────────────────
export const updatePin = asyncHandler(async (req, res) => {
  const pin = await Pin.findById(req.params.id);
  if (!pin || pin.status === 'removed') throw new AppError('Pin not found.', 404);

  const isAdmin = req.user.role === 'admin';
  const profile = await Profile.findOne({ userId: req.user.id }).select('_id');
  const isOwner = profile && pin.author.toString() === profile._id.toString();
  if (!isOwner && !isAdmin) throw new AppError('You can only edit your own pins.', 403);

  const wordsChanged = req.body.title !== undefined || req.body.caption !== undefined;
  for (const f of EDITABLE_FIELDS) if (req.body[f] !== undefined) pin[f] = req.body[f];
  if (req.body.taxonomy) {
    for (const f of EDITABLE_TAXONOMY) {
      if (req.body.taxonomy[f] !== undefined) pin.taxonomy[f] = req.body.taxonomy[f];
    }
  }
  // Edited words mean re-read the vocabulary: a pin whose caption gained
  // "Lekki" should be findable under Lekki without being reposted.
  if (wordsChanged || req.body.taxonomy?.tags !== undefined) {
    pin.taxonomy.tags = sanitizeTags([
      ...(req.body.taxonomy?.tags ?? []),
      ...deriveTags(pin.title, pin.caption),
    ]);
  }
  // Moderation fields — admin only.
  if (isAdmin) {
    if (req.body.status && ['active', 'hidden'].includes(req.body.status)) pin.status = req.body.status;
    if (req.body.isFeatured !== undefined) pin.isFeatured = !!req.body.isFeatured;
  }

  await pin.save();
  res.status(200).json({ success: true, data: { pin }, message: 'Pin updated.' });
});

// ── DELETE /pins/:id ──────────────────────────────────────────────────────────
// Soft delete (status: removed) — keeps board references and counters sane;
// read paths all filter it out.
export const deletePin = asyncHandler(async (req, res) => {
  const pin = await Pin.findById(req.params.id);
  if (!pin || pin.status === 'removed') throw new AppError('Pin not found.', 404);

  const isAdmin = req.user.role === 'admin';
  const profile = await Profile.findOne({ userId: req.user.id }).select('_id');
  const isOwner = profile && pin.author.toString() === profile._id.toString();
  if (!isOwner && !isAdmin) throw new AppError('You can only delete your own pins.', 403);

  pin.status = 'removed';
  await pin.save();
  res.status(200).json({ success: true, data: null, message: 'Pin removed.' });
});

// ── GET /pins/taxonomy/covers ────────────────────────────────────────────────
// One representative image per trade, chosen by saves then recency, so the
// interest picker can show real work instead of icons. Trades with no pins are
// simply absent; the client falls back to a plain tile for those.
export const getTradeCovers = asyncHandler(async (_req, res) => {
  const rows = await Pin.aggregate([
    { $match: { status: 'active', 'taxonomy.trade': { $ne: null } } },
    { $sort: { 'counters.saves': -1, createdAt: -1 } },
    {
      $group: {
        _id: '$taxonomy.trade',
        mediaUrl: { $first: '$mediaUrl' },
        posterUrl: { $first: '$posterUrl' },
        mediaType: { $first: '$mediaType' },
      },
    },
  ]);

  const covers = {};
  for (const row of rows) {
    covers[row._id] = resolveUploadUrl(
      row.mediaType === 'video' ? row.posterUrl || row.mediaUrl : row.mediaUrl
    );
  }

  res.status(200).json({ success: true, data: { covers } });
});
