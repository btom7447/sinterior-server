import { Router } from 'express';
import { body, param, query } from 'express-validator';
import {
  getConversationMeta,
  getConversationWith,
  getConversations,
  getMessages,
  reportConversation,
  searchUserByEmail,
  sendMessage,
} from '../controllers/chat.controller.js';
import { protect } from '../middleware/auth.js';
import { parseAttachments, uploadAttachments } from '../middleware/attachmentUpload.js';
import validate from '../middleware/validate.js';

const router = Router();

// All chat routes require authentication
router.use(protect);

// ── GET /api/v1/chat/search ───────────────────────────────────────────────────
router.get('/search', searchUserByEmail);

// ── GET /api/v1/chat/conversations ────────────────────────────────────────────
router.get('/conversations', getConversations);

// ── GET /api/v1/chat/with/:profileId — a thread that may not exist yet ───────
// Declared before /conversations/:conversationId so a profile id is never read
// as a conversation id.
router.get(
  '/with/:profileId',
  [param('profileId').isMongoId().withMessage('Recipient not found.')],
  validate,
  getConversationWith
);

// ── GET /api/v1/chat/conversations/:conversationId — thread metadata ─────────
router.get('/conversations/:conversationId', getConversationMeta);

// ── POST /api/v1/chat/conversations/:conversationId/report ───────────────────
router.post(
  '/conversations/:conversationId/report',
  [
    param('conversationId').notEmpty().isString(),
    body('reason')
      .isIn([
        'harassment',
        'scam',
        'off_platform_payment',
        'no_show',
        'impersonation',
        'spam',
        'other',
      ])
      .withMessage('Pick a reason.'),
    body('note').optional().isString().trim().isLength({ max: 1000 }),
  ],
  validate,
  reportConversation
);

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
// Text only as JSON, or text plus attachments as multipart/form-data. Photos,
// video and documents all arrive on the same `media` field; the middleware sorts
// them by type, because asking the client to pick the right field name is asking
// it to duplicate a rule the server already owns.
router.post(
  '/messages',
  parseAttachments('media'),
  uploadAttachments,
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
