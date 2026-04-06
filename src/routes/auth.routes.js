import { Router } from 'express';
import { body } from 'express-validator';
import { register, login, refresh, logout, me, forgotPassword, resetPassword, changePassword, sendVerification, verifyEmail } from '../controllers/auth.controller.js';
import { protect } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimiter.js';
import validate from '../middleware/validate.js';

const router = Router();

// ── POST /api/v1/auth/register ────────────────────────────────────────────────
router.post(
  '/register',
  authLimiter,
  [
    body('email')
      .isEmail()
      .withMessage('A valid email address is required')
      .normalizeEmail(),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters')
      .matches(/\d/)
      .withMessage('Password must contain at least one number'),
    body('role')
      .optional()
      .isIn(['client', 'artisan', 'supplier'])
      .withMessage("Role must be one of: client, artisan, supplier"),
    body('fullName')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 120 })
      .withMessage('Full name cannot exceed 120 characters'),
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
    body('phone')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 30 })
      .withMessage('Phone cannot exceed 30 characters'),
  ],
  validate,
  register
);

// ── POST /api/v1/auth/login ───────────────────────────────────────────────────
router.post(
  '/login',
  authLimiter,
  [
    body('email')
      .isEmail()
      .withMessage('A valid email address is required')
      .normalizeEmail(),
    body('password')
      .notEmpty()
      .withMessage('Password is required'),
  ],
  validate,
  login
);

// ── POST /api/v1/auth/refresh ─────────────────────────────────────────────────
// Reads refreshToken from httpOnly cookie — no body validation needed
router.post('/refresh', refresh);

// ── POST /api/v1/auth/logout ──────────────────────────────────────────────────
// No protect — logout must work even with an expired access token
router.post('/logout', logout);

// ── GET /api/v1/auth/me ───────────────────────────────────────────────────────
router.get('/me', protect, me);

// ── POST /api/v1/auth/forgot-password ─────────────────────────────────────────
router.post(
  '/forgot-password',
  authLimiter,
  [body('email').isEmail().withMessage('A valid email address is required').normalizeEmail()],
  validate,
  forgotPassword
);

// ── POST /api/v1/auth/reset-password/:token ────────────────────────────────────
router.post(
  '/reset-password/:token',
  authLimiter,
  [
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters')
      .matches(/\d/)
      .withMessage('Password must contain at least one number'),
  ],
  validate,
  resetPassword
);

// ── POST /api/v1/auth/change-password ─────────────────────────────────────────
router.post(
  '/change-password',
  protect,
  [
    body('currentPassword').notEmpty().withMessage('Current password is required'),
    body('newPassword')
      .isLength({ min: 8 })
      .withMessage('New password must be at least 8 characters')
      .matches(/\d/)
      .withMessage('New password must contain at least one number'),
  ],
  validate,
  changePassword
);

// ── POST /api/v1/auth/send-verification ───────────────────────────────────────
router.post('/send-verification', protect, authLimiter, sendVerification);

// ── GET /api/v1/auth/verify-email/:token ──────────────────────────────────────
router.get('/verify-email/:token', verifyEmail);

export default router;
