import { Router } from 'express';
import { body, param } from 'express-validator';
import { protect, restrictTo } from '../middleware/auth.js';
import validate from '../middleware/validate.js';
import {
  sendQuote,
  editQuote,
  acceptQuote,
  rejectQuote,
  getQuotesForJob,
} from '../controllers/quote.controller.js';

const router = Router();
router.use(protect);

// GET /api/v1/quotes/job/:jobId — both parties can view
router.get(
  '/job/:jobId',
  [param('jobId').isMongoId()],
  validate,
  getQuotesForJob
);

// POST /api/v1/quotes — artisan sends quote
router.post(
  '/',
  restrictTo('artisan'),
  [
    body('jobId').isMongoId().withMessage('Valid jobId required'),
    body('labourType').isIn(['flat','hourly','daily','sqm','unit']).withMessage('labourType must be flat, hourly, daily, sqm, or unit'),
    body('labourRate').isFloat({ min: 0 }).withMessage('labourRate must be a non-negative number'),
    body('labourQty').optional().isFloat({ min: 0 }),
    body('materials').optional().isArray(),
    body('notes').optional().isString().trim().isLength({ max: 1000 }),
  ],
  validate,
  sendQuote
);

// PATCH /api/v1/quotes/:id — artisan edits a sent quote
router.patch(
  '/:id',
  restrictTo('artisan'),
  [param('id').isMongoId()],
  validate,
  editQuote
);

// POST /api/v1/quotes/:id/accept — client accepts
router.post(
  '/:id/accept',
  [param('id').isMongoId()],
  validate,
  acceptQuote
);

// POST /api/v1/quotes/:id/reject — client rejects
router.post(
  '/:id/reject',
  [param('id').isMongoId()],
  validate,
  rejectQuote
);

export default router;
