import { body } from 'express-validator';
import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/AppError.js';
import Review from '../models/Review.js';
import Profile from '../models/Profile.js';
import User from '../models/User.js';
import ArtisanProfile from '../models/ArtisanProfile.js';
import SupplierProfile from '../models/SupplierProfile.js';
import Order from '../models/Order.js';
import Job from '../models/Job.js';
import { getPagination, buildPaginationMeta } from '../utils/paginate.js';
import validate from '../middleware/validate.js';
import { sendEmailSafe } from '../utils/sendEmail.js';
import { newReview as newReviewEmail } from '../utils/emailTemplates.js';

// Recompute review aggregates (count + average rating) for the reviewed profile
// and write them back to ArtisanProfile / SupplierProfile so public pages read
// fresh values. Called after every Review create / delete.
const recomputeAggregates = async (targetProfileId) => {
  const stats = await Review.aggregate([
    { $match: { artisanId: targetProfileId } },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        avg: { $avg: '$rating' },
      },
    },
  ]);
  const count = stats[0]?.count || 0;
  // Round to 1 decimal so the public UI shows e.g. 4.7 not 4.66666.
  const avg = stats[0]?.avg ? Math.round(stats[0].avg * 10) / 10 : 0;

  // Try both — only one will match. updateOne is a no-op if the profile isn't
  // an artisan / isn't a supplier.
  await Promise.all([
    ArtisanProfile.updateOne(
      { profileId: targetProfileId },
      { $set: { rating: avg, reviewCount: count } }
    ),
    SupplierProfile.updateOne(
      { profileId: targetProfileId },
      { $set: { rating: avg, reviewCount: count } }
    ),
  ]);
};

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

  // Anti-spam: require a real transaction between reviewer and reviewed party.
  // Either a delivered order containing an item from the seller, or a completed
  // job between client + artisan. Without this, anyone can flood reviews on
  // any profile.
  const [matchingOrder, matchingJob] = await Promise.all([
    Order.findOne({
      buyerId: profile._id,
      'items.supplierId': artisanId,
      status: 'delivered',
    }).select('_id'),
    Job.findOne({
      $or: [
        { clientId: profile._id, artisanId, status: 'completed' },
        { clientId: profile._id, artisanId, workAccepted: true },
      ],
    }).select('_id'),
  ]);
  if (!matchingOrder && !matchingJob) {
    throw new AppError(
      'You can only review someone after a completed order or accepted job with them.',
      403
    );
  }

  let review;
  try {
    review = await Review.create({
      reviewerId: profile._id,
      artisanId,
      rating,
      comment,
      orderId,
    });
  } catch (err) {
    // E11000 — unique (reviewerId, artisanId) — already reviewed.
    if (err.code === 11000) {
      throw new AppError('You have already reviewed this profile.', 409);
    }
    throw err;
  }

  // Refresh denormalized aggregates so the public page reflects the new review
  // immediately. Failure here shouldn't break the request — log and continue.
  try {
    await recomputeAggregates(artisanId);
  } catch (err) {
    console.error('[reviews] recomputeAggregates failed:', err.message);
  }

  // Email the reviewed artisan
  const artisanProfile = await Profile.findById(artisanId).select('userId');
  if (artisanProfile?.userId) {
    const artisanUser = await User.findById(artisanProfile.userId).select('email');
    if (artisanUser?.email) {
      const { subject, html } = newReviewEmail({
        review,
        reviewerName: profile.fullName,
      });
      sendEmailSafe({ to: artisanUser.email, subject, html });
    }
  }

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
  const targetProfileId = review.artisanId;
  await review.deleteOne();
  // Refresh aggregates so the count + rating drop on public pages.
  try {
    await recomputeAggregates(targetProfileId);
  } catch (err) {
    console.error('[reviews] recomputeAggregates failed:', err.message);
  }
  res.status(200).json({ success: true, data: null, message: 'Review deleted.' });
});
