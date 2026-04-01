import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { getConversations, getMessages, sendMessage, searchUserByEmail } from '../controllers/chat.controller.js';
import { protect } from '../middleware/auth.js';
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
router.post(
  '/messages',
  [
    body('receiverId')
      .notEmpty()
      .withMessage('receiverId is required')
      .isMongoId()
      .withMessage('receiverId must be a valid ID'),
    body('content')
      .notEmpty()
      .withMessage('Message content is required')
      .isString()
      .trim()
      .isLength({ min: 1, max: 2000 })
      .withMessage('Message must be between 1 and 2000 characters'),
  ],
  validate,
  sendMessage
);

export default router;
