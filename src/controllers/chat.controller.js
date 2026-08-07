import mongoose from 'mongoose';
import Message from '../models/Message.js';
import Profile from '../models/Profile.js';
import Block from '../models/Block.js';
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess, sendPaginated } from '../utils/apiResponse.js';
import { getPagination, buildPaginationMeta } from '../utils/paginate.js';
import { resolveUploadUrl, resolveImageUrls } from '../utils/resolveUrl.js';
import { describeAttachments } from '../config/attachments.js';
import { isProfileOnline } from '../socket.js';
import ChatReport from '../models/ChatReport.js';
import ConversationState from '../models/ConversationState.js';
import { destroyAttachments } from '../middleware/attachmentUpload.js';
import { pushMessage } from '../services/messagePush.service.js';
import escapeRegex from '../utils/escapeRegex.js';


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
          // Carried so the row can say a message was deleted rather than showing an
          // empty line under the name, which reads as a thread that broke.
          deletedForEveryone: '$lastMessage.deletedForEveryone',
          // And whether this particular reader removed it from their own view, which
          // the other participant's row must not reflect.
          hiddenFor: { $ifNull: ['$lastMessage.hiddenFor', []] },
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

  /**
   * This person's own arrangement of these threads.
   *
   * One query for all of them rather than a lookup per row, and most threads have no
   * row at all - the absence of one is the default and costs nothing.
   */
  const states = await ConversationState.find({
    profileId: profile._id,
    conversationId: { $in: conversations.map((c) => c._id) },
  }).lean();

  const stateFor = new Map(states.map((s) => [s.conversationId, s]));
  const now = Date.now();

  // For each conversation, determine the "other" participant
  const enriched = conversations.map((conv) => {
    const senderIsMe = conv.senderProfile?._id?.toString() === myId;
    const otherProfile = senderIsMe ? conv.receiverProfile : conv.senderProfile;
    const last = conv.lastMessage;
    const state = stateFor.get(conv.conversationId);

    /**
     * What the row says, from this reader's point of view.
     *
     * Three states, not one. A withdrawn message reads the same to both sides; a
     * message somebody removed from their own view reads as deleted to them and
     * normally to the other participant, which is why this cannot be computed once
     * and shared. Without it, deleting the last message left a row with a name and an
     * empty line — which reads as a thread that broke rather than one that was tidied.
     *
     * Computed before hiddenFor is stripped below, which is an ordering that has to
     * stay this way round: reading it after the delete is reading undefined.
     */
    const preview = !last
      ? ''
      : last.deletedForEveryone
        ? 'This message was deleted'
        : (last.hiddenFor ?? []).some((id) => String(id) === myId)
          ? 'You deleted this message'
          : last.content?.trim() || describeAttachments(last.attachments);

    // Never sent on: whether the other participant tidied their own view is their
    // business, and the preview has already taken ours into account.
    if (last) delete last.hiddenFor;

    return {
      conversationId: conv.conversationId,
      pinnedAt: state?.pinnedAt ?? null,
      // Compared on read rather than unset by a job, so "mute for 8 hours" needs no
      // scheduler to expire it.
      muted: !!state?.mutedUntil && new Date(state.mutedUntil).getTime() > now,
      mutedUntil: state?.mutedUntil ?? null,
      lastMessage: last
        ? {
            ...last,
            // Named on the server so every client says the same thing, and so a
            // list row never comes back blank because the message was a file.
            preview,
          }
        : last,
      unreadCount: conv.unreadCount,
      participant: shapeParticipant(otherProfile),
    };
  });

  /**
   * A cleared thread stays out of the list until something new arrives.
   *
   * Deleting a chat should leave no row behind, but the messages are still there for
   * the other participant - so the row is suppressed while its newest message predates
   * the clear, and reappears the moment they write again. Which is what somebody
   * expects: deleting a conversation is not blocking a person.
   */
  const visible = enriched.filter((row) => {
    const state = stateFor.get(row.conversationId);
    if (!state?.clearedAt) return true;
    const last = row.lastMessage?.createdAt;
    return !!last && new Date(last).getTime() > new Date(state.clearedAt).getTime();
  });

  /**
   * Pinned first, most recently pinned above the rest of them.
   *
   * Sorted here rather than in the aggregation because the pins live in another
   * collection and the list is already in memory - at a person's number of threads
   * this is cheaper than the join would be.
   */
  visible.sort((a, b) => {
    if (!!a.pinnedAt !== !!b.pinnedAt) return a.pinnedAt ? -1 : 1;
    if (a.pinnedAt && b.pinnedAt) {
      return new Date(b.pinnedAt).getTime() - new Date(a.pinnedAt).getTime();
    }
    const at = (row) => new Date(row.lastMessage?.createdAt ?? 0).getTime();
    return at(b) - at(a);
  });

  sendSuccess(res, { conversations: visible }, 'Conversations retrieved.');
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

