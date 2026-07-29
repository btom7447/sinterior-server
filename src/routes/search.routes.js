import { Router } from 'express';
import { protect, optionalAuth, restrictTo } from '../middleware/auth.js';
import { searchEverything, getSearchGaps } from '../controllers/search.controller.js';

const router = Router();

// Public. Searching is how people decide whether this app is worth signing up
// for, so it cannot sit behind an account.
router.get('/', optionalAuth, searchEverything);

// What people looked for and did not find. Admin only: it is aggregate data
// with no names in it, but it is still a business view rather than a user one.
router.get('/gaps', protect, restrictTo('admin'), getSearchGaps);

export default router;
