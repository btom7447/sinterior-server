import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { list, getById, create, update, remove } from '../controllers/property.controller.js';
import { protect, restrictTo } from '../middleware/auth.js';
import validate from '../middleware/validate.js';

const router = Router();

// ── GET /api/v1/properties ────────────────────────────────────────────────────
router.get(
  '/',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('type').optional().isIn(['sale', 'rent']).withMessage("type must be 'sale' or 'rent'"),
    query('propertyType')
      .optional()
      .isIn(['apartment', 'house', 'land', 'commercial'])
      .withMessage("propertyType must be one of: apartment, house, land, commercial"),
    query('city').optional().isString().trim(),
    query('minPrice').optional().isFloat({ min: 0 }).withMessage('minPrice must be a non-negative number'),
    query('maxPrice').optional().isFloat({ min: 0 }).withMessage('maxPrice must be a non-negative number'),
  ],
  validate,
  list
);

// ── GET /api/v1/properties/:id ────────────────────────────────────────────────
router.get(
  '/:id',
  [param('id').isMongoId().withMessage('Invalid property ID')],
  validate,
  getById
);

// ── POST /api/v1/properties ───────────────────────────────────────────────────
router.post(
  '/',
  protect,
  restrictTo('supplier'),
  [
    body('title').notEmpty().withMessage('Title is required').isString().trim().isLength({ max: 200 }),
    body('description').optional().isString().trim().isLength({ max: 3000 }),
    body('type').notEmpty().withMessage('Listing type is required').isIn(['sale', 'rent']).withMessage("type must be 'sale' or 'rent'"),
    body('propertyType')
      .notEmpty()
      .withMessage('Property type is required')
      .isIn(['apartment', 'house', 'land', 'commercial'])
      .withMessage("propertyType must be one of: apartment, house, land, commercial"),
    body('price').notEmpty().withMessage('Price is required').isFloat({ min: 0 }).withMessage('Price cannot be negative'),
    body('bedrooms').optional().isInt({ min: 0 }),
    body('bathrooms').optional().isInt({ min: 0 }),
    body('size').optional().isFloat({ min: 0 }),
    body('sizeUnit').optional().isString().trim().isLength({ max: 10 }),
    body('location').optional().isString().trim().isLength({ max: 200 }),
    body('city').optional().isString().trim().isLength({ max: 80 }),
    body('state').optional().isString().trim().isLength({ max: 80 }),
    body('images').optional().isArray(),
    body('features').optional().isArray(),
  ],
  validate,
  create
);

// ── PATCH /api/v1/properties/:id ──────────────────────────────────────────────
router.patch(
  '/:id',
  protect,
  restrictTo('supplier'),
  [
    param('id').isMongoId().withMessage('Invalid property ID'),
    body('title').optional().isString().trim().isLength({ max: 200 }),
    body('description').optional().isString().trim().isLength({ max: 3000 }),
    body('type').optional().isIn(['sale', 'rent']),
    body('propertyType').optional().isIn(['apartment', 'house', 'land', 'commercial']),
    body('price').optional().isFloat({ min: 0 }),
    body('bedrooms').optional().isInt({ min: 0 }),
    body('bathrooms').optional().isInt({ min: 0 }),
    body('size').optional().isFloat({ min: 0 }),
    body('city').optional().isString().trim().isLength({ max: 80 }),
    body('state').optional().isString().trim().isLength({ max: 80 }),
    body('images').optional().isArray(),
    body('features').optional().isArray(),
    body('isActive').optional().isBoolean(),
  ],
  validate,
  update
);

// ── DELETE /api/v1/properties/:id ─────────────────────────────────────────────
router.delete(
  '/:id',
  protect,
  restrictTo('supplier'),
  [param('id').isMongoId().withMessage('Invalid property ID')],
  validate,
  remove
);

export default router;
