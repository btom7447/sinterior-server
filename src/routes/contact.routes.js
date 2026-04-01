import { Router } from 'express';
import { body } from 'express-validator';
import validate from '../middleware/validate.js';
import ContactInquiry from '../models/ContactInquiry.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';

const router = Router();

// ── POST /api/v1/contact ────────────────────────────────────────────────────
router.post(
  '/',
  [
    body('name').notEmpty().withMessage('Name is required').trim().isLength({ max: 120 }),
    body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
    body('topic').optional().isString().trim().isLength({ max: 100 }),
    body('message').notEmpty().withMessage('Message is required').trim().isLength({ max: 2000 }),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { name, email, topic, message } = req.body;
    await ContactInquiry.create({ name, email, topic, message });
    sendSuccess(res, null, 'Message received. We will get back to you within 24 hours.', 201);
  })
);

export default router;
