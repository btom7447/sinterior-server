import mongoose from 'mongoose';
import Message from '../models/Message.js';
import Profile from '../models/Profile.js';
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess, sendPaginated } from '../utils/apiResponse.js';
import { getPagination, buildPaginationMeta } from '../utils/paginate.js';
import { resolveUploadUrl, resolveImageUrls } from '../utils/resolveUrl.js';


/**
 * Build a deterministic conversationId from two profile IDs.
 * Sorting guarantees the same ID regardless of who initiates the chat.
 */
const buildConversationId = (idA, idB) => {
  return [idA.toString(), idB.toString()].sort().join('_');
};

// ── GET /api/v1/chat/conversations ────────────────────────────────────────────
export const getConversations = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) {
    throw new AppError('Profile not found.', 404);
  }

  const myId = profile._id.toString();

  // Aggregate unique conversations where the user is sender or receiver
  // and get the latest message for each conversation
  const conversations = await Message.aggregate([
    {
      $match: {
        $or: [
          { senderId: profile._id },
          { receiverId: profile._id },
        ],
      },
    },
    {
      $sort: { createdAt: -1 },
    },
    {
      $group: {
        _id: '$conversationId',
        lastMessage: { $first: '$$ROOT' },
        unreadCount: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$isRead', false] },
                  { $eq: ['$receiverId', profile._id] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
    {
      $sort: { 'lastMessage.createdAt': -1 },
    },
    // Lookup sender profile
    {
      $lookup: {
        from: 'profiles',
        localField: 'lastMessage.senderId',
        foreignField: '_id',
        as: 'senderProfile',
      },
    },
    // Lookup receiver profile
    {
      $lookup: {
        from: 'profiles',
        localField: 'lastMessage.receiverId',
        foreignField: '_id',
        as: 'receiverProfile',
      },
    },
    {
      $project: {
        conversationId: '$_id',
        lastMessage: {
          content: '$lastMessage.content',
          createdAt: '$lastMessage.createdAt',
          isRead: '$lastMessage.isRead',
          senderId: '$lastMessage.senderId',
        },
        unreadCount: 1,
        senderProfile: { $arrayElemAt: ['$senderProfile', 0] },
        receiverProfile: { $arrayElemAt: ['$receiverProfile', 0] },
      },
    },
  ]);

  // For each conversation, determine the "other" participant
  const enriched = conversations.map((conv) => {
    const senderIsMe = conv.senderProfile?._id?.toString() === myId;
    const otherProfile = senderIsMe ? conv.receiverProfile : conv.senderProfile;
    return {
      conversationId: conv.conversationId,
      lastMessage: conv.lastMessage,
      unreadCount: conv.unreadCount,
      participant: otherProfile
        ? {
            id: otherProfile._id,
            fullName: otherProfile.fullName,
            avatarUrl: resolveUploadUrl(otherProfile.avatarUrl),
          }
        : null,
    };
  });

  sendSuccess(res, { conversations: enriched }, 'Conversations retrieved.');
});

// ── GET /api/v1/chat/messages/:conversationId ─────────────────────────────────
export const getMessages = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) {
    throw new AppError('Profile not found.', 404);
  }

  const { conversationId } = req.params;
  const { page, limit, skip } = getPagination(req.query);

  // Verify user is a participant in this conversation
  const participantCheck = await Message.findOne({
    conversationId,
    $or: [{ senderId: profile._id }, { receiverId: profile._id }],
  });

  if (!participantCheck) {
    throw new AppError('Conversation not found or access denied.', 404);
  }

  // Mark all unread messages sent TO this user as read
  await Message.updateMany(
    { conversationId, receiverId: profile._id, isRead: false },
    { $set: { isRead: true } }
  );

  const [total, messages] = await Promise.all([
    Message.countDocuments({ conversationId }),
    Message.find({ conversationId })
      .sort({ createdAt: -1 }) // newest first; client reverses for display
      .skip(skip)
      .limit(limit)
      .populate('senderId', 'fullName avatarUrl')
      .populate('receiverId', 'fullName avatarUrl'),
  ]);

  const pagination = buildPaginationMeta(total, page, limit);
  sendPaginated(res, messages, pagination, 'Messages retrieved.');
});

