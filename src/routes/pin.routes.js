import { Router } from 'express';
import { protect, optionalAuth, restrictTo } from '../middleware/auth.js';
import { uploadMultiple, resizeImage } from '../middleware/upload.js';
import {
  getTaxonomy,
  getTradeCovers,
  getFeed,
  getMyPins,
  getPin,
  createPin,
  uploadPinMedia,
  createVideoUpload,
  getVideoStatus,
  updatePin,
  deletePin,
  publishPin,
  unpublishPin,
  duplicatePin,
  likePin,
  unlikePin,
  recordView,
  mutePin,
  unmutePin,
  recordShare,
} from '../controllers/pin.controller.js';
import {
  listComments,
  listReplies,
  addComment,
  likeComment,
  unlikeComment,
  deleteComment,
  reportPin,
} from '../controllers/comment.controller.js';

const router = Router();

router.get('/taxonomy', getTaxonomy);
router.get('/taxonomy/covers', getTradeCovers); // real imagery per trade      // GET /pins/taxonomy — trades/rooms/bands
router.get('/feed', optionalAuth, getFeed); // GET /pins/feed — public, personalized when authed
// Before /:id, or "mine" is read as a pin id. Drafts included — see the controller.
router.get('/mine', protect, getMyPins);
// Comments read publicly; the literal path must beat the /:id wildcard.
// optionalAuth so likedByMe comes back for a signed-in reader without shutting
// a signed-out one out of the thread.
router.get('/:id/comments', optionalAuth, listComments);
router.get('/comments/:commentId/replies', optionalAuth, listReplies);
router.post('/comments/:commentId/like', protect, likeComment);
router.delete('/comments/:commentId/like', protect, unlikeComment);
router.delete('/comments/:commentId', protect, deleteComment);
router.get('/:id', optionalAuth, getPin);   // GET /pins/:id — public (savedByMe/likedByMe when authed)

router.post('/:id/view', recordView);       // public: ranking signal, nothing more
router.post('/:id/share', recordShare);     // public: counts intent to share
router.post('/:id/mute', protect, mutePin);
router.delete('/:id/mute', protect, unmutePin);
router.post('/:id/like', protect, likePin);
router.delete('/:id/like', protect, unlikePin);
router.post('/:id/comments', protect, addComment);
router.post('/:id/report', protect, reportPin);

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
router.post('/:id/publish', protect, publishPin);       // a draft going live
router.post('/:id/unpublish', protect, unpublishPin);   // back to a draft
router.post('/:id/duplicate', protect, duplicatePin); // copies into a new draft
router.patch('/:id', protect, updatePin);   // owner or admin (checked in controller)
router.delete('/:id', protect, deletePin);  // owner or admin (soft delete)

export default router;
