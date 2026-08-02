import { Router } from 'express';
import { body, param } from 'express-validator';
import {
  listCategories,
  createCategory,
  updateCategory,
  deactivateCategory,
} from '../controllers/category.controller.js';
import { protect, optionalAuth, restrictTo } from '../middleware/auth.js';
import { uploadMultiple, resizeImage } from '../middleware/upload.js';
import { uploadImages } from '../controllers/product.controller.js';
import validate from '../middleware/validate.js';

const router = Router();

// ── GET /api/v1/categories ───────────────────────────────────────────────────
// optionalAuth rather than protect: the shop needs its own shelves before anyone
// signs in, but an admin asking with ?all=true should see the hidden ones too,
// and that needs to know who is asking.
router.get('/', optionalAuth, listCategories);

// ── POST /api/v1/categories/image ────────────────────────────────────────────
/*
 * The category's own photograph.
 *
 * Square-ish and small: it is rendered at 42px in the rail and about 120 in the
 * shop's header, so a 1200px original is several hundred kilobytes of nothing on
 * a metered connection.
 */
router.post(
  '/image',
  protect,
  restrictTo('admin'),
  // uploadMultiple with a cap of one rather than uploadSingle: the shared
  // handler reads req.files, which uploadSingle never populates.
  uploadMultiple('image', 1),
  resizeImage(600, 600, 82),
  uploadImages
);

router.post(
  '/',
  protect,
  restrictTo('admin'),
  [
    body('name').notEmpty().withMessage('A category needs a name').isString().trim().isLength({ max: 60 }),
    body('image').optional({ nullable: true }).isString().trim(),
    body('subcategories').optional().isArray({ max: 30 }),
    body('order').optional().isInt(),
  ],
  validate,
  createCategory
);

router.patch(
  '/:id',
  protect,
  restrictTo('admin'),
  [
    param('id').isMongoId().withMessage('Invalid category ID'),
    body('name').optional().isString().trim().isLength({ min: 1, max: 60 }),
    body('image').optional({ nullable: true }).isString().trim(),
    body('subcategories').optional().isArray({ max: 30 }),
    body('order').optional().isInt(),
    body('isActive').optional().isBoolean(),
  ],
  validate,
  updateCategory
);

router.delete(
  '/:id',
  protect,
  restrictTo('admin'),
  [param('id').isMongoId().withMessage('Invalid category ID')],
  validate,
  deactivateCategory
);

export default router;
