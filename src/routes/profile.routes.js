import { Router } from 'express';
import { body } from 'express-validator';
import { getMe, updateMe, uploadAvatar, getSettings, updateSettings } from '../controllers/profile.controller.js';
import { protect } from '../middleware/auth.js';
// TODO: re-enable after testing
// import { uploadLimiter } from '../middleware/rateLimiter.js';
import { uploadSingle, resizeImage } from '../middleware/upload.js';
import validate from '../middleware/validate.js';

const router = Router();

// All profile routes require authentication
router.use(protect);

// ── GET /api/v1/profiles/me ───────────────────────────────────────────────────
router.get('/me', getMe);

// ── PATCH /api/v1/profiles/me ─────────────────────────────────────────────────
router.patch(
  '/me',
  [
    body('fullName')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 120 })
      .withMessage('Full name cannot exceed 120 characters'),
    body('phone')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 20 })
      .withMessage('Phone number cannot exceed 20 characters'),
    body('city')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 80 })
      .withMessage('City cannot exceed 80 characters'),
    body('state')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 80 })
      .withMessage('State cannot exceed 80 characters'),
    body('bio')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 500 })
      .withMessage('Bio cannot exceed 500 characters'),
  ],
  validate,
  updateMe
);

// ── GET /api/v1/profiles/me/settings ──────────────────────────────────────────
router.get('/me/settings', getSettings);

// ── PATCH /api/v1/profiles/me/settings ───────────────────────────────────────
router.patch('/me/settings', updateSettings);

// ── POST /api/v1/profiles/me/avatar ───────────────────────────────────────────
router.post(
  '/me/avatar',
  // uploadLimiter,
  uploadSingle('avatar'),
  resizeImage(400, 400, 85),
  uploadAvatar
);

export default router;
