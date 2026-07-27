import { Router } from 'express';
import { protect, optionalAuth, restrictTo } from '../middleware/auth.js';
import {
  getTaxonomy,
  getFeed,
  getPin,
  createPin,
  updatePin,
  deletePin,
} from '../controllers/pin.controller.js';

const router = Router();

router.get('/taxonomy', getTaxonomy);      // GET /pins/taxonomy — trades/rooms/bands
router.get('/feed', optionalAuth, getFeed); // GET /pins/feed — public, personalized when authed
router.get('/:id', optionalAuth, getPin);   // GET /pins/:id — public (savedByMe when authed)

router.post('/', protect, restrictTo('artisan', 'supplier'), createPin);
router.patch('/:id', protect, updatePin);   // owner or admin (checked in controller)
router.delete('/:id', protect, deletePin);  // owner or admin (soft delete)

export default router;
