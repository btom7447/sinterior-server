/**
 * Deliver a notification: to the app over the socket, and to the phone if the
 * app is not open.
 *
 * Call this right after Notification.create() in any controller.
 *
 * The push is deliberately conditional. Somebody with the app open has already
 * been told over the socket, and buzzing a phone that is in their hand about
 * something already on their screen is the fastest way to have notifications
 * turned off entirely.
 *
 * Nothing here is awaited. A notification is saved before this runs, so the
 * worst a failed delivery costs is that they see it next time they look. Making
 * a request wait on Expo's servers would be trading a certainty for a courtesy.
 */
import { isUserOnline } from '../socket.js';
import { pushToUser } from '../services/push.service.js';

export const emitNotification = (req, notification) => {
  const userId = notification.userId?.toString?.() || notification.userId;

  const io = req.app.get('io');
  if (io) {
    io.to(`user:${userId}`).emit('notification:new', {
      _id: notification._id,
      title: notification.title,
      body: notification.body,
      type: notification.type,
      isRead: notification.isRead,
      data: notification.data,
      createdAt: notification.createdAt,
    });
  }

  pushToUser(notification, { skip: isUserOnline(userId) }).catch(() => {});
};
