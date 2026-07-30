import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/AppError.js';
import Follow from '../models/Follow.js';
import Profile from '../models/Profile.js';
import { notifyFollowed } from '../services/feedNotify.service.js';

const myProfile = async (userId) => {
  const profile = await Profile.findOne({ userId }).select('_id');
  if (!profile) throw new AppError('Profile not found.', 404);
  return profile;
};

// ── POST /profiles/:id/follow ─────────────────────────────────────────────────
export const follow = asyncHandler(async (req, res) => {
  const me = await myProfile(req.user.id);
  const target = await Profile.findById(req.params.id).select('_id role');
  if (!target) throw new AppError('Profile not found.', 404);
  if (target._id.toString() === me._id.toString()) {
    throw new AppError('You cannot follow yourself.', 400);
  }
  /**
   * Anybody but staff.
   *
   * This used to be artisans and suppliers only, which made the follow button vanish on
   * every client profile — and clients post pins and keep public boards like everybody
   * else, so there was already something to follow. The rule was describing an older
   * shape of the app.
   *
   * Staff stay unfollowable: a Sintherior account is not a person to keep up with, and a
   * follower count on one would be a vanity number on an official channel.
   */
  if (target.role === 'admin') {
    throw new AppError('Sintherior accounts cannot be followed.', 400);
  }

  try {
    await Follow.create({ follower: me._id, followed: target._id });
  } catch (err) {
    if (err.code !== 11000) throw err; // already following — idempotent
  }
  const actor = await Profile.findById(me._id).select('_id fullName').lean();
  await notifyFollowed(req, { actor, followedProfileId: target._id });

  const followers = await Follow.countDocuments({ followed: target._id });
  res.status(200).json({ success: true, data: { isFollowing: true, followers }, message: 'Following.' });
});

// ── DELETE /profiles/:id/follow ───────────────────────────────────────────────
export const unfollow = asyncHandler(async (req, res) => {
  const me = await myProfile(req.user.id);
  await Follow.findOneAndDelete({ follower: me._id, followed: req.params.id });
  const followers = await Follow.countDocuments({ followed: req.params.id });
  res.status(200).json({ success: true, data: { isFollowing: false, followers }, message: 'Unfollowed.' });
});

// ── GET /profiles/:id/follow ──────────────────────────────────────────────────
// Public counts; isFollowing personalized when authenticated (optionalAuth).
export const followStatus = asyncHandler(async (req, res) => {
  const followers = await Follow.countDocuments({ followed: req.params.id });
  let isFollowing = false;
  if (req.user) {
    const me = await Profile.findOne({ userId: req.user.id }).select('_id');
    if (me) isFollowing = !!(await Follow.exists({ follower: me._id, followed: req.params.id }));
  }
  res.status(200).json({ success: true, data: { isFollowing, followers } });
});
