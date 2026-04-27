import { Router } from 'express';
import { protect, restrictTo } from '../middleware/auth.js';
import {
  getStats,
  getPageStats,
  getAnalytics,
  getUsers,
  getUser,
  updateUser,
  getOrders,
  getProducts,
  updateProduct,
  getBlogPosts,
  getBlogPost,
  createBlogPost,
  updateBlogPost,
  deleteBlogPost,
  getCareers,
  getCareer,
  createCareer,
  updateCareer,
  deleteCareer,
  getHelpArticles,
  getHelpArticle,
  createHelpArticle,
  updateHelpArticle,
  deleteHelpArticle,
  getFeedPosts,
  getFeedPost,
  createFeedPost,
  updateFeedPost,
  deleteFeedPost,
  getDisputes,
  updateDispute,
  getVerifications,
  updateVerification,
  getSettings,
  updateSettings,
  getEscrow,
  getPayouts,
  releasePayoutNow,
  cancelPayout,
  getPlatformWallet,
  getSellerWallet,
  updateSellerWallet,
  adjustSellerWallet,
  setGlobalPause,
  refundEscrow,
  forceReleaseEscrow,
  suspendSeller,
  unsuspendSeller,
  sendFeeReminder,
} from '../controllers/admin.controller.js';

const router = Router();

// All admin routes require authentication + admin role
router.use(protect, restrictTo('admin'));

// Stats & Analytics
router.get('/stats', getStats);
router.get('/page-stats', getPageStats);
router.get('/analytics', getAnalytics);

// Users
router.get('/users', getUsers);
router.get('/users/:id', getUser);
router.patch('/users/:id', updateUser);

// Orders
router.get('/orders', getOrders);

// Products
router.get('/products', getProducts);
router.patch('/products/:id', updateProduct);

// Blog
router.get('/blog', getBlogPosts);
router.get('/blog/:id', getBlogPost);
router.post('/blog', createBlogPost);
router.patch('/blog/:id', updateBlogPost);
router.delete('/blog/:id', deleteBlogPost);

// Careers
router.get('/careers', getCareers);
router.get('/careers/:id', getCareer);
router.post('/careers', createCareer);
router.patch('/careers/:id', updateCareer);
router.delete('/careers/:id', deleteCareer);

// Help articles
router.get('/help', getHelpArticles);
router.get('/help/:id', getHelpArticle);
router.post('/help', createHelpArticle);
router.patch('/help/:id', updateHelpArticle);
router.delete('/help/:id', deleteHelpArticle);

// Feed posts
router.get('/feed', getFeedPosts);
router.get('/feed/:id', getFeedPost);
router.post('/feed', createFeedPost);
router.patch('/feed/:id', updateFeedPost);
router.delete('/feed/:id', deleteFeedPost);

// Disputes
router.get('/disputes', getDisputes);
router.patch('/disputes/:id', updateDispute);

// Verification
router.get('/verifications', getVerifications);
router.patch('/verifications/:id', updateVerification);

// Platform Settings
router.get('/settings', getSettings);
router.patch('/settings', updateSettings);
router.post('/settings/global-pause', setGlobalPause);

// Payments — escrow viewer, payouts, wallets
router.get('/escrow', getEscrow);
router.post('/escrow/:id/refund', refundEscrow);
router.post('/escrow/:id/release', forceReleaseEscrow);
router.get('/payouts', getPayouts);
router.post('/payouts/:id/release-now', releasePayoutNow);
router.post('/payouts/:id/cancel', cancelPayout);
router.get('/wallets/platform', getPlatformWallet);
router.get('/wallets/:profileId', getSellerWallet);
router.patch('/wallets/:profileId', updateSellerWallet);
router.post('/wallets/:profileId/adjust', adjustSellerWallet);
router.post('/wallets/:profileId/suspend', suspendSeller);
router.post('/wallets/:profileId/unsuspend', unsuspendSeller);
router.post('/wallets/:profileId/send-fee-reminder', sendFeeReminder);

export default router;
