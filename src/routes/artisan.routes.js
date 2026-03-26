import { Router } from 'express';
import { body, query, param } from 'express-validator';
import {
  getNearby,
  getById,
  updateOnboarding,
  updateLocation,
} from '../controllers/artisan.controller.js';
import { protect, restrictTo } from '../middleware/auth.js';
import validate from '../middleware/validate.js';

const router = Router();

// ── GET /api/v1/artisans/nearby ───────────────────────────────────────────────
router.get(
  '/nearby',
  [
    query('lat').notEmpty().withMessage('lat is required').isFloat({ min: -90, max: 90 }).withMessage('lat must be a valid latitude'),
    query('lng').notEmpty().withMessage('lng is required').isFloat({ min: -180, max: 180 }).withMessage('lng must be a valid longitude'),
    query('radiusKm').optional().isFloat({ min: 1, max: 500 }).withMessage('radiusKm must be between 1 and 500'),
    query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),
  ],
  validate,
  getNearby
);

// ── GET /api/v1/artisans/:id ──────────────────────────────────────────────────
router.get(
  '/:id',
  [param('id').isMongoId().withMessage('Invalid artisan ID')],
  validate,
  getById
);

// ── PATCH /api/v1/artisans/onboarding ────────────────────────────────────────
router.patch(
  '/onboarding',
  protect,
  restrictTo('artisan'),
  [
    body('skill').optional().isString().trim().isLength({ max: 100 }).withMessage('Skill cannot exceed 100 characters'),
    body('skillCategory').optional().isString().trim().isLength({ max: 80 }),
    body('serviceRadiusKm').optional().isFloat({ min: 1, max: 500 }).withMessage('serviceRadiusKm must be between 1 and 500'),
    body('city').optional().isString().trim().isLength({ max: 80 }),
    body('state').optional().isString().trim().isLength({ max: 80 }),
    body('address').optional().isString().trim().isLength({ max: 200 }),
    body('pricePerDay').optional().isFloat({ min: 0 }).withMessage('pricePerDay cannot be negative'),
    body('experienceYears').optional().isInt({ min: 0, max: 60 }).withMessage('experienceYears must be between 0 and 60'),
    body('isAvailable').optional().isBoolean().withMessage('isAvailable must be true or false'),
    body('availableDays')
      .optional()
      .isArray()
      .withMessage('availableDays must be an array'),
    body('availableDays.*')
      .optional()
      .isIn(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'])
      .withMessage('Invalid day in availableDays'),
    body('workHoursStart').optional().isString().trim().matches(/^\d{2}:\d{2}$/).withMessage('workHoursStart must be in HH:MM format'),
    body('workHoursEnd').optional().isString().trim().matches(/^\d{2}:\d{2}$/).withMessage('workHoursEnd must be in HH:MM format'),
    body('tools').optional().isArray().withMessage('tools must be an array'),
    body('additionalSkills').optional().isArray().withMessage('additionalSkills must be an array'),
    body('portfolio').optional().isArray().withMessage('portfolio must be an array'),
    body('certifications').optional().isArray().withMessage('certifications must be an array'),
  ],
  validate,
  updateOnboarding
);

// ── PATCH /api/v1/artisans/location ──────────────────────────────────────────
router.patch(
  '/location',
  protect,
  restrictTo('artisan'),
  [
    body('lat').notEmpty().withMessage('lat is required').isFloat({ min: -90, max: 90 }).withMessage('lat must be a valid latitude'),
    body('lng').notEmpty().withMessage('lng is required').isFloat({ min: -180, max: 180 }).withMessage('lng must be a valid longitude'),
  ],
  validate,
  updateLocation
);

export default router;
