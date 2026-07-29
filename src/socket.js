import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import config from './config/env.js';
import { resolveUploadUrl } from './utils/resolveUrl.js';
import Profile from './models/Profile.js';
import Message from './models/Message.js';
import User from './models/User.js';
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
 * Initialize Socket.IO on the HTTP server.
 */
export default function initSocket(server) {
  const allowedOrigins = config.CLIENT_URL.split(',').map((u) => u.trim());

  const io = new Server(server, {
    cors: {
      origin: allowedOrigins,
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
      socket.profile = { ...profile, avatarUrl: resolveUploadUrl(profile.avatarUrl) };
      next();
    } catch {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    const profileId = socket.profile._id.toString();
    addOnline(profileId, socket.id);

    // Join a user-specific room for notifications (keyed by userId, not profileId)
    socket.join(`user:${socket.user.id}`);

    // Join a profile-specific room so REST controllers can emit chat events
    socket.join(`profile:${profileId}`);

    // Notify contacts that this user is online
    socket.broadcast.emit('user:online', { profileId });

    /**
     * Everything sent to this person while they were away is delivered now.
     *
     * Delivery is "reached their device", and a socket connecting is the only
     * moment the server can honestly claim that. Senders are told per
     * conversation rather than per message, because a tick is drawn from the
     * last message in a thread and one event per message would be a hundred
     * emits for somebody opening the app after a weekend.
     */
    (async () => {
      try {
        const waiting = await Message.find({ receiverId: profileId, status: 'sent' })
          .select('conversationId senderId')
          .lean();
        if (!waiting.length) return;

        await Message.updateMany(
          { receiverId: profileId, status: 'sent' },
          { $set: { status: 'delivered', deliveredAt: new Date() } }
        );

        const bySender = new Map();
        for (const m of waiting) {
          const key = String(m.senderId);
          if (!bySender.has(key)) bySender.set(key, new Set());
          bySender.get(key).add(m.conversationId);
        }
        for (const [senderId, conversationIds] of bySender) {
          emitToUser(io, senderId, 'message:delivered', {
            conversationIds: [...conversationIds],
            to: profileId,
          });
        }
      } catch {
        // A missed delivery tick is cosmetic; the message itself is safe.
      }
    })();

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

        const conversationId = buildConversationId(profileId, receiverId);

        // Online means it lands on their device now, so it is born delivered.
        // Claiming otherwise would leave one tick on a message the recipient is
        // already looking at.
        const online = isOnline(receiverId);

        const message = await Message.create({
          conversationId,
          senderId: profileId,
          receiverId,
          content: content.trim().slice(0, 2000),
          isRead: false,
          status: online ? 'delivered' : 'sent',
          deliveredAt: online ? new Date() : null,
        });

        const messageData = {
          _id: message._id,
          conversationId,
          senderId: { _id: profileId, fullName: socket.profile.fullName, avatarUrl: socket.profile.avatarUrl },
          receiverId: { _id: receiver._id, fullName: receiver.fullName, avatarUrl: resolveUploadUrl(receiver.avatarUrl) },
          content: message.content,
          isRead: false,
          status: message.status,
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
          { $set: { isRead: true, status: 'read', readAt: new Date() } }
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

        ack?.({ users: [{ ...profile, avatarUrl: resolveUploadUrl(profile.avatarUrl), canChat: true }] });
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
