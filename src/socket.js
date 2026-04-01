import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import config from './config/env.js';
import Profile from './models/Profile.js';
import Message from './models/Message.js';
import User from './models/User.js';
import Job from './models/Job.js';
import Order from './models/Order.js';

/**
 * Build a deterministic conversationId from two profile IDs.
 */
const buildConversationId = (idA, idB) =>
  [idA.toString(), idB.toString()].sort().join('_');

/**
 * Map of profileId → Set<socketId> for online tracking.
 */
const onlineUsers = new Map();

const addOnline = (profileId, socketId) => {
  const id = profileId.toString();
  if (!onlineUsers.has(id)) onlineUsers.set(id, new Set());
  onlineUsers.get(id).add(socketId);
};

const removeOnline = (profileId, socketId) => {
  const id = profileId.toString();
  const sockets = onlineUsers.get(id);
  if (sockets) {
    sockets.delete(socketId);
    if (sockets.size === 0) onlineUsers.delete(id);
  }
};

const isOnline = (profileId) => onlineUsers.has(profileId.toString());

const emitToUser = (io, profileId, event, data) => {
  const sockets = onlineUsers.get(profileId.toString());
  if (sockets) {
    for (const sid of sockets) {
      io.to(sid).emit(event, data);
    }
  }
};

/**
 * Check if two users are allowed to chat.
 * Allowed if: they share a job OR an order.
 */
const canChat = async (profileIdA, profileIdB) => {
  const a = profileIdA.toString();
  const b = profileIdB.toString();

  // Check if they share a job
  const job = await Job.findOne({
    $or: [
      { clientId: a, artisanId: b },
      { clientId: b, artisanId: a },
    ],
  }).lean();
  if (job) return true;

  // Check if they share an order (buyer placed order with seller's products)
  const order = await Order.findOne({
    $or: [
      { buyerId: a, 'items.supplierId': b },
      { buyerId: b, 'items.supplierId': a },
    ],
  }).lean();
  if (order) return true;

  return false;
};

/**
 * Initialize Socket.IO on the HTTP server.
 */
export default function initSocket(server) {
  const io = new Server(server, {
    cors: {
      origin: config.CLIENT_URL,
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // ── Auth middleware — verify JWT on connect ────────────────────────────────
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace('Bearer ', '');

      if (!token) return next(new Error('Authentication required'));

      const decoded = jwt.verify(token, config.JWT_ACCESS_SECRET);
      const user = await User.findById(decoded.id).select('role').lean();
      if (!user) return next(new Error('User not found'));

      const profile = await Profile.findOne({ userId: decoded.id })
        .select('_id fullName avatarUrl')
        .lean();
      if (!profile) return next(new Error('Profile not found'));

      socket.user = { id: decoded.id, role: user.role };
      socket.profile = profile;
      next();
    } catch {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    const profileId = socket.profile._id.toString();
    addOnline(profileId, socket.id);

    // Notify contacts that this user is online
    socket.broadcast.emit('user:online', { profileId });

    // ── Send message ──────────────────────────────────────────────────────
    socket.on('message:send', async (data, ack) => {
      try {
        const { receiverId, content } = data;
        if (!receiverId || !content?.trim()) {
          return ack?.({ error: 'receiverId and content required' });
        }

        if (receiverId === profileId) {
          return ack?.({ error: 'Cannot message yourself' });
        }

        // Verify receiver exists
        const receiver = await Profile.findById(receiverId)
          .select('_id fullName avatarUrl')
          .lean();
        if (!receiver) return ack?.({ error: 'Recipient not found' });

        // Check chat access
        const allowed = await canChat(profileId, receiverId);
        if (!allowed) {
          return ack?.({
            error: 'You can only chat with artisans you\'ve hired or sellers you\'ve ordered from',
          });
        }

        const conversationId = buildConversationId(profileId, receiverId);

        const message = await Message.create({
          conversationId,
          senderId: profileId,
          receiverId,
          content: content.trim().slice(0, 2000),
          isRead: false,
        });

        const messageData = {
          _id: message._id,
          conversationId,
          senderId: { _id: profileId, fullName: socket.profile.fullName, avatarUrl: socket.profile.avatarUrl },
          receiverId: { _id: receiver._id, fullName: receiver.fullName, avatarUrl: receiver.avatarUrl },
          content: message.content,
          isRead: false,
          createdAt: message.createdAt,
        };

        // Send to receiver if online
        emitToUser(io, receiverId, 'message:new', messageData);

        // Also update conversation list for receiver
        emitToUser(io, receiverId, 'conversation:updated', {
          conversationId,
          lastMessage: { content: message.content, createdAt: message.createdAt, senderId: profileId },
          participant: { id: profileId, fullName: socket.profile.fullName, avatarUrl: socket.profile.avatarUrl },
        });

        ack?.({ message: messageData });
      } catch (err) {
        ack?.({ error: err.message || 'Failed to send message' });
      }
    });

    // ── Mark messages as read ─────────────────────────────────────────────
    socket.on('message:read', async (data) => {
      try {
        const { conversationId } = data;
        if (!conversationId) return;

        await Message.updateMany(
          { conversationId, receiverId: profileId, isRead: false },
          { $set: { isRead: true } }
        );

        // Notify the other party that messages were read
        const otherProfileId = conversationId
          .split('_')
          .find((id) => id !== profileId);
        if (otherProfileId) {
          emitToUser(io, otherProfileId, 'message:read', { conversationId, readBy: profileId });
        }
      } catch {
        // silent
      }
    });

    // ── Typing indicator ──────────────────────────────────────────────────
    socket.on('typing:start', (data) => {
      const { conversationId } = data;
      if (!conversationId) return;
      const otherProfileId = conversationId.split('_').find((id) => id !== profileId);
      if (otherProfileId) {
        emitToUser(io, otherProfileId, 'typing:start', { conversationId, profileId });
      }
    });

    socket.on('typing:stop', (data) => {
      const { conversationId } = data;
      if (!conversationId) return;
      const otherProfileId = conversationId.split('_').find((id) => id !== profileId);
      if (otherProfileId) {
        emitToUser(io, otherProfileId, 'typing:stop', { conversationId, profileId });
      }
    });

    // ── Check online status ───────────────────────────────────────────────
    socket.on('user:check-online', (data, ack) => {
      const { profileIds } = data;
      if (!Array.isArray(profileIds)) return ack?.({});
      const statuses = {};
      profileIds.forEach((id) => {
        statuses[id] = isOnline(id);
      });
      ack?.(statuses);
    });

    // ── Search users by email ─────────────────────────────────────────────
    socket.on('user:search', async (data, ack) => {
      try {
        const { email } = data;
        if (!email?.trim()) return ack?.({ users: [] });

        const user = await User.findOne({ email: email.trim().toLowerCase() })
          .select('_id')
          .lean();
        if (!user) return ack?.({ users: [] });

        const profile = await Profile.findOne({ userId: user._id })
          .select('_id fullName avatarUrl')
          .lean();
        if (!profile || profile._id.toString() === profileId) return ack?.({ users: [] });

        // Check if chat is allowed
        const allowed = await canChat(profileId, profile._id);
        ack?.({ users: [{ ...profile, canChat: allowed }] });
      } catch {
        ack?.({ users: [] });
      }
    });

    // ── Disconnect ────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      removeOnline(profileId, socket.id);
      if (!isOnline(profileId)) {
        socket.broadcast.emit('user:offline', { profileId });
      }
    });
  });

  return io;
}
