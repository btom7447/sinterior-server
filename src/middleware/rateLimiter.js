import rateLimit from 'express-rate-limit';
import config from '../config/env.js';

/**
 * General API rate limiter — applied to all /api routes.
 * Default: 100 requests per 15 minutes per IP.
 */
export const generalLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: config.RATE_LIMIT_MAX,
  standardHeaders: true,   // Return RateLimit-* headers (RFC 6585)
  legacyHeaders: false,    // Disable X-RateLimit-* headers
  message: {
    status: 'fail',
    message: 'Too many requests, please try again later.',
  },
});

/**
 * Strict auth rate limiter — applied to login / register / refresh.
 * Default: 10 requests per 15 minutes per IP.
 */
export const authLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: config.AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 'fail',
    message: 'Too many auth attempts, please try again in 15 minutes.',
  },
});

/**
 * Upload rate limiter — applied to file upload endpoints.
 * 20 requests per hour per IP.
 */
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 'fail',
    message: 'Too many upload requests, please try again in an hour.',
  },
});

/**
 * Payment verification limiter. /payments/verify is unauthenticated by design
 * (Paystack redirects the browser there), so it needs its own tight budget —
 * the general limiter is far too generous for an endpoint that hits Paystack's
 * API and, before idempotency, could be replayed.
 */
export const paymentVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many verification attempts. Please wait a few minutes.',
  },
});
