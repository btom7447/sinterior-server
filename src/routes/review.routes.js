import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import {
  createReview,
  getArtisanReviews,
  getMyReviews,
  deleteReview,
  validateReview,
} from '../controllers/review.controller.js';

const router = Router();

router.get('/me', protect, getMyReviews);
router.get('/artisan/:artisanId', getArtisanReviews);
router.post('/', protect, validateReview, createReview);
router.delete('/:id', protect, deleteReview);

export default router;
