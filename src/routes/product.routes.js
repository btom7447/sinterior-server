import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { list, getById, create, update, remove, uploadImages, checkStock } from '../controllers/product.controller.js';
import { protect, restrictTo } from '../middleware/auth.js';
import { uploadMultiple, resizeImage } from '../middleware/upload.js';
import validate from '../middleware/validate.js';

const router = Router();

// ── GET /api/v1/products ──────────────────────────────────────────────────────
router.get(
  '/',
  [
    query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),
    query('category').optional().isString().trim(),
    query('search').optional().isString().trim(),
    query('supplierId').optional().isMongoId().withMessage('Invalid supplierId'),
  ],
  validate,
  list
);

// ── POST /api/v1/products/upload-images ──────────────────────────────────────
router.post(
  '/upload-images',
  protect,
  restrictTo('supplier'),
  uploadMultiple('images', 6),
  resizeImage(1200, 0, 85),
  uploadImages
);

// ── POST /api/v1/products/check-stock ────────────────────────────────────────
router.post(
  '/check-stock',
  [
    body('items').isArray({ min: 1 }).withMessage('items must be a non-empty array'),
    body('items.*.productId').isMongoId().withMessage('Invalid productId'),
    body('items.*.quantity').isInt({ min: 1 }).withMessage('quantity must be a positive integer'),
  ],
  validate,
  checkStock
);

// ── GET /api/v1/products/:id ──────────────────────────────────────────────────
router.get(
  '/:id',
  [param('id').isMongoId().withMessage('Invalid product ID')],
  validate,
  getById
);

// ── POST /api/v1/products ─────────────────────────────────────────────────────
router.post(
  '/',
  protect,
  restrictTo('supplier'),
  [
    body('name').notEmpty().withMessage('Product name is required').isString().trim().isLength({ max: 200 }),
    body('description').optional().isString().trim().isLength({ max: 2000 }),
    body('category').notEmpty().withMessage('Category is required').isString().trim().isLength({ max: 100 }),
    body('subcategory').optional().isString().trim().isLength({ max: 100 }),
    body('price').notEmpty().withMessage('Price is required').isFloat({ min: 0 }).withMessage('Price cannot be negative'),
    body('unit').optional().isString().trim().isLength({ max: 30 }),
    body('quantity').optional().isInt({ min: 0 }).withMessage('Quantity must be a non-negative integer'),
    body('images').optional().isArray().withMessage('images must be an array'),
    body('images.*').optional().isURL().withMessage('Each image must be a valid URL'),
    body('specs').optional().isObject().withMessage('specs must be an object'),
    body('lowStockThreshold').optional().isInt({ min: 0 }).withMessage('lowStockThreshold must be a non-negative integer'),
  ],
  validate,
  create
);

// ── PATCH /api/v1/products/:id ────────────────────────────────────────────────
router.patch(
  '/:id',
  protect,
  restrictTo('supplier'),
  [
    param('id').isMongoId().withMessage('Invalid product ID'),
    body('name').optional().isString().trim().isLength({ max: 200 }),
    body('description').optional().isString().trim().isLength({ max: 2000 }),
    body('category').optional().isString().trim().isLength({ max: 100 }),
    body('subcategory').optional().isString().trim().isLength({ max: 100 }),
    body('price').optional().isFloat({ min: 0 }).withMessage('Price cannot be negative'),
    body('unit').optional().isString().trim().isLength({ max: 30 }),
    body('quantity').optional().isInt({ min: 0 }).withMessage('Quantity must be a non-negative integer'),
    body('inStock').optional().isBoolean(),
    body('images').optional().isArray(),
    body('specs').optional().isObject(),
    body('lowStockThreshold').optional().isInt({ min: 0 }).withMessage('lowStockThreshold must be a non-negative integer'),
  ],
  validate,
  update
);

// ── DELETE /api/v1/products/:id ───────────────────────────────────────────────
router.delete(
  '/:id',
  protect,
  restrictTo('supplier'),
  [param('id').isMongoId().withMessage('Invalid product ID')],
  validate,
  remove
);

export default router;
