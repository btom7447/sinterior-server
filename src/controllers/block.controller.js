import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/AppError.js';
import Block from '../models/Block.js';
import Follow from '../models/Follow.js';
import Profile from '../models/Profile.js';
import { sendSuccess } from '../utils/apiResponse.js';

const myProfile = async (userId) => {
  const profile = await Profile.findOne({ userId }).select('_id');
  if (!profile) throw new AppError('Profile not found.', 404);
  return profile;
};

// ── POST /profiles/:id/block ─────────────────────────────────────────────────
export const block = asyncHandler(async (req, res) => {
  const me = await myProfile(req.user.id);
  const target = await Profile.findById(req.params.id).select('_id role');
  if (!target) throw new AppError('Profile not found.', 404);
  if (target._id.toString() === me._id.toString()) {
    throw new AppError('You cannot block yourself.', 400);
  }
  /*
   * Staff stay reachable.
   *
   * Blocking the Sintherior account would cut somebody off from the only party
   * who can help them with a dispute — which is the opposite of what a safety
   * feature is for.
   */
  if (target.role === 'admin') {
    throw new AppError('Sintherior accounts cannot be blocked.', 400);
  }

  try {
    await Block.create({
      blocker: me._id,
      blocked: target._id,
      reason: req.body?.reason?.trim() || undefined,
    });
  } catch (err) {
    if (err.code !== 11000) throw err; // already blocked — idempotent
  }

  /*
   * A block undoes any following in both directions.
   *
   * Leaving a follow in place would keep the blocked person's work arriving in
   * the blocker's feed through the follow path, which is precisely the thing
   * they just asked to stop.
   */
  await Follow.deleteMany({
    $or: [
      { follower: me._id, followed: target._id },
      { follower: target._id, followed: me._id },
    ],
  });

  // The blocked party is never notified. Telling them is how a block becomes an
  // escalation, and it is the reason neither store expects it.
  sendSuccess(res, { blocked: true }, 'Blocked.');
});

// ── DELETE /profiles/:id/block ───────────────────────────────────────────────
export const unblock = asyncHandler(async (req, res) => {
  const me = await myProfile(req.user.id);
  await Block.deleteOne({ blocker: me._id, blocked: req.params.id });
  // Following is not restored: it was a decision the block replaced, and
  // silently re-subscribing somebody is a surprise nobody asked for.
  sendSuccess(res, { blocked: false }, 'Unblocked.');
});

// ── GET /profiles/:id/block — is this one blocked, either way ────────────────
export const blockStatus = asyncHandler(async (req, res) => {
  if (!req.user) return sendSuccess(res, { blocked: false, blockedBy: false });
  const me = await myProfile(req.user.id);
  const [mine, theirs] = await Promise.all([
    Block.exists({ blocker: me._id, blocked: req.params.id }),
    Block.exists({ blocker: req.params.id, blocked: me._id }),
  ]);
  sendSuccess(res, { blocked: !!mine, blockedBy: !!theirs });
});

// ── GET /profiles/blocks — everyone I have blocked ──────────────────────────
export const myBlocks = asyncHandler(async (req, res) => {
  const me = await myProfile(req.user.id);
  const rows = await Block.find({ blocker: me._id })
    .sort({ createdAt: -1 })
    .populate('blocked', 'fullName avatarUrl role')
    .lean();
  sendSuccess(res, { blocks: rows }, 'Blocked accounts retrieved.');
});

/**
 * Every profile id this person cannot see, in either direction.
 *
 * One query, cached per request by the caller, so the feed and search can strip
 * blocked accounts without asking twice. Both directions: somebody who blocked
 * you should not have their work shown to you either, or blocking becomes a way
 * to keep watching while refusing to be watched.
 */
export const hiddenProfileIds = async (profileId) => {
  if (!profileId) return [];
  const rows = await Block.find({
    $or: [{ blocker: profileId }, { blocked: profileId }],
  })
    .select('blocker blocked')
    .lean();

  const ids = new Set();
  for (const row of rows) {
    const other =
      String(row.blocker) === String(profileId) ? row.blocked : row.blocker;
    ids.add(String(other));
  }
  return [...ids];
};
