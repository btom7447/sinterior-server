import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/AppError.js';
import Board from '../models/Board.js';
import BoardPin from '../models/BoardPin.js';
import Pin from '../models/Pin.js';
import Profile from '../models/Profile.js';
import { getPagination, buildPaginationMeta } from '../utils/paginate.js';
import { resolveUploadUrl } from '../utils/resolveUrl.js';

const myProfile = async (userId) => {
  const profile = await Profile.findOne({ userId }).select('_id');
  if (!profile) throw new AppError('Profile not found.', 404);
  return profile;
};

// ── GET /boards (mine) ────────────────────────────────────────────────────────
export const listMyBoards = asyncHandler(async (req, res) => {
  const profile = await myProfile(req.user.id);
  const raw = await Board.find({ owner: profile._id }).sort({ updatedAt: -1 }).lean();
  const boards = raw.map((b) => ({ ...b, coverUrl: resolveUploadUrl(b.coverUrl) }));
  res.status(200).json({ success: true, data: { boards } });
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
    await board.save();
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
    }));

  res.status(200).json({
    success: true,
    data: { board, pins, isOwner },
    pagination: buildPaginationMeta(total, page, limit),
  });
});

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
