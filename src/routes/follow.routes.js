import { Router } from 'express';
import { protect, optionalAuth } from '../middleware/auth.js';
import { follow, unfollow, followStatus } from '../controllers/follow.controller.js';

// Mounted at /api/v1 — paths live under /profiles/:id/follow (same pattern as
// bank.routes mounting /banks under the version root).
const router = Router();

router.get('/profiles/:id/follow', optionalAuth, followStatus);
router.post('/profiles/:id/follow', protect, follow);
router.delete('/profiles/:id/follow', protect, unfollow);

export default router;