/**
 * How long a sender has to withdraw a message from the other side.
 *
 * An hour, which is far shorter than WhatsApp's couple of days — and deliberately.
 * The legitimate use is fixing a mistake: wrong thread, wrong photograph, a typo in
 * a price. Nobody notices that a day later; they notice it in minutes.
 *
 * The illegitimate use is removing evidence. A thread here is the record of a job,
 * and a sender who can reach back into last month can quietly delete the message
 * where they promised a price or a date. An hour keeps the mistake-fixing and
 * closes that.
 */
const WITHDRAW_WINDOW_MS = 60 * 60 * 1000;

/**
 * How long a sender has to fix what they wrote.
 *
 * Fifteen minutes, matching what people already know from WhatsApp, and longer than
 * the hour-less unsend window is short — because an edit leaves the message and its
 * marker in place, so it cannot be used to make a promise vanish. The worst it can
 * do is change a number, which the marker announces.
 */
const EDIT_WINDOW_MS = 15 * 60 * 1000;

// -- GET /api/v1/chat/conversations/:conversationId/media ---------------------
/**
 * Everything ever attached to one conversation.
 *
 * The question this answers is "where is that photograph of the wall" — asked days
 * later, about a thread with four hundred messages in it. Scrolling for it is the
 * thing people give up on, and giving up means asking the other person to send it
 * again, which is how a platform ends up with four copies of the same picture.
 *
 * Grouped by kind because the three are looked for differently: photographs are
 * recognised at a glance in a grid, and a document is found by its name in a list.
 */
export const getConversationMedia = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id }).select('_id');
  if (!profile) throw new AppError('Profile not found.', 404);

  const { conversationId } = req.params;

  const participantCheck = await Message.findOne({
    conversationId,
    $or: [{ senderId: profile._id }, { receiverId: profile._id }],
  }).select('_id');
  if (!participantCheck) throw new AppError('Conversation not found or access denied.', 404);

  // Respects both kinds of deletion and the clear line, so a thread somebody tidied
  // does not quietly keep offering what they removed.
  const state = await ConversationState.findOne({
    profileId: profile._id,
    conversationId,
  })
    .select('clearedAt')
    .lean();

  const messages = await Message.find({
    conversationId,
    deletedForEveryone: false,
    hiddenFor: { $ne: profile._id },
    'attachments.0': { $exists: true },
    ...(state?.clearedAt ? { createdAt: { $gt: state.clearedAt } } : {}),
  })
    .sort({ createdAt: -1 })
    // Enough for the grid and the lists without paging: a thread with more than four
    // hundred attachments is not the case worth optimising for yet.
    .limit(400)
    .select('attachments createdAt senderId')
    .lean();

  const media = [];
  const files = [];
  const voice = [];

  for (const message of messages) {
    for (const attachment of message.attachments ?? []) {
      // The message's own timestamp, since an attachment has none of its own and
      // "when was this sent" is most of how somebody recognises it.
      const entry = { ...attachment, messageId: message._id, createdAt: message.createdAt };

      if (attachment.kind === 'image' || attachment.kind === 'video') media.push(entry);
      else if (attachment.kind === 'voice') voice.push(entry);
      else files.push(entry);
    }
  }

  const resolve = (list) =>
    list.map((entry) => ({
      ...entry,
      url: resolveUploadUrl(entry.url),
      thumbnailUrl: entry.thumbnailUrl ? resolveUploadUrl(entry.thumbnailUrl) : null,
    }));

  sendSuccess(
    res,
    { media: resolve(media), files: resolve(files), voice: resolve(voice) },
    'Shared media retrieved.'
  );
});

// -- POST /api/v1/chat/messages/forward ---------------------------------------
/**
 * Forward several messages to one conversation.
 *
 * A list rather than one call each, for two reasons. The obvious one is round trips:
 * five taps of a bulk action on a Nigerian connection should not be five visible
 * pauses. The less obvious one is order — sending them in parallel means they arrive
 * in whatever order the writes complete, so a quote and the photograph it refers to
 * can land the wrong way round. These are written oldest first, in sequence.
 */
