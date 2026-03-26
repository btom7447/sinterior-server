import Notification from '../models/Notification.js';
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess, sendPaginated } from '../utils/apiResponse.js';
import { getPagination, buildPaginationMeta } from '../utils/paginate.js';

// ── GET /api/v1/notifications ─────────────────────────────────────────────────
// Returns the current user's notifications, unread first then by newest
export const list = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);

  const filter = { userId: req.user.id };

  const [total, notifications] = await Promise.all([
    Notification.countDocuments(filter),
    Notification.find(filter)
      .sort({ isRead: 1, createdAt: -1 }) // unread (false=0) first, then newest
      .skip(skip)
      .limit(limit),
  ]);

  const unreadCount = await Notification.countDocuments({ userId: req.user.id, isRead: false });

  const pagination = buildPaginationMeta(total, page, limit);
  sendPaginated(
    res,
    notifications,
    { ...pagination, unreadCount },
    'Notifications retrieved.'
  );
});

// ── PATCH /api/v1/notifications/:id/read ──────────────────────────────────────
export const markRead = asyncHandler(async (req, res) => {
  const notification = await Notification.findOne({
    _id: req.params.id,
    userId: req.user.id,
  });

  if (!notification) {
    throw new AppError('Notification not found.', 404);
  }

  if (notification.isRead) {
    return sendSuccess(res, { notification }, 'Notification was already marked as read.');
  }

  notification.isRead = true;
  await notification.save();

  sendSuccess(res, { notification }, 'Notification marked as read.');
});

// ── PATCH /api/v1/notifications/mark-all-read ─────────────────────────────────
export const markAllRead = asyncHandler(async (req, res) => {
  const result = await Notification.updateMany(
    { userId: req.user.id, isRead: false },
    { $set: { isRead: true } }
  );

  sendSuccess(
    res,
    { modifiedCount: result.modifiedCount },
    `${result.modifiedCount} notification(s) marked as read.`
  );
});
