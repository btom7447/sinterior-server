/**
 * Emit a real-time notification to a specific user via Socket.IO.
 * Call this right after Notification.create() in any controller.
 *
 * @param {import('express').Request} req  — Express request (used to access io)
 * @param {object} notification            — The saved Notification document
 */
export const emitNotification = (req, notification) => {
  const io = req.app.get('io');
  if (!io) return;

  const userId = notification.userId?.toString?.() || notification.userId;
  io.to(`user:${userId}`).emit('notification:new', {
    _id: notification._id,
    title: notification.title,
    body: notification.body,
    type: notification.type,
    isRead: notification.isRead,
    data: notification.data,
    createdAt: notification.createdAt,
  });
};
