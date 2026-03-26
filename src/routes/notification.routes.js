import { Router } from 'express';
import { param, query } from 'express-validator';
import { list, markRead, markAllRead } from '../controllers/notification.controller.js';
import { protect } from '../middleware/auth.js';
import validate from '../middleware/validate.js';

const router = Router();

// All notification routes require authentication
router.use(protect);

// ── GET /api/v1/notifications ─────────────────────────────────────────────────
router.get(
  '/',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  list
);

// ── PATCH /api/v1/notifications/mark-all-read ─────────────────────────────────
// Must be declared BEFORE /:id/read so Express doesn't try to match
// "mark-all-read" as a Mongo ID
router.patch('/mark-all-read', markAllRead);

// ── PATCH /api/v1/notifications/:id/read ──────────────────────────────────────
router.patch(
  '/:id/read',
  [param('id').isMongoId().withMessage('Invalid notification ID')],
  validate,
  markRead
);

export default router;
