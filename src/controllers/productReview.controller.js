import mongoose from 'mongoose';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import ProductReview from '../models/ProductReview.js';
import Profile from '../models/Profile.js';
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess, sendPaginated } from '../utils/apiResponse.js';
import { getPagination, buildPaginationMeta } from '../utils/paginate.js';
import { refId } from '../utils/refId.js';

/**
 * Recalculate a product's average and its star breakdown.
 *
 * The breakdown is stored, not derived on read: a product page shows it above
 * the reviews themselves, and running an aggregation for every card that wants
 * a star is how a shop grid becomes slow.
 *
 * Best-effort. A review that saved but failed to update the average is a stale
 * number; a review that refused to save because the average failed is lost
 * writing.
 */
export const recomputeProductRating = async (productId) => {
  const rows = await ProductReview.aggregate([
    { $match: { productId: new mongoose.Types.ObjectId(String(productId)) } },
    { $group: { _id: '$rating', n: { $sum: 1 } } },
  ]);

  const breakdown = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let count = 0;
  let total = 0;
  for (const row of rows) {
    const star = Number(row._id);
    if (!breakdown[star] && breakdown[star] !== 0) continue;
    breakdown[star] = row.n;
    count += row.n;
    total += star * row.n;
  }

  await Product.updateOne(
    { _id: productId },
    {
      $set: {
        // One decimal, so the page shows 4.7 rather than 4.666666666666667.
        rating: count ? Math.round((total / count) * 10) / 10 : 0,
        reviewCount: count,
        ratingBreakdown: breakdown,
      },
    }
  );
};

// ── GET /api/v1/products/:id/reviews ─────────────────────────────────────────
export const listProductReviews = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = { productId: req.params.id };

  // ?stars=5 — the filter every shop offers, because "show me the one-stars" is
  // how people actually read reviews.
  const stars = parseInt(req.query.stars, 10);
  if (stars >= 1 && stars <= 5) filter.rating = stars;

  const [reviews, total] = await Promise.all([
    ProductReview.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('reviewerId', 'fullName avatarUrl')
      .lean(),
    ProductReview.countDocuments(filter),
  ]);

  sendPaginated(
    res,
    reviews.map((r) => ({ ...r, verified: !!r.orderId })),
    buildPaginationMeta(total, page, limit),
    'Reviews retrieved.'
  );
});

// ── POST /api/v1/products/:id/reviews ────────────────────────────────────────
export const createProductReview = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id }).select('_id');
  if (!profile) throw new AppError('Profile not found.', 404);

  const product = await Product.findById(req.params.id).select('_id supplierId isActive');
  if (!product || !product.isActive) throw new AppError('Product not found.', 404);

  if (refId(product.supplierId) === refId(profile._id)) {
    throw new AppError('You cannot review your own listing.', 400);
  }

  const rating = Number(req.body?.rating);
  if (!(rating >= 1 && rating <= 5)) {
    throw new AppError('A rating between 1 and 5 is required.', 400);
  }

  /*
   * Only people who took delivery may review.
   *
   * Same guard the seller reviews use, and for the same reason: without it any
   * account can score any listing, and a marketplace whose ratings can be
   * manufactured has ratings worth nothing. The order is recorded on the review
   * so the badge can say "verified" without deriving it again.
   */
  const order = await Order.findOne({
    buyerId: profile._id,
    status: 'delivered',
    'items.productId': product._id,
  })
    .select('_id')
    .lean();

  if (!order) {
    throw new AppError('You can review this once an order containing it has been delivered.', 403);
  }

  const images = Array.isArray(req.body?.images) ? req.body.images.slice(0, 4) : [];

  let review;
  try {
    review = await ProductReview.create({
      productId: product._id,
      reviewerId: profile._id,
      orderId: order._id,
      rating,
      comment: req.body?.comment,
      images,
    });
  } catch (err) {
    // E11000 — the (productId, reviewerId) unique index.
    if (err.code === 11000) throw new AppError('You have already reviewed this product.', 409);
    throw err;
  }

  await recomputeProductRating(product._id).catch((err) =>
    console.error('[productReviews] recompute failed:', err.message)
  );

  sendSuccess(res, { review }, 'Review posted.', 201);
});

// ── DELETE /api/v1/products/:id/reviews/:reviewId ────────────────────────────
export const deleteProductReview = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id }).select('_id');
  if (!profile) throw new AppError('Profile not found.', 404);

  const review = await ProductReview.findById(req.params.reviewId);
  if (!review) throw new AppError('Review not found.', 404);

  const mine = refId(review.reviewerId) === refId(profile._id);
  if (!mine && req.user.role !== 'admin') {
    throw new AppError('You can only remove your own review.', 403);
  }

  await review.deleteOne();
  await recomputeProductRating(review.productId).catch(() => {});

  sendSuccess(res, null, 'Review removed.');
});
