import mongoose from 'mongoose';
import Message from '../models/Message.js';
import Profile from '../models/Profile.js';
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess, sendPaginated } from '../utils/apiResponse.js';
import { getPagination, buildPaginationMeta } from '../utils/paginate.js';

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
            avatarUrl: otherProfile.avatarUrl,
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

  if (!content || !content.trim()) {
    throw new AppError('Message content cannot be empty.', 400);
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
    content: content.trim(),
    isRead: false,
  });

  const populated = await message.populate([
    { path: 'senderId', select: 'fullName avatarUrl' },
    { path: 'receiverId', select: 'fullName avatarUrl' },
  ]);

  sendSuccess(res, { message: populated }, 'Message sent.', 201);
});
