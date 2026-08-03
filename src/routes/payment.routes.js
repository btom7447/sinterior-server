import express, { Router } from 'express';
import { body, param, query } from 'express-validator';
import { initialize, paymentReturn, status, verify, webhook } from '../controllers/payment.controller.js';
import { protect } from '../middleware/auth.js';
import { paymentVerifyLimiter } from '../middleware/rateLimiter.js';
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
// ── GET /api/v1/payments/status/:type/:entityId ─────────────────────────────
// Authenticated poll for native clients (see controller note).
router.get(
  '/status/:type/:entityId',
  protect,
  [param('type').isIn(['order', 'job']), param('entityId').isMongoId()],
  validate,
  status
);

// ── GET /api/v1/payments/return ──────────────────────────────────────────────
// Public: the buyer arrives from Paystack's servers with no token. It only
// redirects into the app — see the controller for why that is safe.
router.get('/return', paymentReturn);

router.get(
  '/verify',
  paymentVerifyLimiter,
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