// ── POST /api/v1/chat/messages ────────────────────────────────────────────────
export const sendMessage = asyncHandler(async (req, res) => {
  const senderProfile = await Profile.findOne({ userId: req.user.id });
  if (!senderProfile) {
    throw new AppError('Sender profile not found.', 404);
  }

  const { receiverId, content } = req.body;

  if (!receiverId) {
    throw new AppError('receiverId is required.', 400);
  }

  // Get media from uploaded files (if any)
  const media = req.files?.map((f) => f.url) || [];

  if ((!content || !content.trim()) && media.length === 0) {
    throw new AppError('Message must have content or media.', 400);
  }

  if (receiverId.toString() === senderProfile._id.toString()) {
    throw new AppError('You cannot send a message to yourself.', 400);
  }

  // Verify receiver exists
  const receiverProfile = await Profile.findById(receiverId);
  if (!receiverProfile) {
    throw new AppError('Recipient not found.', 404);
  }

  const conversationId = buildConversationId(senderProfile._id, receiverProfile._id);

  const message = await Message.create({
    conversationId,
    senderId: senderProfile._id,
    receiverId: receiverProfile._id,
    content: content?.trim() || '',
    media: media.length > 0 ? media : undefined,
    isRead: false,
  });

  const populated = await message.populate([
    { path: 'senderId', select: 'fullName avatarUrl' },
    { path: 'receiverId', select: 'fullName avatarUrl' },
  ]);

  // Emit real-time socket events so the receiver sees the message immediately
  const io = req.app.get('io');
  if (io) {
    const resolvedMedia = media.length > 0 ? resolveImageUrls(media) : [];

    const messageData = {
      _id: message._id,
      conversationId,
      senderId: {
        _id: senderProfile._id,
        fullName: senderProfile.fullName,
        avatarUrl: resolveUploadUrl(senderProfile.avatarUrl),
      },
      receiverId: {
        _id: receiverProfile._id,
        fullName: receiverProfile.fullName,
        avatarUrl: resolveUploadUrl(receiverProfile.avatarUrl),
      },
      content: message.content,
      media: resolvedMedia.length > 0 ? resolvedMedia : undefined,
      isRead: false,
      createdAt: message.createdAt,
    };

    io.to(`profile:${receiverProfile._id}`).emit('message:new', messageData);
    io.to(`profile:${senderProfile._id}`).emit('message:new', messageData);

    io.to(`profile:${receiverProfile._id}`).emit('conversation:updated', {
      conversationId,
      lastMessage: {
        content: message.content || (resolvedMedia.length > 0 ? 'Sent an image' : ''),
        createdAt: message.createdAt,
        senderId: senderProfile._id,
      },
      participant: {
        id: senderProfile._id,
        fullName: senderProfile.fullName,
        avatarUrl: resolveUploadUrl(senderProfile.avatarUrl),
      },
    });
  }

  sendSuccess(res, { message: populated }, 'Message sent.', 201);
});

// ── GET /api/v1/chat/search?email=... ────────────────────────────────────────
export const searchUserByEmail = asyncHandler(async (req, res) => {
  const { email } = req.query;
  if (!email?.trim()) {
    return sendSuccess(res, { users: [] }, 'No results.');
  }

  const senderProfile = await Profile.findOne({ userId: req.user.id });
  if (!senderProfile) throw new AppError('Profile not found.', 404);

  // Import User model
  const User = (await import('../models/User.js')).default;
  const user = await User.findOne({ email: email.trim().toLowerCase() }).select('_id').lean();
  if (!user) return sendSuccess(res, { users: [] }, 'No results.');

  const profile = await Profile.findOne({ userId: user._id })
    .select('_id fullName avatarUrl city')
    .lean();
  if (!profile || profile._id.toString() === senderProfile._id.toString()) {
    return sendSuccess(res, { users: [] }, 'No results.');
  }

  sendSuccess(res, { users: [{ ...profile, avatarUrl: resolveUploadUrl(profile.avatarUrl), canChat: true }] }, 'Search results.');
});
