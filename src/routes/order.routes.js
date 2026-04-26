import { Router } from 'express';
import { body, param } from 'express-validator';
import { create, list, getById, updateStatus, approveDelivery } from '../controllers/order.controller.js';
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
    body('deliveryState').optional().isString().trim().isLength({ max: 50 }),
    body('contactName').optional().isString().trim().isLength({ max: 100 }),
    body('contactPhone').optional().isString().trim().isLength({ max: 20 }),
    body('shippingCost').optional().isFloat({ min: 0 }),
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

// ── POST /api/v1/orders/:id/approve-delivery ────────────────────────────────
// Either party flips their delivery-approval flag. When both have approved
// AND payment is settled, the order transitions to `delivered`.
router.post(
  '/:id/approve-delivery',
  [
    param('id').isMongoId().withMessage('Invalid order ID'),
    body('cashCollected').optional().isBoolean(),
  ],
  validate,
  approveDelivery
);

export default router;
