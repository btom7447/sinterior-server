import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import { toggleBookmark, getBookmarks, checkBookmark } from '../controllers/bookmark.controller.js';

const router = Router();

router.use(protect);

router.get('/', getBookmarks);           // GET /bookmarks?type=artisan|product|property
router.post('/toggle', toggleBookmark);   // POST /bookmarks/toggle { entityId, type }
router.get('/check/:entityId', checkBookmark); // GET /bookmarks/check/:entityId

export default router;
