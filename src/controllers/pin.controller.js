import mongoose from 'mongoose';
import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/AppError.js';
import Pin from '../models/Pin.js';
import Profile from '../models/Profile.js';
import Follow from '../models/Follow.js';
import Board from '../models/Board.js';
import BoardPin from '../models/BoardPin.js';
import { defaultBoardName } from '../config/boards.js';
import PinLike from '../models/PinLike.js';
import PinMute from '../models/PinMute.js';
import { TRADES, ROOMS, BUDGET_BANDS } from '../config/taxonomy.js';
import { TAG_VOCABULARY, deriveTags, sanitizeTags } from '../config/vocabulary.js';
import { notifyPinLiked } from '../services/feedNotify.service.js';
import {
  createDirectUpload,
  deleteVideo,
  getVideo,
  MAX_VIDEO_SECONDS,
} from '../services/stream.service.js';
import { resolvePinAlbum, resolveUploadUrl } from '../utils/resolveUrl.js';

const FEED_LIMIT_MAX = 50;
const EDITABLE_FIELDS = ['title', 'caption'];
const EDITABLE_TAXONOMY = ['trade', 'room', 'budgetBand', 'tags'];

const myProfile = async (userId) => {
  const profile = await Profile.findOne({ userId }).select('_id');
  if (!profile) throw new AppError('Profile not found.', 404);
  return profile;
};

/**
 * Turn whatever the client sent into a stored album.
 *
 * Shared by create and update so a replaced photograph goes through exactly the
 * same door as a new one — including the part that matters: a video entry
 * carries a `videoUid`, and the playback and poster addresses are read back
 * from Cloudflare rather than trusted from the caller. That check is the reason
 * this is a function rather than two copies.
 */
async function normaliseAlbum(media) {
  const raw = Array.isArray(media) ? media.slice(0, 10) : [];
  const album = [];

  for (const item of raw) {
    if (!item) continue;

    if (item.type === 'video' && item.videoUid) {
      const video = await getVideo(String(item.videoUid));
      if (!video.ready || !video.playbackUrl) {
        throw new AppError('That video is still processing. Try again in a moment.', 409);
      }
      album.push({
        type: 'video',
        url: video.playbackUrl,
        posterUrl: video.posterUrl ?? undefined,
        aspectRatio: typeof item.aspectRatio === 'number' ? item.aspectRatio : 1,
      });
      continue;
    }

    if (typeof item.url === 'string' && item.url.trim()) {
      album.push({
        type: 'image',
        url: item.url.trim(),
        posterUrl: item.posterUrl,
        aspectRatio: typeof item.aspectRatio === 'number' ? item.aspectRatio : 1,
      });
    }
  }

  return album;
}

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
  let mutedTrades = [];
  // Kept beyond this block: the like/save state of the returned page is
  // resolved against it once the pins are known.
  let viewerId = null;
  if (req.user) {
    const profile = await Profile.findOne({ userId: req.user.id }).select('_id preferredTrades');
    if (profile) {
      viewerId = profile._id;
      const [follows, recentSaves, mutes] = await Promise.all([
        Follow.find({ follower: profile._id }).select('followed').lean(),
        BoardPin.find({ owner: profile._id })
          .sort({ createdAt: -1 })
          .limit(100)
          .select('pinId')
          .lean(),
        PinMute.find({ owner: profile._id }).select('pinId trade').lean(),
      ]);
      followedIds = follows.map((f) => f.followed);

      // A muted pin never comes back, on any device.
      if (mutes.length) match._id = { $nin: mutes.map((m) => m.pinId) };

      // Muting the same trade repeatedly is a clearer statement than muting one
      // pin, so only a repeated pattern moves ranking. A single mute is treated
      // as "not this one" rather than "not this kind of work".
      const perTrade = new Map();
      for (const mute of mutes) {
        if (!mute.trade) continue;
        perTrade.set(mute.trade, (perTrade.get(mute.trade) ?? 0) + 1);
      }
      mutedTrades = [...perTrade.entries()].filter(([, n]) => n >= 3).map(([trade]) => trade);

      // Only pins by people you follow. A deliberate choice rather than a
      // ranking nudge, so an empty following list gives an empty feed and the
      // app can say so.
      if (req.query.following === 'true') {
        match.author = { $in: followedIds };
      }
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
  // Drafts. Only ever visible to their own author, and only when asked for by
  // name — there is no combination of query parameters that leaks somebody
  // else's unfinished work, because the author has to match the viewer.
  if (req.query.status === 'draft') {
    const own = viewerId && String(req.query.author) === String(viewerId);
    if (!own) throw new AppError('Drafts are only visible to their author.', 403);
    match.status = 'draft';
  }

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
            // Repeatedly muting a trade pushes it down without banning it: the
            // user may still want the occasional one, and a hard exclusion
            // would make the mistake unrecoverable.
            { $cond: [{ $in: ['$taxonomy.trade', mutedTrades] }, -60, 0] },
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

  // Which of this page the viewer has already liked or saved. Two queries for
  // the whole page rather than one per pin, and the reason it matters: without
  // it the heart on a grid card cannot know its own state, so it renders empty
  // on work the viewer has already liked and a second tap reads as the first.
  let likedIds = new Set();
  let savedIds = new Set();
  if (viewerId) {
    const ids = pins.map((p) => p._id);
    const [liked, saved] = await Promise.all([
      PinLike.find({ owner: viewerId, pinId: { $in: ids } }).select('pinId').lean(),
      BoardPin.find({ owner: viewerId, pinId: { $in: ids } }).select('pinId').lean(),
    ]);
    likedIds = new Set(liked.map((l) => String(l.pinId)));
    savedIds = new Set(saved.map((s) => String(s.pinId)));
  }

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
      likedByMe: likedIds.has(String(p._id)),
      savedByMe: savedIds.has(String(p._id)),
      score: undefined,
    };
  });

  res.status(200).json({
    success: true,
    data: { pins: data, nextCursor },
    message: 'Feed retrieved.',
  });
});

