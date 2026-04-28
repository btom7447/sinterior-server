import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/AppError.js';
import {
  createReview,
  getArtisanReviews,
  getMyReviews,
  deleteReview,
  validateReview,
} from '../controllers/review.controller.js';

const router = Router();

router.get('/me', protect, getMyReviews);

// Path-param form: GET /reviews/artisan/:artisanId
router.get('/artisan/:artisanId', getArtisanReviews);

// Query-param form: GET /reviews?artisanId=...  (used by the public seller
// storefront and artisan profile pages). Delegates to the same handler by
// shimming req.params.
router.get(
  '/',
  asyncHandler(async (req, res, next) => {
    const id = req.query.artisanId;
    if (!id || typeof id !== 'string') {
      throw new AppError('artisanId query param is required.', 400);
    }
    req.params.artisanId = id;
    return getArtisanReviews(req, res, next);
  })
);

router.post('/', protect, validateReview, createReview);
router.delete('/:id', protect, deleteReview);

export default router;
