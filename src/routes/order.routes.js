import { Router } from 'express';
import { body, param } from 'express-validator';
import { create, list, getById, updateStatus } from '../controllers/order.controller.js';
import { protect, restrictTo } from '../middleware/auth.js';
import validate from '../middleware/validate.js';

const router = Router();

// All order routes require authentication
router.use(protect);

// ── POST /api/v1/orders ───────────────────────────────────────────────────────
router.post(
  '/',
  [
    body('items')
      .isArray({ min: 1 })
      .withMessage('items must be a non-empty array'),
    body('items.*.productId')
      .isMongoId()
      .withMessage('Each item must have a valid productId'),
    body('items.*.quantity')
      .isInt({ min: 1 })
      .withMessage('Each item quantity must be at least 1'),
    body('deliveryAddress')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 300 })
      .withMessage('Delivery address cannot exceed 300 characters'),
    body('city').optional().isString().trim().isLength({ max: 80 }),
    body('note').optional().isString().trim().isLength({ max: 500 }),
    body('paymentMethod').optional().isString().trim().isLength({ max: 50 }),
  ],
  validate,
  create
);

// ── GET /api/v1/orders ────────────────────────────────────────────────────────
router.get('/', list);

// ── GET /api/v1/orders/:id ────────────────────────────────────────────────────
router.get(
  '/:id',
  [param('id').isMongoId().withMessage('Invalid order ID')],
  validate,
  getById
);

// ── PATCH /api/v1/orders/:id/status ──────────────────────────────────────────
router.patch(
  '/:id/status',
  restrictTo('supplier', 'artisan'),
  [
    param('id').isMongoId().withMessage('Invalid order ID'),
    body('status')
      .notEmpty()
      .withMessage('status is required')
      .isIn(['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'])
      .withMessage("status must be one of: pending, confirmed, shipped, delivered, cancelled"),
  ],
  validate,
  updateStatus
);

export default router;