// ── GET /pins/mine ────────────────────────────────────────────────────────────
/**
 * Everything the signed-in author has posted, drafts included.
 *
 * Separate from the feed rather than a flag on it, because the two answer
 * different questions. The feed is what the world should see: active pins only,
 * ranked. This is what the author has, in the order they made it, including the
 * drafts and the hidden ones — a management screen that cannot show you the
 * draft you saved yesterday is a management screen with a hole in it.
 *
 * Removed pins stay out. They are tombstones kept so save counters on other
 * people's boards do not go negative, not something to offer back for editing.
 */
export const getMyPins = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id }).select('_id');
  if (!profile) throw new AppError('Profile not found.', 404);

  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);

  const filter = { author: profile._id, status: { $ne: 'removed' } };

  const [pins, total] = await Promise.all([
    Pin.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Pin.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: {
      pins: pins.map((p) => ({
        ...p,
        mediaUrl: resolveUploadUrl(p.mediaUrl),
        posterUrl: p.posterUrl ? resolveUploadUrl(p.posterUrl) : undefined,
        media: resolvePinAlbum(p.media),
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    },
    message: 'Your pins retrieved.',
  });
});

// ── GET /pins/:id ─────────────────────────────────────────────────────────────
export const getPin = asyncHandler(async (req, res) => {
  const pin = await Pin.findById(req.params.id).populate('author', 'fullName avatarUrl role city state');
  if (!pin || pin.status === 'removed') throw new AppError('Pin not found.', 404);
  if (pin.status === 'hidden' && req.user?.role !== 'admin') throw new AppError('Pin not found.', 404);

  let savedByMe = false;
  let likedByMe = false;
  let viewerProfileId = null;
  if (req.user) {
    const profile = await Profile.findOne({ userId: req.user.id }).select('_id');
    if (profile) {
      viewerProfileId = profile._id;
      const [saved, liked] = await Promise.all([
        BoardPin.exists({ owner: profile._id, pinId: pin._id }),
        PinLike.exists({ owner: profile._id, pinId: pin._id }),
      ]);
      savedByMe = !!saved;
      likedByMe = !!liked;
    }
  }

  // A draft is readable only by the person writing it. Everyone else gets the
  // same answer they would get for a pin that does not exist, rather than a
  // 403 that confirms one is there.
  const isAuthor =
    viewerProfileId && String(pin.author?._id ?? pin.author) === String(viewerProfileId);
  if (pin.status === 'draft' && !isAuthor && req.user?.role !== 'admin') {
    throw new AppError('Pin not found.', 404);
  }

  // The flags go on the pin as well as beside it. They used to be returned
  // only alongside, so a pin handed from this screen to anything else — the
  // long-press ring, a share sheet — arrived not knowing whether it was liked,
  // and rendered an empty heart on work the viewer had just liked. The feed
  // puts them on the pin, so this does too and there is one shape to read.
  const shaped = { ...pin.toJSON(), savedByMe, likedByMe };
  res.status(200).json({ success: true, data: { pin: shaped, savedByMe, likedByMe } });
});

// ── POST/DELETE /pins/:id/mute ────────────────────────────────────────────────
// "See fewer like this", recorded server-side. It used to live only on the
// device, which made it a lie twice over: the pin returned on a second phone,
// and ranking never learned from the strongest negative signal a user can give.
export const mutePin = asyncHandler(async (req, res) => {
  const profile = await myProfile(req.user.id);
  const pin = await Pin.findById(req.params.id).select('_id taxonomy.trade');
  if (!pin) throw new AppError('Pin not found.', 404);

  await PinMute.updateOne(
    { owner: profile._id, pinId: pin._id },
    { $setOnInsert: { owner: profile._id, pinId: pin._id, trade: pin.taxonomy?.trade ?? null } },
    { upsert: true }
  );
  res.status(200).json({ success: true, data: { muted: true } });
});

export const unmutePin = asyncHandler(async (req, res) => {
  const profile = await myProfile(req.user.id);
  await PinMute.deleteOne({ owner: profile._id, pinId: req.params.id });
  res.status(200).json({ success: true, data: { muted: false } });
});

// ── POST /pins/:id/share ──────────────────────────────────────────────────────
// Counted when a share sheet is opened rather than when a share completes: the
// OS never tells us whether anything was actually sent, and a number that only
// counts confirmed sends would undercount every WhatsApp forward on the
// platform. It measures intent, and is only ever used as a ranking signal.
export const recordShare = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new AppError('Pin not found.', 404);
  await Pin.updateOne({ _id: req.params.id, status: 'active' }, { $inc: { 'counters.shares': 1 } });
  res.status(204).end();
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
  const pin = await Pin.findById(req.params.id).select('_id status author title');
  if (!pin || pin.status !== 'active') throw new AppError('Pin not found.', 404);

  const existing = await PinLike.findOne({ pinId: pin._id, owner: profile._id });
  if (!existing) {
    await PinLike.create({ pinId: pin._id, owner: profile._id });
    await Pin.updateOne({ _id: pin._id }, { $inc: { 'counters.likes': 1 } });
    // Only on the transition. Re-liking an already-liked pin is idempotent and
    // must not ping the maker a second time.
    const actor = await Profile.findById(profile._id).select('_id fullName').lean();
    await notifyPinLiked(req, { actor, pin });
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

// ── Comments ──────────────────────────────────────────────────────────────────
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

// ── POST /pins/upload/video ───────────────────────────────────────────────────
// Hands back a one-time Cloudflare URL for the phone to upload straight to.
// The file never touches this server: 60MB through Railway would be slow, would
// occupy the dyno for the duration, and would gain nothing.
export const createVideoUpload = asyncHandler(async (req, res) => {
  const profile = await myProfile(req.user.id);
  const { uid, uploadUrl } = await createDirectUpload({ creator: profile._id.toString() });

  res.status(200).json({
    success: true,
    data: { uid, uploadUrl, maxDurationSeconds: MAX_VIDEO_SECONDS },
    message: 'Upload URL created.',
  });
});

// ── GET /pins/upload/video/:uid ───────────────────────────────────────────────
// Transcoding takes time proportional to length, so the client polls this
// instead of an upload request hanging open for a minute.
export const getVideoStatus = asyncHandler(async (req, res) => {
  const video = await getVideo(req.params.uid);
  res.status(200).json({ success: true, data: video });
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
  //
  // Video entries carry a `videoUid` rather than a url. The playback and poster
  // addresses are read back from Cloudflare rather than trusted from the
  // client, so a caller cannot point a "video" at an arbitrary URL, and a pin
  // cannot be created for a video that failed to transcode.
  const album = await normaliseAlbum(req.body.media);

  const lead = album[0];
  const primaryUrl = lead?.url ?? mediaUrl;

  // A draft is allowed to be incomplete — that is the whole point of one, and
  // demanding a title before it can be put down defeats the purpose. Anything
  // going live still has to be a real pin.
  const asDraft = req.body.status === 'draft';
  if (!primaryUrl) throw new AppError('At least one image is required.', 400);
  if (!asDraft && !title) throw new AppError('A title is required to publish.', 400);

  const pin = await Pin.create({
    author: profile._id,
    status: asDraft ? 'draft' : 'active',
    publishedAt: asDraft ? null : new Date(),
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

  res.status(201).json({
    success: true,
    data: { pin },
    message: asDraft ? 'Saved as a draft.' : 'Pin created.',
  });
});

/** The author of a pin, or an admin, or nobody. */
const requireOwnPin = async (req, select = '') => {
  const pin = await Pin.findById(req.params.id).select(select);
  if (!pin || pin.status === 'removed') throw new AppError('Pin not found.', 404);

  const profile = await Profile.findOne({ userId: req.user.id }).select('_id');
  const mine = profile && String(pin.author) === String(profile._id);
  if (!mine && req.user.role !== 'admin') throw new AppError('That is not your pin.', 403);

  return { pin, profile };
};

// ── POST /pins/:id/publish ────────────────────────────────────────────────────
// A draft going live. Everything a published pin needs is checked here rather
// than at draft time, which is the whole bargain: put it down half-finished,
// and the app asks for the rest when it matters.
export const publishPin = asyncHandler(async (req, res) => {
  const { pin } = await requireOwnPin(req, '_id author status title taxonomy mediaUrl');
  if (pin.status !== 'draft') throw new AppError('That pin is already live.', 400);

  if (!pin.title?.trim()) throw new AppError('Give it a title before publishing.', 400);
  if (!pin.taxonomy?.trade) throw new AppError('Pick a trade before publishing.', 400);

  pin.status = 'active';
  pin.publishedAt = new Date();
  await pin.save();

  // Filed on the way out rather than on the way in. The composer deliberately
  // does not board a draft — a board is a shelf of finished things, and putting
  // something nobody can see on one leaves a hole in it — so publishing is
  // where it has to happen or the pin is live and missing from its own author's
  // profile. Best effort: the pin is published either way.
  try {
    await fileOnDefaultBoard(pin);
  } catch (err) {
    console.warn('[publish] could not file on a board:', err.message);
  }

  res.status(200).json({ success: true, data: { pin }, message: 'Published.' });
});

/** Put a newly published pin on its author's first board, making one if needed. */
async function fileOnDefaultBoard(pin) {
  const already = await BoardPin.exists({ owner: pin.author, pinId: pin._id });
  if (already) return;

  const profile = await Profile.findById(pin.author).select('_id role').lean();
  if (!profile) return;

  let board = await Board.findOne({ owner: profile._id }).sort({ createdAt: 1 });
  if (!board) board = await Board.create({ owner: profile._id, name: defaultBoardName(profile.role) });

  await BoardPin.create({ boardId: board._id, pinId: pin._id, owner: profile._id });
  await Promise.all([
    Pin.updateOne({ _id: pin._id }, { $inc: { 'counters.saves': 1 } }),
    Board.updateOne({ _id: board._id }, { $inc: { pinCount: 1 } }),
  ]);
}

// ── POST /pins/:id/unpublish ──────────────────────────────────────────────────
// Back to a draft. The alternative for a maker who posted the wrong photograph
// is deleting the pin and starting again, which loses the comments, the saves
// and the upload — so this exists to make a mistake recoverable rather than
// terminal.
//
// It stays on whatever boards hold it. Other people's boards are theirs, and
// quietly emptying them because an author is editing would be a strange thing
// to do to a stranger.
export const unpublishPin = asyncHandler(async (req, res) => {
  const { pin } = await requireOwnPin(req, '_id author status');
  if (pin.status === 'draft') throw new AppError('That pin is already a draft.', 400);
  if (pin.status !== 'active') throw new AppError('Pin not found.', 404);

  pin.status = 'draft';
  await pin.save();

  res.status(200).json({
    success: true,
    data: { pin },
    message: 'Moved back to your drafts.',
  });
});

// ── POST /pins/:id/duplicate ──────────────────────────────────────────────────
// Copies a pin into a fresh draft. The use is a maker who shoots one job in
// several rooms: the trade, the tags and the media are the same and only the
// caption changes, and retyping all of it is what stops the second one being
// posted at all.
//
// Always a draft, never live: a copy that published itself would put two
// near-identical pins in the feed before anyone had a chance to edit one.
export const duplicatePin = asyncHandler(async (req, res) => {
  const { pin, profile } = await requireOwnPin(req);

  const copy = await Pin.create({
    author: profile?._id ?? pin.author,
    status: 'draft',
    publishedAt: null,
    sourceType: 'native',
    mediaType: pin.mediaType,
    mediaUrl: pin.mediaUrl,
    posterUrl: pin.posterUrl,
    aspectRatio: pin.aspectRatio,
    media: pin.media,
    title: pin.title,
    caption: pin.caption,
    taxonomy: {
      trade: pin.taxonomy?.trade ?? null,
      room: pin.taxonomy?.room ?? null,
      budgetBand: pin.taxonomy?.budgetBand ?? null,
      tags: pin.taxonomy?.tags ?? [],
    },
    // Counters deliberately start at zero. Inheriting the original's saves
    // would be a lie about work nobody has seen yet.
  });

  res.status(201).json({ success: true, data: { pin: copy }, message: 'Copied to your drafts.' });
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

  /*
   * The photograph itself.
   *
   * This was not editable at all — EDITABLE_FIELDS was title and caption, so a
   * client could upload a replacement, be told it had uploaded, send it, and
   * watch the pin keep its old image. The upload had genuinely succeeded; the
   * PATCH dropped it on the floor without a word, which is the worst of both.
   *
   * Accepts a full `media` album or the flat single-item form, the same two
   * shapes create accepts, and runs both through the same normaliser — so a
   * replacement video is verified with Cloudflare rather than trusted, exactly
   * as it is on the way in.
   */
  const replacement = await normaliseAlbum(req.body.media);
  const lead = replacement[0];
  const flatUrl = typeof req.body.mediaUrl === 'string' ? req.body.mediaUrl.trim() : null;

  if (lead) {
    pin.media = replacement;
    pin.mediaType = lead.type;
    pin.mediaUrl = lead.url;
    pin.posterUrl = lead.posterUrl;
    if (typeof lead.aspectRatio === 'number') pin.aspectRatio = lead.aspectRatio;
  } else if (flatUrl && flatUrl !== pin.mediaUrl) {
    pin.mediaUrl = flatUrl;
    pin.mediaType = req.body.mediaType === 'video' ? 'video' : 'image';
    if (req.body.posterUrl !== undefined) pin.posterUrl = req.body.posterUrl || undefined;
    if (typeof req.body.aspectRatio === 'number') pin.aspectRatio = req.body.aspectRatio;
    // The album mirrors the flat fields, or the detail view would keep showing
    // the old picture from media[0] while the grid showed the new one.
    pin.media = [
      {
        type: pin.mediaType,
        url: pin.mediaUrl,
        posterUrl: pin.posterUrl,
        aspectRatio: pin.aspectRatio,
      },
    ];
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

  // Pins are soft-deleted so moderation keeps the record, but video is not:
  // Cloudflare bills for stored minutes, and a removed pin's video will never
  // be watched again. The uid is recoverable from the playback URL.
  for (const item of pin.media ?? []) {
    if (item.type !== 'video' || !item.url) continue;
    const uid = item.url.match(/cloudflarestream\.com\/([^/]+)\//)?.[1];
    if (uid) await deleteVideo(uid);
  }

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