export const forwardMessages = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id }).select('_id fullName avatarUrl');
  if (!profile) throw new AppError('Profile not found.', 404);

  const ids = [...new Set((req.body.messageIds ?? []).map(String))].slice(0, 30);
  if (!ids.length) throw new AppError('Nothing was selected.', 400);

  const receiver = await Profile.findById(req.body.receiverId).select('_id fullName avatarUrl');
  if (!receiver) throw new AppError('Recipient not found.', 404);
  if (receiver._id.toString() === profile._id.toString()) {
    throw new AppError('You cannot message yourself.', 400);
  }

  /**
   * Only messages this person is actually part of.
   *
   * Without this any message id in the database becomes a message anybody can put in
   * their own thread — which is a disclosure bug, not a validation nicety.
   */
  const sources = await Message.find({
    _id: { $in: ids },
    deletedForEveryone: false,
    $or: [{ senderId: profile._id }, { receiverId: profile._id }],
  })
    .sort({ createdAt: 1 })
    .lean();

  if (!sources.length) throw new AppError('Those messages are no longer available.', 404);

  const conversationId = buildConversationId(profile._id, receiver._id);
  const online = isProfileOnline(receiver._id);
  const io = req.app.get('io');

  const sent = [];
  for (const source of sources) {
    // Sequential on purpose: createdAt is what orders a thread, and a parallel write
    // would let two messages share a millisecond and arrive reversed.
    const message = await Message.create({
      conversationId,
      senderId: profile._id,
      receiverId: receiver._id,
      content: source.content,
      media: source.media,
      // Referenced, not re-uploaded. The assets are already in Cloudinary; the delete
      // path counts references before destroying anything.
      attachments: source.attachments,
      forwarded: true,
      isRead: false,
      status: online ? 'delivered' : 'sent',
      deliveredAt: online ? new Date() : null,
    });

    const populated = await message.populate([
      { path: 'senderId', select: 'fullName avatarUrl' },
      { path: 'receiverId', select: 'fullName avatarUrl' },
    ]);

    if (io) {
      const payload = populated.toJSON();
      io.to(`profile:${receiver._id}`).emit('message:new', payload);
      io.to(`profile:${profile._id}`).emit('message:new', payload);
    }
    sent.push(populated.toJSON());
  }

  sendSuccess(res, { forwarded: sent.length, messages: sent }, 'Forwarded.', 201);
});

// -- POST /api/v1/chat/messages/delete ----------------------------------------
/**
 * Remove several messages at once.
 *
 * Reports what it could not do rather than failing the whole request. A selection of
 * six where one is too old to unsend should remove five and say so — refusing all six
 * because of one would make somebody select them again minus the offender, which is
 * both tedious and easy to get wrong.
 */
export const deleteMessages = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id }).select('_id');
  if (!profile) throw new AppError('Profile not found.', 404);

  const ids = [...new Set((req.body.messageIds ?? []).map(String))].slice(0, 30);
  if (!ids.length) throw new AppError('Nothing was selected.', 400);

  const everyone = req.body.scope === 'everyone';

  const messages = await Message.find({
    _id: { $in: ids },
    $or: [{ senderId: profile._id }, { receiverId: profile._id }],
  });
  if (!messages.length) throw new AppError('Those messages are no longer available.', 404);

  if (!everyone) {
    // Hiding is always allowed and never partial, so it is one write.
    await Message.updateMany(
      { _id: { $in: messages.map((m) => m._id) } },
      { $addToSet: { hiddenFor: profile._id } }
    );
    return sendSuccess(res, { removed: messages.length, refused: 0 }, 'Removed.');
  }

  const underReview = await ChatReport.exists({
    conversationId: messages[0].conversationId,
    status: { $in: ['open', 'reviewing'] },
  });
  if (underReview) {
    throw new AppError(
      'This conversation is being reviewed, so messages cannot be unsent right now.',
      403
    );
  }

  const io = req.app.get('io');
  let removed = 0;
  let refused = 0;

  for (const message of messages) {
    const mine = message.senderId.toString() === profile._id.toString();
    const tooOld = Date.now() - new Date(message.createdAt).getTime() > WITHDRAW_WINDOW_MS;

    if (!mine || tooOld || message.deletedForEveryone) {
      refused += 1;
      continue;
    }

    // Same reference count as the single delete: a forwarded copy points at the same
    // Cloudinary asset, and destroying it here would blank a photograph in an
    // unrelated thread.
    const shared = message.attachments?.length
      ? await Message.countDocuments({
          _id: { $ne: message._id },
          deletedForEveryone: false,
          'attachments.publicId': {
            $in: message.attachments.map((a) => a.publicId).filter(Boolean),
          },
        })
      : 0;
    if (!shared) await destroyAttachments(message.attachments);

    message.content = '';
    message.media = [];
    message.attachments = [];
    message.deletedForEveryone = true;
    message.deletedAt = new Date();
    message.deletedBy = profile._id;
    await message.save();
    removed += 1;

    if (io) {
      const payload = {
        conversationId: message.conversationId,
        messageId: message._id,
        deletedBy: profile._id.toString(),
      };
      io.to(`profile:${message.senderId}`).emit('message:deleted', payload);
      io.to(`profile:${message.receiverId}`).emit('message:deleted', payload);
    }
  }

  sendSuccess(
    res,
    { removed, refused },
    refused
      ? `Unsent ${removed}. ${refused} could not be unsent — they are too old or not yours.`
      : 'Unsent.'
  );
});

