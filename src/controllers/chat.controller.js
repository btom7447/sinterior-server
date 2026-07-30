import mongoose from 'mongoose';
import Message from '../models/Message.js';
import Profile from '../models/Profile.js';
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess, sendPaginated } from '../utils/apiResponse.js';
import { getPagination, buildPaginationMeta } from '../utils/paginate.js';
import { resolveUploadUrl, resolveImageUrls } from '../utils/resolveUrl.js';
import { describeAttachments } from '../config/attachments.js';
import { isProfileOnline } from '../socket.js';
import ChatReport from '../models/ChatReport.js';


/**
 * How a counterpart is described, everywhere.
 *
 * Presence and staff status are part of it because both change how a member
 * reads the thread: "online" decides whether they wait for an answer, and the
 * staff badge is the only thing that tells them a stranger claiming to be
 * Sintherior actually is.
 */
const shapeParticipant = (profile) =>
  profile
    ? {
        id: profile._id,
        fullName: profile.fullName,
        avatarUrl: resolveUploadUrl(profile.avatarUrl),
        role: profile.role,
        /** Platform staff. Drawn as a verified badge, never as an ordinary role. */
        isStaff: profile.role === 'admin',
        isOnline: isProfileOnline(profile._id),
      }
    : null;

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
          // The tick on a conversation row is drawn from the last message, and
          // only when that message is one of ours.
          status: '$lastMessage.status',
          hasMedia: { $gt: [{ $size: { $ifNull: ['$lastMessage.media', []] } }, 0] },
          // Carried through so the row can name what was sent. A thread whose
          // last message is a spreadsheet should not read as an empty line.
          attachments: {
            $map: {
              input: { $ifNull: ['$lastMessage.attachments', []] },
              as: 'a',
              in: { kind: '$$a.kind' },
            },
          },
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
    const last = conv.lastMessage;
    return {
      conversationId: conv.conversationId,
      lastMessage: last
        ? {
            ...last,
            // Named on the server so every client says the same thing, and so a
            // list row never comes back blank because the message was a file.
            preview: last.content?.trim() || describeAttachments(last.attachments),
          }
        : last,
      unreadCount: conv.unreadCount,
      participant: shapeParticipant(otherProfile),
    };
  });

  sendSuccess(res, { conversations: enriched }, 'Conversations retrieved.');
});

// ── GET /api/v1/chat/messages/:conversationId ─────────────────────────────────

// ── GET /api/v1/chat/conversations/:conversationId ────────────────────────────
// Thread metadata for clients that must NOT trust navigation params for the
// recipient (mobile deep-link hardening): resolves the counterpart participant
// and the caller's own profile id server-side.
export const getConversationMeta = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) throw new AppError('Profile not found.', 404);

  const { conversationId } = req.params;
  const anyMessage = await Message.findOne({
    conversationId,
    $or: [{ senderId: profile._id }, { receiverId: profile._id }],
  }).select('senderId receiverId');
  if (!anyMessage) throw new AppError('Conversation not found or access denied.', 404);

  const otherId =
    anyMessage.senderId.toString() === profile._id.toString()
      ? anyMessage.receiverId
      : anyMessage.senderId;
  const other = await Profile.findById(otherId).select('fullName avatarUrl role');

  sendSuccess(
    res,
    { myProfileId: profile._id, conversationId, participant: shapeParticipant(other) },
    'Conversation metadata retrieved.'
  );
});

// ── GET /api/v1/chat/with/:profileId ──────────────────────────────────────────
/**
 * Metadata for a thread that may not exist yet.
 *
 * Starting a conversation used to be impossible from the contact book: the app
 * navigated with the person's profile id where a conversation id belonged, the
 * meta lookup found no messages, 404'd, and the composer stayed disabled — so
 * the one screen whose whole purpose is to send a first message could not send
 * one.
 *
 * This resolves the pair instead of looking for history. The profile id is still
 * untrusted input, so the participant returned is read from the database rather
 * than echoed back, which keeps the rule that a client never supplies the
 * identity it is shown.
 */
export const getConversationWith = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id }).select('_id');
  if (!profile) throw new AppError('Profile not found.', 404);

  const { profileId } = req.params;
  if (!mongoose.isValidObjectId(profileId)) throw new AppError('Recipient not found.', 404);
  if (profileId === profile._id.toString()) {
    throw new AppError('You cannot message yourself.', 400);
  }

  const other = await Profile.findById(profileId).select('fullName avatarUrl role');
  if (!other) throw new AppError('Recipient not found.', 404);

  sendSuccess(
    res,
    {
      myProfileId: profile._id,
      conversationId: buildConversationId(profile._id, other._id),
      participant: shapeParticipant(other),
    },
    'Conversation metadata retrieved.'
  );
});

