import { body } from 'express-validator';
import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/AppError.js';
import Review from '../models/Review.js';
import Profile from '../models/Profile.js';
import { getPagination, buildPaginationMeta } from '../utils/paginate.js';
import validate from '../middleware/validate.js';

export const validateReview = [
  body('artisanId').isMongoId().withMessage('Valid artisan ID required'),
  body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be 1-5'),
  body('comment').optional().isString().isLength({ max: 1000 }),
  validate,
];

export const createReview = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) throw new AppError('Profile not found.', 404);

  const { artisanId, rating, comment, orderId } = req.body;

  if (artisanId === profile._id.toString()) {
    throw new AppError('You cannot review yourself.', 400);
  }

  const review = await Review.create({
    reviewerId: profile._id,
    artisanId,
    rating,
    comment,
    orderId,
  });

  res.status(201).json({
    success: true,
    data: { review },
    message: 'Review submitted.',
  });
});

export const getArtisanReviews = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = { artisanId: req.params.artisanId };

  const [reviews, total] = await Promise.all([
    Review.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('reviewerId', 'fullName avatarUrl'),
    Review.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: { reviews },
    pagination: buildPaginationMeta(total, page, limit),
    message: 'Reviews retrieved.',
  });
});

export const getMyReviews = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) throw new AppError('Profile not found.', 404);

  const { page, limit, skip } = getPagination(req.query);
  const filter = { artisanId: profile._id };

  const [reviews, total] = await Promise.all([
    Review.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('reviewerId', 'fullName avatarUrl'),
    Review.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: { reviews },
    pagination: buildPaginationMeta(total, page, limit),
    message: 'Reviews retrieved.',
  });
});

export const deleteReview = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) throw new AppError('Profile not found.', 404);

  const review = await Review.findById(req.params.id);
  if (!review) throw new AppError('Review not found.', 404);
  if (review.reviewerId.toString() !== profile._id.toString()) {
    throw new AppError('Not authorized.', 403);
  }
  await review.deleteOne();
  res.status(200).json({ success: true, data: null, message: 'Review deleted.' });
});
