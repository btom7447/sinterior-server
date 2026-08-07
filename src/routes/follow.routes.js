import { Router } from 'express';
import { protect, optionalAuth } from '../middleware/auth.js';
import { follow, unfollow, followStatus } from '../controllers/follow.controller.js';
import { block, unblock, blockStatus, myBlocks } from '../controllers/block.controller.js';

// Mounted at /api/v1 — paths live under /profiles/:id/follow (same pattern as
// bank.routes mounting /banks under the version root).
const router = Router();

// Before /profiles/:id/*, or "blocks" is read as a profile id.
router.get('/profiles/blocks', protect, myBlocks);

router.get('/profiles/:id/follow', optionalAuth, followStatus);
router.post('/profiles/:id/follow', protect, follow);
router.delete('/profiles/:id/follow', protect, unfollow);

// Blocking lives beside following: the same profile-to-profile pair, and the
// two interact — a block clears any follow in either direction.
router.get('/profiles/:id/block', optionalAuth, blockStatus);
router.post('/profiles/:id/block', protect, block);
router.delete('/profiles/:id/block', protect, unblock);

export default router;
