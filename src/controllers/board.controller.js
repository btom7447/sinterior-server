import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/AppError.js';
import Board from '../models/Board.js';
import BoardFollow from '../models/BoardFollow.js';
import BoardLike from '../models/BoardLike.js';
import BoardPin from '../models/BoardPin.js';
import Pin from '../models/Pin.js';
import Profile from '../models/Profile.js';
import { getPagination, buildPaginationMeta } from '../utils/paginate.js';
import { resolvePinAlbum, resolveUploadUrl } from '../utils/resolveUrl.js';
import {
  notifyBoardFollowed,
  notifyBoardLiked,
  notifyPinSaved,
} from '../services/feedNotify.service.js';

const myProfile = async (userId) => {
  const profile = await Profile.findOne({ userId }).select('_id');
  if (!profile) throw new AppError('Profile not found.', 404);
  return profile;
};

const PREVIEW_PER_BOARD = 3;

/**
 * How many saves to consider per board before picking the three to show.
 *
 * More than three, because a save can point at a pin that is no longer live —
 * a draft the author pulled back, or work they removed. Those have to be
 * skipped over rather than counted, and skipping only works if there are
 * candidates behind them.
 */
const PREVIEW_CANDIDATES = 12;

/**
 * Newest pin media per board, for the mosaic on a board card.
 * One aggregation plus one find, regardless of how many boards there are.
 *
 * The order matters: candidates are collected, then narrowed to live pins, then
 * cut to three. Cutting to three first — which is what this did — meant one
 * unpublished pin among the newest saves cost the board a tile, so a board with
 * four saves and three live pins showed two.
 */
const previewsForBoards = async (boardIds) => {
  if (!boardIds.length) return new Map();

  const grouped = await BoardPin.aggregate([
    { $match: { boardId: { $in: boardIds } } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: '$boardId', pinIds: { $push: '$pinId' } } },
    { $project: { pinIds: { $slice: ['$pinIds', PREVIEW_CANDIDATES] } } },
  ]);

  const allIds = grouped.flatMap((g) => g.pinIds);
  const pins = await Pin.find({ _id: { $in: allIds }, status: 'active' })
    .select('mediaUrl posterUrl mediaType')
    .lean();
  const mediaById = new Map(
    pins.map((p) => [
      p._id.toString(),
      resolveUploadUrl(p.mediaType === 'video' ? p.posterUrl || p.mediaUrl : p.mediaUrl),
    ])
  );

  return new Map(
    grouped.map((g) => [
      g._id.toString(),
      g.pinIds
        .map((id) => mediaById.get(id.toString()))
        .filter(Boolean)
        // Newest first is preserved by the aggregation; this only trims.
        .slice(0, PREVIEW_PER_BOARD),
    ])
  );
};

// ── GET /boards (mine) ────────────────────────────────────────────────────────
export const listMyBoards = asyncHandler(async (req, res) => {
  const profile = await myProfile(req.user.id);
  // Dragged order first where it exists, then most recently touched. Mongo
  // sorts null before numbers ascending, so boards that have never been moved
  // would jump to the front — the boolean below pushes them behind the ones
  // that have, without needing to number every board on the first drag.
  const raw = await Board.aggregate([
    { $match: { owner: profile._id } },
    { $addFields: { unordered: { $cond: [{ $eq: [{ $ifNull: ['$order', null] }, null] }, 1, 0] } } },
    { $sort: { unordered: 1, order: 1, updatedAt: -1 } },
    { $project: { unordered: 0 } },
  ]);
  const previews = await previewsForBoards(raw.map((b) => b._id));

  const boards = raw.map((b) => ({
    ...b,
    coverUrl: resolveUploadUrl(b.coverUrl),
    previewUrls: previews.get(b._id.toString()) ?? [],
  }));
  res.status(200).json({ success: true, data: { boards } });
});

// -- GET /boards/by-profile/:profileId -----------------------------------------
/**
 * Somebody else's public boards.
 *
 * A client does not post work, so a profile built around a portfolio has nothing to show
 * for most of the people on the platform — and what a client *does* have is collections:
 * the rooms they are saving towards, which is the most useful thing an artisan could see
 * before quoting for them.
 *
 * Private boards never appear. The privacy flag is the whole contract of a private board
 * and this is a public endpoint, so it is filtered in the query rather than after it.
 */
