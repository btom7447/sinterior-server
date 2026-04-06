import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { getConversations, getMessages, sendMessage, searchUserByEmail } from '../controllers/chat.controller.js';
import { protect } from '../middleware/auth.js';
import { uploadMultiple, resizeImage } from '../middleware/upload.js';
import validate from '../middleware/validate.js';

const router = Router();

// All chat routes require authentication
router.use(protect);

// ── GET /api/v1/chat/search ───────────────────────────────────────────────────
router.get('/search', searchUserByEmail);

// ── GET /api/v1/chat/conversations ────────────────────────────────────────────
router.get('/conversations', getConversations);

// ── GET /api/v1/chat/messages/:conversationId ─────────────────────────────────
router.get(
  '/messages/:conversationId',
  [
    param('conversationId')
      .notEmpty()
      .withMessage('conversationId is required')
      .isString()
      .withMessage('conversationId must be a string'),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  getMessages
);

// ── POST /api/v1/chat/messages ────────────────────────────────────────────────
// Supports text-only (JSON) and text+images (multipart/form-data)
router.post(
  '/messages',
  uploadMultiple('media', 4),
  resizeImage(1200, 0, 80),
  [
    body('receiverId')
      .notEmpty()
      .withMessage('receiverId is required')
      .isMongoId()
      .withMessage('receiverId must be a valid ID'),
    body('content')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 2000 })
      .withMessage('Message cannot exceed 2000 characters'),
  ],
  validate,
  sendMessage
);

export default router;