// -- POST /api/v1/chat/conversations/actions ----------------------------------
/**
 * Pin, unpin, mute, unmute or clear several conversations at once.
 *
 * One endpoint taking a list rather than one call per conversation, because the screen
 * that uses it selects several and acts on them together - and five taps of a bulk
 * action should not be five round trips on a connection where each one is a visible
 * pause.
 *
 * Every action is idempotent and scoped to the caller's own state, so nothing here can
 * change what the other participant sees.
 */
export const updateConversations = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id }).select('_id');
  if (!profile) throw new AppError('Profile not found.', 404);

  const { conversationIds, action, mutedUntil } = req.body;
  const ids = [...new Set((conversationIds ?? []).map(String))].slice(0, 50);
  if (!ids.length) throw new AppError('Nothing was selected.', 400);

  /**
   * Only threads this person is actually in.
   *
   * These ids are client-supplied strings rather than document ids, so without this a
   * caller could pin - and worse, mark cleared - a conversation between two other
   * people. It would not leak the messages, but it would let anybody write rows
   * against somebody else's thread.
   */
  const mine = await Message.distinct('conversationId', {
    conversationId: { $in: ids },
    $or: [{ senderId: profile._id }, { receiverId: profile._id }],
  });
  if (!mine.length) throw new AppError('Conversation not found or access denied.', 404);

  const now = new Date();
  const changes = {
    pin: { pinnedAt: now },
    unpin: { pinnedAt: null },
    mute: { mutedUntil: mutedUntil ? new Date(mutedUntil) : null },
    unmute: { mutedUntil: null },
    // Clearing is a line in time, not a bulk write over every message - so a thread of
    // four thousand messages costs one document either way.
    clear: { clearedAt: now },
  }[action];

  if (!changes) throw new AppError('Unknown action.', 400);

  await ConversationState.bulkWrite(
    mine.map((conversationId) => ({
      updateOne: {
        filter: { profileId: profile._id, conversationId },
        update: { $set: changes },
        upsert: true,
      },
    }))
  );

  sendSuccess(res, { updated: mine.length }, 'Done.');
});

// -- GET /api/v1/chat/messages/:conversationId/search?q= ----------------------──
/**
 * Find something somebody said in this thread.
 *
 * The useful answer is not just the matching messages but where they are, because
 * the point of finding one is to read what surrounded it. So each hit carries its
 * `position` — how many messages newer than it exist — which is exactly what the
 * app needs to work out which page to load and where to scroll.
 *
 * Withdrawn and self-deleted messages are excluded: their content is gone, and a
 * search that returns rows saying "this message was deleted" is answering a
 * question nobody asked.
 */