export const getProfileBoards = asyncHandler(async (req, res) => {
  const { profileId } = req.params;
  if (!mongoose.isValidObjectId(profileId)) throw new AppError('Profile not found.', 404);

  const limit = Math.min(24, Math.max(1, parseInt(req.query.limit, 10) || 12));

  const raw = await Board.find({
    owner: profileId,
    isPrivate: { $ne: true },
    // A board with nothing in it is a name, not a collection.
    pinCount: { $gt: 0 },
  })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();

  const previews = await previewsForBoards(raw.map((b) => b._id));

  const boards = raw.map((b) => ({
    _id: b._id,
    name: b.name,
    pinCount: b.pinCount,
    coverUrl: resolveUploadUrl(b.coverUrl),
    previewUrls: previews.get(b._id.toString()) ?? [],
  }));

  res.status(200).json({ success: true, data: { boards } });
});

// -- GET /boards/featured -----------------------------------------------------────────
// Public boards worth browsing: someone else's collection is the best possible
// entry point into a taxonomy nobody wants to read. Private boards never appear
// here, and boards too thin to fill a mosaic are left out rather than shown
// half empty.
const FEATURED_MIN_PINS = 3;

export const getFeaturedBoards = asyncHandler(async (req, res) => {
  const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 8));

  // Over-fetch, then rank by followers. Followers are the real signal (someone
  // chose to keep watching this collection); size and recency only break ties.
  const candidates = await Board.find({
    isPrivate: { $ne: true },
    pinCount: { $gte: FEATURED_MIN_PINS },
  })
    .sort({ pinCount: -1, updatedAt: -1 })
    .limit(limit * 4)
    .populate('owner', 'fullName avatarUrl role')
    .lean();

  const followerCounts = await BoardFollow.aggregate([
    { $match: { board: { $in: candidates.map((b) => b._id) } } },
    { $group: { _id: '$board', n: { $sum: 1 } } },
  ]);
  const followersById = new Map(followerCounts.map((f) => [f._id.toString(), f.n]));

  const raw = candidates
    .map((b) => ({ ...b, followerCount: followersById.get(b._id.toString()) ?? 0 }))
    .sort((a, b) => b.followerCount - a.followerCount || b.pinCount - a.pinCount)
    .slice(0, limit);

  const previews = await previewsForBoards(raw.map((b) => b._id));
  const boards = raw.map((b) => ({
    ...b,
    coverUrl: resolveUploadUrl(b.coverUrl),
    previewUrls: previews.get(b._id.toString()) ?? [],
    owner: b.owner ? { ...b.owner, avatarUrl: resolveUploadUrl(b.owner.avatarUrl) } : null,
  }));

  res.status(200).json({ success: true, data: { boards } });
});

// ── POST/DELETE /boards/:id/follow ────────────────────────────────────────────
// Idempotent both ways; the unique index absorbs a double tap. Private boards
// cannot be followed, and the owner following their own board is a no-op.
export const followBoard = asyncHandler(async (req, res) => {
  const profile = await myProfile(req.user.id);
  const board = await Board.findById(req.params.id).select('_id owner isPrivate');
  if (!board || board.isPrivate) throw new AppError('Board not found.', 404);
  if (board.owner.toString() === profile._id.toString()) {
    throw new AppError('That board is already yours.', 400);
  }

  await BoardFollow.updateOne(
    { follower: profile._id, board: board._id },
    { $setOnInsert: { follower: profile._id, board: board._id } },
    { upsert: true }
  );
  const actor = await Profile.findById(profile._id).select('_id fullName').lean();
  await notifyBoardFollowed(req, { actor, board });

  const followerCount = await BoardFollow.countDocuments({ board: board._id });
  res.status(200).json({ success: true, data: { followedByMe: true, followerCount } });
});

export const unfollowBoard = asyncHandler(async (req, res) => {
  const profile = await myProfile(req.user.id);
  await BoardFollow.deleteOne({ follower: profile._id, board: req.params.id });
  const followerCount = await BoardFollow.countDocuments({ board: req.params.id });
  res.status(200).json({ success: true, data: { followedByMe: false, followerCount } });
});

