import mongoose from 'mongoose';
import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/AppError.js';
import Pin from '../models/Pin.js';
import Profile from '../models/Profile.js';
import Follow from '../models/Follow.js';
import BoardPin from '../models/BoardPin.js';
import { TRADES, ROOMS, BUDGET_BANDS } from '../config/taxonomy.js';
import { resolveUploadUrl } from '../utils/resolveUrl.js';

const FEED_LIMIT_MAX = 50;
const EDITABLE_FIELDS = ['title', 'caption'];
const EDITABLE_TAXONOMY = ['trade', 'room', 'budgetBand', 'tags'];

// ── GET /pins/taxonomy ────────────────────────────────────────────────────────
export const getTaxonomy = asyncHandler(async (_req, res) => {
  res.status(200).json({
    success: true,
    data: { trades: TRADES, rooms: ROOMS, budgetBands: BUDGET_BANDS },
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

  // Personalization inputs — cheap lookups, only when authenticated.
  let followedIds = [];
  let affinityTrades = [];
  if (req.user) {
    const profile = await Profile.findOne({ userId: req.user.id }).select('_id');
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
    }
  }

  const pipeline = [
    { $match: match },
    {
      $addFields: {
        score: {
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
  if (req.user) {
    const profile = await Profile.findOne({ userId: req.user.id }).select('_id');
    if (profile) savedByMe = !!(await BoardPin.exists({ owner: profile._id, pinId: pin._id }));
  }

  res.status(200).json({ success: true, data: { pin, savedByMe } });
});

// ── POST /pins ────────────────────────────────────────────────────────────────
// Native creation (artisan/supplier). M0 accepts already-uploaded Cloudinary
// URLs; M1 adds the dedicated upload flow with server-side dimension capture.
export const createPin = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id }).select('_id role');
  if (!profile) throw new AppError('Profile not found.', 404);

  const { mediaUrl, posterUrl, mediaType, aspectRatio, title, caption, taxonomy } = req.body;
  if (!mediaUrl || !title) throw new AppError('mediaUrl and title are required.', 400);

  const pin = await Pin.create({
    author: profile._id,
    sourceType: 'native',
    mediaType: mediaType === 'video' ? 'video' : 'image',
    mediaUrl,
    posterUrl,
    aspectRatio: typeof aspectRatio === 'number' ? aspectRatio : 1,
    title,
    caption,
    taxonomy: {
      trade: taxonomy?.trade ?? null,
      room: taxonomy?.room ?? null,
      budgetBand: taxonomy?.budgetBand ?? null,
      tags: Array.isArray(taxonomy?.tags) ? taxonomy.tags.slice(0, 10) : [],
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

  for (const f of EDITABLE_FIELDS) if (req.body[f] !== undefined) pin[f] = req.body[f];
  if (req.body.taxonomy) {
    for (const f of EDITABLE_TAXONOMY) {
      if (req.body.taxonomy[f] !== undefined) pin.taxonomy[f] = req.body.taxonomy[f];
    }
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