export const searchMessages = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id }).select('_id');
  if (!profile) throw new AppError('Profile not found.', 404);

  const { conversationId } = req.params;
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) return sendSuccess(res, { results: [] }, 'Nothing to search for.');

  const participantCheck = await Message.findOne({
    conversationId,
    $or: [{ senderId: profile._id }, { receiverId: profile._id }],
  }).select('_id');
  if (!participantCheck) throw new AppError('Conversation not found or access denied.', 404);

  const pattern = new RegExp(escapeRegex(q), 'i');
  const hits = await Message.find({
    conversationId,
    content: pattern,
    deletedForEveryone: false,
    hiddenFor: { $ne: profile._id },
  })
    .sort({ createdAt: -1 })
    .limit(50)
    .select('content createdAt senderId')
    .lean();

  /**
   * How far down the thread each hit sits.
   *
   * Counted per hit rather than derived from a single query, because the thread's
   * own ordering excludes what this person has hidden — so the only honest way to
   * say "this is the 214th message from the newest" is to count them.
   */
  const results = await Promise.all(
    hits.map(async (hit) => ({
      ...hit,
      position: await Message.countDocuments({
        conversationId,
        hiddenFor: { $ne: profile._id },
        createdAt: { $gt: hit.createdAt },
      }),
    }))
  );

  sendSuccess(res, { results }, 'Search results.');
});

// ── PATCH /api/v1/chat/messages/:messageId ────────────────────────────────────
/**
 * Change what a message says.
 *
 * Text only, and only your own. Editing somebody else's words is not a feature, and
 * editing an attachment is not an edit — it is a different message, which forwarding
 * and sending already cover.
 */
export const editMessage = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id }).select('_id');
  if (!profile) throw new AppError('Profile not found.', 404);

  const message = await Message.findById(req.params.messageId);
  if (!message) throw new AppError('Message not found.', 404);

  if (message.senderId.toString() !== profile._id.toString()) {
    throw new AppError('You can only edit your own messages.', 403);
  }
  if (message.deletedForEveryone) throw new AppError('That message was deleted.', 400);

  const age = Date.now() - new Date(message.createdAt).getTime();
  if (age > EDIT_WINDOW_MS) {
    throw new AppError('This message is too old to edit.', 403);
  }

  // Same rule as unsending: a report exists because somebody disputes what was
  // said, and rewriting it while staff are reading would defeat the report.
  const underReview = await ChatReport.exists({
    conversationId: message.conversationId,
    status: { $in: ['open', 'reviewing'] },
  });
  if (underReview) {
    throw new AppError(
      'This conversation is being reviewed, so messages cannot be edited right now.',
      403
    );
  }

  const content = String(req.body.content ?? '').trim();
  if (!content) throw new AppError('An edited message still needs some words.', 400);

  message.content = content.slice(0, 2000);
  message.editedAt = new Date();
  await message.save();

  const io = req.app.get('io');
  if (io) {
    const payload = {
      conversationId: message.conversationId,
      messageId: message._id,
      content: message.content,
      editedAt: message.editedAt,
    };
    io.to(`profile:${message.senderId}`).emit('message:edited', payload);
    io.to(`profile:${message.receiverId}`).emit('message:edited', payload);
  }

  sendSuccess(res, { message: message.toJSON() }, 'Message updated.');
});

// ── POST /api/v1/chat/messages/:messageId/forward ─────────────────────────────
/**
 * Pass a message on to another conversation.
 *
 * The attachments are referenced, not re-uploaded. They are already in Cloudinary
 * and already paid for; copying the subdocuments makes forwarding a photograph
 * free and instant instead of a second upload of bytes that never left the server.
 *
 * The consequence is deliberate and worth stating: two messages then point at one
 * asset, so withdrawing one must not destroy it. destroyAttachments is only
 * reached from delete-for-everyone, which is guarded below by a reference count.
 */
export const forwardMessage = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id }).select('_id fullName avatarUrl');
  if (!profile) throw new AppError('Profile not found.', 404);

  const source = await Message.findById(req.params.messageId);
  if (!source) throw new AppError('Message not found.', 404);

  // Only a participant may forward it. Otherwise any message id in the database
  // becomes a message anybody can put in their own thread.
  const participant =
    source.senderId.toString() === profile._id.toString() ||
    source.receiverId.toString() === profile._id.toString();
  if (!participant) throw new AppError('Message not found.', 404);

  if (source.deletedForEveryone) {
    throw new AppError('That message was deleted.', 400);
  }

  const { receiverId } = req.body;
  const receiver = await Profile.findById(receiverId).select('_id fullName avatarUrl');
  if (!receiver) throw new AppError('Recipient not found.', 404);
  if (receiver._id.toString() === profile._id.toString()) {
    throw new AppError('You cannot message yourself.', 400);
  }

  const conversationId = buildConversationId(profile._id, receiver._id);
  const online = isProfileOnline(receiver._id);

  const message = await Message.create({
    conversationId,
    senderId: profile._id,
    receiverId: receiver._id,
    content: source.content,
    media: source.media,
    // Copied wholesale: same urls, same publicIds, same metadata.
    attachments: source.attachments,
    forwarded: true,
    isRead: false,
    status: online ? 'delivered' : 'sent',
    deliveredAt: online ? new Date() : null,
  });

  const populated = await message.populate([
    { path: 'senderId', select: 'fullName avatarUrl' },
    { path: 'receiverId', select: 'fullName avatarUrl' },
  ]);

  const io = req.app.get('io');
  if (io) {
    const payload = populated.toJSON();
    io.to(`profile:${receiver._id}`).emit('message:new', payload);
    io.to(`profile:${profile._id}`).emit('message:new', payload);
  }

  sendSuccess(res, { message: populated }, 'Forwarded.', 201);
});