// ── POST/DELETE /boards/:id/like ──────────────────────────────────────────────
// Separate from following on purpose. Following is a subscription and changes
// your feed; liking is applause and changes what gets featured. Without both, a
// user cannot say "this collection is good" without committing to see more of
// it forever.
export const likeBoard = asyncHandler(async (req, res) => {
  const profile = await myProfile(req.user.id);
  const board = await Board.findById(req.params.id).select('_id owner name isPrivate');
  if (!board || board.isPrivate) throw new AppError('Board not found.', 404);

  const existing = await BoardLike.findOne({ owner: profile._id, board: board._id });
  if (!existing) {
    await BoardLike.create({ owner: profile._id, board: board._id });
    const actor = await Profile.findById(profile._id).select('_id fullName').lean();
    await notifyBoardLiked(req, { actor, board });
  }

  const likeCount = await BoardLike.countDocuments({ board: board._id });
  res.status(200).json({ success: true, data: { likedByMe: true, likeCount } });
});

export const unlikeBoard = asyncHandler(async (req, res) => {
  const profile = await myProfile(req.user.id);
  await BoardLike.deleteOne({ owner: profile._id, board: req.params.id });
  const likeCount = await BoardLike.countDocuments({ board: req.params.id });
  res.status(200).json({ success: true, data: { likedByMe: false, likeCount } });
});

// ── GET /boards/saved ─────────────────────────────────────────────────────────
// Everything the signed-in user has saved, newest first, across every board.
// Grouped by pin so a pin kept on three boards appears once, dated by its most
// recent save.
export const getSavedPins = asyncHandler(async (req, res) => {
  const profile = await myProfile(req.user.id);
  const boards = await Board.find({ owner: profile._id }).select('_id').lean();
  const boardIds = boards.map((b) => b._id);

  const { page, limit, skip } = getPagination(req.query);
  if (!boardIds.length) {
    return res.status(200).json({
      success: true,
      data: { pins: [] },
      pagination: buildPaginationMeta(0, page, limit),
    });
  }

  // Pinned first, then newest. A pin the owner deliberately put at the top has
  // to stay there as more is saved underneath it, which is the only thing that
  // makes pinning worth doing.
  //
  // Within the pinned group the order is oldest-pinned-first, so pinning
  // something new queues it behind what is already up there rather than
  // displacing it. Somebody who pinned three things in an order meant that
  // order; the newest arrival is not automatically the most important.
  const base = [
    { $match: { boardId: { $in: boardIds } } },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: '$pinId',
        savedAt: { $first: '$createdAt' },
        // A pin can sit on several boards; it counts as pinned if it is pinned
        // on any of them, and the earliest pin is the one that fixed its place.
        pinnedAt: { $min: '$pinnedAt' },
      },
    },
    // Mongo sorts null before dates ascending, so pinnedAt alone would put
    // everything unpinned at the top. This splits the groups first.
    { $addFields: { unpinned: { $cond: [{ $ifNull: ['$pinnedAt', false] }, 0, 1] } } },
    { $sort: { unpinned: 1, pinnedAt: 1, savedAt: -1 } },
  ];

  const [counted, rows] = await Promise.all([
    BoardPin.aggregate([...base, { $count: 'n' }]),
    BoardPin.aggregate([...base, { $skip: skip }, { $limit: limit }]),
  ]);

  const found = await Pin.find({ _id: { $in: rows.map((r) => r._id) }, status: 'active' })
    .populate('author', 'fullName avatarUrl role city state')
    .lean();
  const byId = new Map(found.map((p) => [p._id.toString(), p]));

  // Restore the save order the aggregation established.
  const pins = rows
    .map((r) => {
      const pin = byId.get(r._id.toString());
      return pin ? { pin, pinnedAt: r.pinnedAt ?? null, savedAt: r.savedAt ?? null } : null;
    })
    .filter(Boolean)
    .map(({ pin: p, pinnedAt, savedAt }) => ({
      ...p,
      mediaUrl: resolveUploadUrl(p.mediaUrl),
      posterUrl: p.posterUrl ? resolveUploadUrl(p.posterUrl) : undefined,
      media: resolvePinAlbum(p.media),
      author: p.author
        ? { ...p.author, avatarUrl: resolveUploadUrl(p.author.avatarUrl) }
        : null,
      // Carried onto the pin so a card can show it is pinned without the grid
      // having to hold a second list of which ones are.
      pinnedAt,
      // The app needs this to put an unpinned card back where it belongs
      // without waiting for a refetch. A pin's own createdAt is when the work
      // was posted, which is a different date entirely.
      savedAt,
      savedByMe: true,
    }));

  res.status(200).json({
    success: true,
    data: { pins },
    pagination: buildPaginationMeta(counted[0]?.n ?? 0, page, limit),
  });
});

