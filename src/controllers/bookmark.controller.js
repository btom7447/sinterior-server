import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/AppError.js';
import Bookmark from '../models/Bookmark.js';
import Profile from '../models/Profile.js';
import { getPagination, buildPaginationMeta } from '../utils/paginate.js';

export const toggleBookmark = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) throw new AppError('Profile not found.', 404);

  const { artisanId } = req.body;
  if (!artisanId) throw new AppError('artisanId is required.', 400);

  const existing = await Bookmark.findOne({ userId: profile._id, artisanId });
  if (existing) {
    await existing.deleteOne();
    return res.status(200).json({ success: true, data: { saved: false }, message: 'Bookmark removed.' });
  }

  await Bookmark.create({ userId: profile._id, artisanId });
  res.status(201).json({ success: true, data: { saved: true }, message: 'Artisan saved.' });
});

export const getBookmarks = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) throw new AppError('Profile not found.', 404);

  const { page, limit, skip } = getPagination(req.query);
  const filter = { userId: profile._id };

  const [bookmarks, total] = await Promise.all([
    Bookmark.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate({
        path: 'artisanId',
        select: 'fullName avatarUrl city state',
      }),
    Bookmark.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: { bookmarks },
    pagination: buildPaginationMeta(total, page, limit),
    message: 'Saved artisans retrieved.',
  });
});

export const checkBookmark = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) throw new AppError('Profile not found.', 404);

  const exists = await Bookmark.exists({ userId: profile._id, artisanId: req.params.artisanId });
  res.status(200).json({ success: true, data: { saved: !!exists } });
});
