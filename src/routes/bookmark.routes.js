import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { toggleBookmark, getBookmarks, checkBookmark } from '../controllers/bookmark.controller.js';

const router = Router();

router.use(protect);

router.get('/', getBookmarks);
router.post('/toggle', toggleBookmark);
router.get('/check/:artisanId', checkBookmark);

export default router;