// ── POST /boards ──────────────────────────────────────────────────────────────
export const createBoard = asyncHandler(async (req, res) => {
  const profile = await myProfile(req.user.id);
  const { name, description, isPrivate } = req.body;
  if (!name?.trim()) throw new AppError('Board name is required.', 400);

  try {
    const board = await Board.create({
      owner: profile._id,
      name: name.trim(),
      description,
      isPrivate: !!isPrivate,
    });
    res.status(201).json({ success: true, data: { board }, message: 'Board created.' });
  } catch (err) {
    if (err.code === 11000) throw new AppError('You already have a board with that name.', 409);
    throw err;
  }
});

// ── PATCH /boards/:id ─────────────────────────────────────────────────────────
export const updateBoard = asyncHandler(async (req, res) => {
  const profile = await myProfile(req.user.id);
  const board = await Board.findOne({ _id: req.params.id, owner: profile._id });
  if (!board) throw new AppError('Board not found.', 404);

  if (req.body.name !== undefined) board.name = String(req.body.name).trim();
  if (req.body.description !== undefined) board.description = req.body.description;
  if (req.body.isPrivate !== undefined) board.isPrivate = !!req.body.isPrivate;

  try {
    // timestamps off on purpose. The shelf falls back to most-recently-touched
    // order, and "touched" should mean something was filed here — not that its
    // name or its privacy was changed. Letting those bump updatedAt made a
    // board jump to the front of the shelf for being renamed, which reads as
    // the grid glitching rather than as anything the owner asked for.
    await board.save({ timestamps: false });
  } catch (err) {
    if (err.code === 11000) throw new AppError('You already have a board with that name.', 409);
    throw err;
  }
  res.status(200).json({ success: true, data: { board }, message: 'Board updated.' });
});

// ── DELETE /boards/:id ────────────────────────────────────────────────────────
// Removes memberships and rolls back the affected pins' save counters.
export const deleteBoard = asyncHandler(async (req, res) => {
  const profile = await myProfile(req.user.id);
  const board = await Board.findOne({ _id: req.params.id, owner: profile._id });
  if (!board) throw new AppError('Board not found.', 404);

  const memberships = await BoardPin.find({ boardId: board._id }).select('pinId').lean();
  if (memberships.length) {
    await Promise.all([
      BoardPin.deleteMany({ boardId: board._id }),
      Pin.updateMany(
        { _id: { $in: memberships.map((m) => m.pinId) } },
        { $inc: { 'counters.saves': -1 } }
      ),
    ]);
  }
  await board.deleteOne();
  res.status(200).json({ success: true, data: null, message: 'Board deleted.' });
});

