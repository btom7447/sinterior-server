import { Router } from 'express';
import { body } from 'express-validator';
import { updateOnboarding, getMe, uploadLogo } from '../controllers/supplier.controller.js';
import { protect, restrictTo } from '../middleware/auth.js';
import { uploadSingle, resizeImage } from '../middleware/upload.js';
import validate from '../middleware/validate.js';

const router = Router();

// ── GET /api/v1/suppliers/me ────────────────────────────────────────────────
router.get('/me', protect, restrictTo('supplier'), getMe);

// ── POST /api/v1/suppliers/logo ──────────────────────────────────────────────
router.post(
  '/logo',
  protect,
  restrictTo('supplier'),
  uploadSingle('logo'),
  resizeImage(400, 400, 85),
  uploadLogo
);

// ── PATCH /api/v1/suppliers/onboarding ──────────────────────────────────────
router.patch(
  '/onboarding',
  protect,
  restrictTo('supplier'),
  [
    body('businessName').optional().isString().trim().isLength({ max: 200 }),
    body('businessType').optional().isIn(['materials', 'real_estate', 'both']),
    body('description').optional().isString().trim().isLength({ max: 500 }),
    body('cacNumber').optional().isString().trim(),
    body('taxId').optional().isString().trim(),
    body('categories').optional().isArray(),
    body('deliveryOptions').optional().isArray(),
    body('minOrderValue').optional().isFloat({ min: 0 }),
    body('deliveryDays').optional().isString().trim(),
    body('coverageStates').optional().isString().trim(),
    body('businessAddress').optional().isString().trim(),
    body('whatsappNumber').optional().isString().trim(),
    body('bankName').optional().isString().trim(),
    body('accountNumber').optional().isString().trim().isLength({ max: 10 }),
    body('accountName').optional().isString().trim(),
  ],
  validate,
  updateOnboarding
);

export default router;
