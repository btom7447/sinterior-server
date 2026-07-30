import Notification from '../models/Notification.js';
import Profile from '../models/Profile.js';
import { forgetToken, saveToken } from '../services/push.service.js';
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

// ── POST /api/v1/notifications/push-token ─────────────────────────────────────
// A device saying where to reach it. Idempotent: the app re-registers on every
// launch, because a token can be rotated by the OS without the app being told.
export const registerPushToken = asyncHandler(async (req, res) => {
  const { token, platform, deviceId } = req.body;
  if (!token || typeof token !== 'string') {
    throw new AppError('A push token is required.', 400);
  }

  const profile = await Profile.findOne({ userId: req.user.id }).select('_id').lean();

  await saveToken({
    token: token.trim(),
    userId: req.user.id,
    profileId: profile?._id ?? null,
    platform: ['ios', 'android', 'web'].includes(platform) ? platform : null,
    deviceId: typeof deviceId === 'string' ? deviceId : null,
  });

  sendSuccess(res, null, 'Push token registered.');
});

// ── DELETE /api/v1/notifications/push-token ───────────────────────────────────
// Sign-out. A shared phone must not keep delivering the previous person's
// notifications, which is a privacy failure rather than an inconvenience.
export const unregisterPushToken = asyncHandler(async (req, res) => {
  const { token } = req.body ?? {};
  if (token) await forgetToken(String(token).trim());
  sendSuccess(res, null, 'Push token removed.');
});