// ── POST /api/v1/chat/conversations/:conversationId/report ───────────────────
/**
 * Report a conversation to platform staff.
 *
 * Only a participant may report, and the person reported is read from the thread
 * rather than from the body — a client naming who it is complaining about is a
 * client that can file a complaint against anybody.
 */
export const reportConversation = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id }).select('_id');
  if (!profile) throw new AppError('Profile not found.', 404);

  const { conversationId } = req.params;
  const { reason, note } = req.body;

  const anyMessage = await Message.findOne({
    conversationId,
    $or: [{ senderId: profile._id }, { receiverId: profile._id }],
  })
    .sort({ createdAt: -1 })
    .select('senderId receiverId createdAt');
  if (!anyMessage) throw new AppError('Conversation not found or access denied.', 404);

  const reported =
    anyMessage.senderId.toString() === profile._id.toString()
      ? anyMessage.receiverId
      : anyMessage.senderId;

  try {
    await ChatReport.create({
      conversationId,
      reporter: profile._id,
      reported,
      reason,
      note: note ?? '',
      lastMessageAt: anyMessage.createdAt,
    });
  } catch (err) {
    // The partial unique index rejected it: this person already has an open
    // report on this thread. That is the state they wanted, so say so plainly
    // rather than failing.
    if (err.code !== 11000) throw err;
    return sendSuccess(res, null, 'You have already reported this conversation.');
  }

  sendSuccess(res, null, 'Reported. Our team will take a look.');
});

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

  /**
   * Mark everything sent to this person as read, and tell the sender.
   *
   * The telling is the part that was missing. Messages were marked here and the
   * sender found out on their next poll, up to ten seconds later — which is
   * exactly why the second tick felt slow next to WhatsApp, where it lands the
   * moment the other person opens the thread.
   *
   * Only emitted when something actually changed, or every fetch of an
   * already-read thread would fire an event at somebody for nothing.
   */
  const read = await Message.updateMany(
    { conversationId, receiverId: profile._id, isRead: false },
    { $set: { isRead: true, status: 'read', readAt: new Date() } }
  );

  if (read.modifiedCount > 0) {
    const io = req.app.get('io');
    if (io) {
      // The counterpart is whoever is not us in this deterministic pair id.
      const otherId = conversationId
        .split('_')
        .find((part) => part !== profile._id.toString());

      if (otherId) {
        io.to(`profile:${otherId}`).emit('message:read', {
          conversationId,
          readerId: profile._id.toString(),
        });
      }
    }
  }

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

  // Uploaded by attachmentUpload, which has already checked type and size.
  const attachments = req.attachments ?? [];

  // media[] is the compatible shadow: URLs only, and only of things the web
  // client knows how to draw. A document in there would render as a broken img.
  const media = attachments
    .filter((a) => a.kind === 'image' || a.kind === 'video')
    .map((a) => a.url);

  if ((!content || !content.trim()) && attachments.length === 0) {
    throw new AppError('Message must have content or an attachment.', 400);
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

  /**
   * Born delivered when the recipient is connected.
   *
   * The socket send path already did this; the REST path did not — and the REST
   * path is the one the app actually uses, for every message with an attachment
   * and every message without. So `delivered` was unreachable from the app:
   * everything sat on one tick until the recipient opened the thread, at which
   * point it jumped straight to read. The two-grey-tick state — "on their phone,
   * not yet opened" — is the one a sender waiting on a quote cares about most,
   * and it never appeared.
   */
  const online = isProfileOnline(receiverProfile._id);

  const message = await Message.create({
    conversationId,
    senderId: senderProfile._id,
    receiverId: receiverProfile._id,
    content: content?.trim() || '',
    media: media.length > 0 ? media : undefined,
    attachments,
    isRead: false,
    status: online ? 'delivered' : 'sent',
    deliveredAt: online ? new Date() : null,
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
      // Sent whole so the recipient can draw the bubble from the socket payload
      // alone, without a round trip to find out what arrived.
      attachments: message.toJSON().attachments,
      isRead: false,
      status: message.status,
      createdAt: message.createdAt,
    };

    io.to(`profile:${receiverProfile._id}`).emit('message:new', messageData);
    io.to(`profile:${senderProfile._id}`).emit('message:new', messageData);

    io.to(`profile:${receiverProfile._id}`).emit('conversation:updated', {
      conversationId,
      lastMessage: {
        content: message.content || describeAttachments(attachments),
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
