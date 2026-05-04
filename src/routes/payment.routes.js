import express, { Router } from 'express';
import { body, query } from 'express-validator';
import { initialize, verify, webhook } from '../controllers/payment.controller.js';
import { protect } from '../middleware/auth.js';
import validate from '../middleware/validate.js';

const router = Router();

// ── POST /api/v1/payments/initialize ─────────────────────────────────────────
router.post(
  '/initialize',
  protect,
  [
    body('type').isIn(['order', 'job']).withMessage('type must be "order" or "job"'),
    body('entityId').isMongoId().withMessage('Valid entityId is required'),
  ],
  validate,
  initialize
);

// ── GET /api/v1/payments/verify ──────────────────────────────────────────────
// No auth — Paystack redirects here after payment; in-memory token is gone.
// The reference itself is the secret; we verify against Paystack's API.
router.get(
  '/verify',
  [query('reference').notEmpty().withMessage('reference is required')],
  validate,
  verify
);

// ── POST /api/v1/payments/webhook ────────────────────────────────────────────
// No auth — Paystack verifies via HMAC signature on the raw bytes. We MUST
// keep the raw buffer around to recompute the HMAC; re-stringifying a parsed
// JSON object would change byte order / whitespace and break the signature.
router.post('/webhook', express.raw({ type: 'application/json', limit: '50kb' }), webhook);

export default router;
