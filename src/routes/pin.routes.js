import { Router } from 'express';
import { protect, optionalAuth, restrictTo } from '../middleware/auth.js';
import { uploadMultiple, resizeImage } from '../middleware/upload.js';
import {
  getTaxonomy,
  getTradeCovers,
  getFeed,
  getPin,
  createPin,
  uploadPinMedia,
  createVideoUpload,
  getVideoStatus,
  updatePin,
  deletePin,
  likePin,
  unlikePin,
  recordView,
  mutePin,
  unmutePin,
  recordShare,
  listComments,
  addComment,
  deleteComment,
} from '../controllers/pin.controller.js';

const router = Router();

router.get('/taxonomy', getTaxonomy);
router.get('/taxonomy/covers', getTradeCovers); // real imagery per trade      // GET /pins/taxonomy — trades/rooms/bands
router.get('/feed', optionalAuth, getFeed); // GET /pins/feed — public, personalized when authed
// Comments read publicly; the literal path must beat the /:id wildcard.
router.get('/:id/comments', listComments);
router.delete('/comments/:commentId', protect, deleteComment);
router.get('/:id', optionalAuth, getPin);   // GET /pins/:id — public (savedByMe/likedByMe when authed)

router.post('/:id/view', recordView);       // public: ranking signal, nothing more
router.post('/:id/share', recordShare);     // public: counts intent to share
router.post('/:id/mute', protect, mutePin);
router.delete('/:id/mute', protect, unmutePin);
router.post('/:id/like', protect, likePin);
router.delete('/:id/like', protect, unlikePin);
router.post('/:id/comments', protect, addComment);

router.post(
  '/upload',
  protect,
  restrictTo('artisan', 'supplier'),
  uploadMultiple('images', 10),
  resizeImage(1400, 0, 85),
  uploadPinMedia
);

// Video goes phone → Cloudflare directly; this only issues the one-time URL and
// reports transcoding progress.
router.post('/upload/video', protect, restrictTo('artisan', 'supplier'), createVideoUpload);
router.get('/upload/video/:uid', protect, getVideoStatus);
router.post('/', protect, restrictTo('artisan', 'supplier'), createPin);
router.patch('/:id', protect, updatePin);   // owner or admin (checked in controller)
router.delete('/:id', protect, deletePin);  // owner or admin (soft delete)

export default router;