// ── GET /boards/:id (+pins) ───────────────────────────────────────────────────
// Owner always; others only when the board is public (enforced here, not UI).
export const getBoard = asyncHandler(async (req, res) => {
  const board = await Board.findById(req.params.id).populate('owner', 'fullName avatarUrl role');
  if (!board) throw new AppError('Board not found.', 404);

  let isOwner = false;
  if (req.user) {
    const profile = await Profile.findOne({ userId: req.user.id }).select('_id');
    isOwner = profile && board.owner._id.toString() === profile._id.toString();
  }
  if (board.isPrivate && !isOwner && req.user?.role !== 'admin') {
    throw new AppError('Board not found.', 404); // don't leak existence
  }

  const { page, limit, skip } = getPagination(req.query);
  const [memberships, total] = await Promise.all([
    BoardPin.find({ boardId: board._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate({ path: 'pinId', match: { status: 'active' } })
      .lean(),
    BoardPin.countDocuments({ boardId: board._id }),
  ]);
  const pins = memberships
    .map((m) => m.pinId)
    .filter(Boolean)
    .map((p) => ({
      ...p,
      mediaUrl: resolveUploadUrl(p.mediaUrl),
      posterUrl: p.posterUrl ? resolveUploadUrl(p.posterUrl) : undefined,
      media: resolvePinAlbum(p.media),
    }));

  const [followerCount, followedByMe, likeCount, likedByMe] = await Promise.all([
    BoardFollow.countDocuments({ board: board._id }),
    req.user
      ? Profile.findOne({ userId: req.user.id })
          .select('_id')
          .lean()
          .then((p) => (p ? BoardFollow.exists({ follower: p._id, board: board._id }) : null))
      : null,
    BoardLike.countDocuments({ board: board._id }),
    req.user
      ? Profile.findOne({ userId: req.user.id })
          .select('_id')
          .lean()
          .then((p) => (p ? BoardLike.exists({ owner: p._id, board: board._id }) : null))
      : null,
  ]);

  const audience = await audienceForBoard(board._id, board.owner?._id);

  res.status(200).json({
    success: true,
    data: {
      board,
      pins,
      isOwner,
      followerCount,
      followedByMe: !!followedByMe,
      likeCount,
      likedByMe: !!likedByMe,
      audience,
    },
    pagination: buildPaginationMeta(total, page, limit),
  });
});

/** How many faces to send. Past this a row of avatars stops being readable. */
const AUDIENCE_FACES = 5;

/**
 * The people who have shown this board something: followed it or liked it.
 *
 * One row of faces plus a count is the most compact honest answer to "does
 * anybody care about this", which on a marketplace is what a client is really
 * asking when they look at an artisan's collection.
 *
 * Followers and likers are pooled and de-duplicated, because somebody who did
 * both is one person and showing them twice would inflate a thin board. The
 * owner is excluded — being interested in your own board is not a signal.
 */
async function audienceForBoard(boardId, ownerId) {
  const [follows, likes] = await Promise.all([
    BoardFollow.find({ board: boardId }).sort({ createdAt: -1 }).select('follower').lean(),
    BoardLike.find({ board: boardId }).sort({ createdAt: -1 }).select('owner').lean(),
  ]);

  const ids = [];
  const seen = new Set(ownerId ? [String(ownerId)] : []);
  for (const id of [...follows.map((f) => f.follower), ...likes.map((l) => l.owner)]) {
    const key = String(id);
    if (seen.has(key)) continue;
    seen.add(key);
    ids.push(id);
  }

  // Only the faces are fetched; the total is the whole pool, so "+3" means three
  // more people rather than three more rows nobody asked for.
  const faces = await Profile.find({ _id: { $in: ids.slice(0, AUDIENCE_FACES) } })
    .select('fullName avatarUrl')
    .lean();

  // Restore the recency order the ids were collected in.
  const byId = new Map(faces.map((f) => [String(f._id), f]));
  return {
    total: ids.length,
    people: ids
      .slice(0, AUDIENCE_FACES)
      .map((id) => byId.get(String(id)))
      .filter(Boolean)
      .map((f) => ({ _id: f._id, fullName: f.fullName, avatarUrl: resolveUploadUrl(f.avatarUrl) })),
  };
}

// ── POST /boards/:id/pins { pinId } — save ───────────────────────────────────
export const savePinToBoard = asyncHandler(async (req, res) => {
  const profile = await myProfile(req.user.id);
  const board = await Board.findOne({ _id: req.params.id, owner: profile._id });
  if (!board) throw new AppError('Board not found.', 404);

  const pin = await Pin.findOne({ _id: req.body.pinId, status: 'active' });
  if (!pin) throw new AppError('Pin not found.', 404);

  try {
    await BoardPin.create({ boardId: board._id, pinId: pin._id, owner: profile._id });
  } catch (err) {
    if (err.code === 11000) {
      // Already on this board — idempotent success.
      return res.status(200).json({ success: true, data: { saved: true }, message: 'Already saved.' });
    }
    throw err;
  }

  await Promise.all([
    Pin.updateOne({ _id: pin._id }, { $inc: { 'counters.saves': 1 } }),
    Board.updateOne(
      { _id: board._id },
      { $inc: { pinCount: 1 }, $set: { coverUrl: pin.mediaUrl } }
    ),
  ]);

  const actor = await Profile.findById(profile._id).select('_id fullName').lean();
  await notifyPinSaved(req, { actor, pin, boardName: board.name });

  res.status(201).json({ success: true, data: { saved: true }, message: 'Saved.' });
});

// ── DELETE /boards/:id/pins/:pinId — unsave ──────────────────────────────────
export const removePinFromBoard = asyncHandler(async (req, res) => {
  const profile = await myProfile(req.user.id);
  const board = await Board.findOne({ _id: req.params.id, owner: profile._id });
  if (!board) throw new AppError('Board not found.', 404);

  const removed = await BoardPin.findOneAndDelete({ boardId: board._id, pinId: req.params.pinId });
  if (removed) {
    await Promise.all([
      Pin.updateOne({ _id: req.params.pinId }, { $inc: { 'counters.saves': -1 } }),
      Board.updateOne({ _id: board._id }, { $inc: { pinCount: -1 } }),
    ]);
  }
  res.status(200).json({ success: true, data: { saved: false }, message: 'Removed from board.' });
});

// ── DELETE /boards/pin/:pinId — take this pin off every board of mine ────────
// The Saved button is a toggle, and a pin can sit on several of one person's
// boards. Untoggling it has to mean "I do not have this saved" rather than
// "removed from one of the three places you put it", which would leave the
// button still reading Saved and looking broken.
//
// The board picker remains the precise tool: this is the blunt one, and it is
// the one the toggle needs.
export const unsavePinEverywhere = asyncHandler(async (req, res) => {
  const profile = await myProfile(req.user.id);
  const memberships = await BoardPin.find({ owner: profile._id, pinId: req.params.pinId })
    .select('boardId')
    .lean();

  if (!memberships.length) {
    return res.status(200).json({ success: true, data: { saved: false, removed: 0 } });
  }

  await BoardPin.deleteMany({ owner: profile._id, pinId: req.params.pinId });

  // Each board loses one, and the pin loses however many boards it was on.
  await Promise.all([
    Pin.updateOne(
      { _id: req.params.pinId, 'counters.saves': { $gte: memberships.length } },
      { $inc: { 'counters.saves': -memberships.length } }
    ),
    ...memberships.map((m) =>
      Board.updateOne({ _id: m.boardId, pinCount: { $gt: 0 } }, { $inc: { pinCount: -1 } })
    ),
  ]);

  res.status(200).json({
    success: true,
    data: { saved: false, removed: memberships.length },
    message: 'Removed from your boards.',
  });
});

// ── PATCH /boards/order — the order the owner dragged their boards into ──────
// Positions arrive as a whole list rather than as a move, because a move is
// only meaningful against a list state the server cannot see. Sending the order
// entire makes the write idempotent and means a dropped request costs nothing
// but the next drag.
export const reorderBoards = asyncHandler(async (req, res) => {
  const profile = await myProfile(req.user.id);
  const ids = Array.isArray(req.body.boardIds) ? req.body.boardIds : [];
  if (!ids.length) throw new AppError('Send the boards in their new order.', 400);

  // Only boards this person owns move, so a crafted list cannot reorder
  // somebody else's shelf.
  const mine = await Board.find({ owner: profile._id, _id: { $in: ids } })
    .select('_id')
    .lean();
  const owned = new Set(mine.map((b) => String(b._id)));

  await Promise.all(
    ids
      .filter((id) => owned.has(String(id)))
      .map((id, at) => Board.updateOne({ _id: id, owner: profile._id }, { $set: { order: at } }))
  );

  res.status(200).json({ success: true, data: { ordered: owned.size } });
});

// ── POST/DELETE /boards/pin/:pinId/top — keep this at the top of my saves ────
// A marker rather than a position: pinning one thing must not renumber
// everything else, and unpinning must not leave a hole.
export const setSavedPinTop = asyncHandler(async (req, res) => {
  const profile = await myProfile(req.user.id);
  const pinnedAt = req.method === 'POST' ? new Date() : null;

  const result = await BoardPin.updateMany(
    { owner: profile._id, pinId: req.params.pinId },
    { $set: { pinnedAt } }
  );
  if (!result.matchedCount) throw new AppError('That pin is not saved.', 404);

  res.status(200).json({
    success: true,
    data: { pinned: !!pinnedAt },
    message: pinnedAt ? 'Pinned to the top.' : 'Unpinned.',
  });
});

// ── GET /boards/pin-state/:pinId — which of my boards hold this pin ──────────
// Powers the one-tap save → board picker UI.
export const getPinBoardState = asyncHandler(async (req, res) => {
  const profile = await myProfile(req.user.id);
  const memberships = await BoardPin.find({ owner: profile._id, pinId: req.params.pinId })
    .select('boardId')
    .lean();
  res.status(200).json({
    success: true,
    data: { boardIds: memberships.map((m) => m.boardId) },
  });
});
