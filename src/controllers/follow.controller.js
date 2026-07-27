import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/AppError.js';
import Follow from '../models/Follow.js';
import Profile from '../models/Profile.js';

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
  if (!['artisan', 'supplier'].includes(target.role)) {
    throw new AppError('Only artisans and suppliers can be followed.', 400);
  }

  try {
    await Follow.create({ follower: me._id, followed: target._id });
  } catch (err) {
    if (err.code !== 11000) throw err; // already following — idempotent
  }
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