// ── DELETE /api/v1/chat/messages/:messageId ───────────────────────────────────
/**
 * Remove a message, from your own view or from everybody's.
 *
 * `scope=everyone` is the sender's alone and blanks the content in place rather
 * than removing the row: a reply underneath still refers to something, and a
 * conversation that silently loses a message cannot be reasoned about when a job
 * is disputed. The attachments go with it, since those are the part that costs
 * storage and the part somebody most wants withdrawn.
 *
 * `scope=me` is available to either participant and only ever hides.
 */
export const deleteMessage = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id }).select('_id');
  if (!profile) throw new AppError('Profile not found.', 404);

  const message = await Message.findById(req.params.messageId);
  if (!message) throw new AppError('Message not found.', 404);

  const mine = message.senderId.toString() === profile._id.toString();
  const theirs = message.receiverId.toString() === profile._id.toString();
  if (!mine && !theirs) throw new AppError('Message not found.', 404);

  const everyone = req.query.scope === 'everyone';

  if (everyone) {
    if (!mine) throw new AppError('You can only withdraw your own messages.', 403);
    if (message.deletedForEveryone) {
      return sendSuccess(res, null, 'Message already removed.');
    }

    const age = Date.now() - new Date(message.createdAt).getTime();
    if (age > WITHDRAW_WINDOW_MS) {
      throw new AppError(
        'This message is too old to unsend. You can still delete it for yourself.',
        403
      );
    }

    /**
     * Not while the conversation is under review.
     *
     * A report exists precisely because somebody disputes what was said here, and
     * letting the reported party edit the transcript while staff are reading it
     * would make the report worthless. Deleting for yourself is still allowed —
     * that changes nobody else's copy.
     */
    const underReview = await ChatReport.exists({
      conversationId: message.conversationId,
      status: { $in: ['open', 'reviewing'] },
    });
    if (underReview) {
      throw new AppError(
        'This conversation is being reviewed, so messages cannot be unsent right now.',
        403
      );
    }

    /**
     * Only destroy assets nothing else points at.
     *
     * Forwarding copies the attachment subdocuments rather than re-uploading, so
     * one Cloudinary asset can belong to several messages. Destroying it because
     * the original was withdrawn would blank a photograph in somebody else's
     * unrelated thread — a far worse outcome than an orphaned upload.
     */
    const shared = message.attachments?.length
      ? await Message.countDocuments({
          _id: { $ne: message._id },
          deletedForEveryone: false,
          'attachments.publicId': {
            $in: message.attachments.map((a) => a.publicId).filter(Boolean),
          },
        })
      : 0;

    if (!shared) await destroyAttachments(message.attachments);

    message.content = '';
    message.media = [];
    message.attachments = [];
    message.deletedForEveryone = true;
    message.deletedAt = new Date();
    message.deletedBy = profile._id;
    await message.save();

    const io = req.app.get('io');
    if (io) {
      const payload = {
        conversationId: message.conversationId,
        messageId: message._id,
        // Named, so neither side has to guess whose deletion it was.
        deletedBy: profile._id.toString(),
      };
      io.to(`profile:${message.senderId}`).emit('message:deleted', payload);
      io.to(`profile:${message.receiverId}`).emit('message:deleted', payload);
    }

    return sendSuccess(res, null, 'Message removed for everyone.');
  }

  // Hidden for this person only. addToSet so a repeat is not an error.
  await Message.updateOne({ _id: message._id }, { $addToSet: { hiddenFor: profile._id } });
  sendSuccess(res, null, 'Message removed.');
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

  /**
   * A cleared thread starts after the line somebody drew.
   *
   * The messages are untouched for the other participant; this reader simply does not
   * see what came before they cleared it.
   */
  const state = await ConversationState.findOne({
    profileId: profile._id,
    conversationId,
  })
    .select('clearedAt')
    .lean();

  const scope = {
    conversationId,
    ...(state?.clearedAt ? { createdAt: { $gt: state.clearedAt } } : {}),
  };

  const [total, messages] = await Promise.all([
    Message.countDocuments(scope),
    Message.find(scope)
      .sort({ createdAt: -1 }) // newest first; client reverses for display
      .skip(skip)
      .limit(limit)
      .populate('senderId', 'fullName avatarUrl')
      .populate('receiverId', 'fullName avatarUrl')
      .populate({
        path: 'replyTo',
        select: 'content attachments senderId',
        populate: { path: 'senderId', select: 'fullName' },
      }),
  ]);

  /**
   * Per-viewer, because "deleted" is not a property of the message.
   *
   * A message this person deleted for themselves comes back emptied and flagged, so
   * their thread shows that they removed something rather than a gap. hiddenFor
   * itself never leaves the server: whether the other participant tidied their own
   * view is their business, and WhatsApp does not reveal it either.
   */
  const me = profile._id.toString();
  const shaped = messages.map((message) => {
    const json = message.toJSON();
    const deletedForMe = (json.hiddenFor ?? []).some((id) => String(id) === me);
    delete json.hiddenFor;

    if (!deletedForMe) return json;
    return {
      ...json,
      deletedForMe: true,
      // Their own tidying, so they are the one who did it.
      deletedBy: me,
      content: '',
      media: [],
      attachments: [],
    };
  });

  const pagination = buildPaginationMeta(total, page, limit);
  sendPaginated(res, shaped, pagination, 'Messages retrieved.');
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

  /*
   * A block stops the message, in both directions.
   *
   * Checked here rather than only in the UI, because a block that a client can
   * route around by holding a stale conversation open is not a block — and the
   * stores are asking for the guarantee, not the button.
   *
   * The refusal does not say which way it runs. "They are not accepting
   * messages" is true whichever party blocked, and telling somebody they have
   * been blocked is how a block becomes an escalation.
   */
  const blocked = await Block.exists({
    $or: [
      { blocker: senderProfile._id, blocked: receiverId },
      { blocker: receiverId, blocked: senderProfile._id },
    ],
  });
  if (blocked) {
    throw new AppError('This person is not accepting messages.', 403);
  }

  // Verify receiver exists
  const receiverProfile = await Profile.findById(receiverId);
  if (!receiverProfile) {
    throw new AppError('Recipient not found.', 404);
  }

  /**
   * A reply has to point at a message in this same conversation.
   *
   * Checked rather than trusted: a client passing any message id would otherwise
   * quote a stranger's private message into a thread it was never part of, which
   * is a disclosure bug rather than a validation nicety.
   */
  const conversationId = buildConversationId(senderProfile._id, receiverProfile._id);

  let replyTo = null;
  if (req.body.replyTo && mongoose.isValidObjectId(req.body.replyTo)) {
    const quoted = await Message.findOne({
      _id: req.body.replyTo,
      conversationId,
    }).select('_id');
    if (quoted) replyTo = quoted._id;
  }

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
    replyTo,
    isRead: false,
    status: online ? 'delivered' : 'sent',
    deliveredAt: online ? new Date() : null,
  });

  const populated = await message.populate([
    { path: 'senderId', select: 'fullName avatarUrl' },
    { path: 'receiverId', select: 'fullName avatarUrl' },
    // Enough of the quoted message to draw the strip, and nothing more: a nested
    // reply chain would grow without bound down a long thread.
    {
      path: 'replyTo',
      select: 'content attachments senderId',
      populate: { path: 'senderId', select: 'fullName' },
    },
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
      replyTo: populated.replyTo ? populated.toJSON().replyTo : null,
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

  /**
   * And a push, if their app is closed and they have not muted this thread.
   *
   * Deliberately not awaited: the sender is waiting on this response, and whether
   * somebody else's phone buzzed is not something they should wait for.
   */
  pushMessage({
    message,
    senderName: senderProfile.fullName,
    receiverProfileId: receiverProfile._id,
  }).catch(() => {});

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
