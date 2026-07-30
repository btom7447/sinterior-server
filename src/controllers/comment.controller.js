/**
 * Comments on a pin, and reports against one.
 *
 * Split out of pin.controller.js, which had grown past the point where the pin
 * lifecycle and the conversation around a pin could be read as one file. They
 * share a subject and almost nothing else: nothing here touches media,
 * taxonomy, ranking or the upload pipeline.
 *
 * Reports live here rather than with pins because they are moderation, and
 * moderation and comments are what a human reviewing this app actually looks
 * at together.
 */
import mongoose from 'mongoose';
import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/AppError.js';
import Pin from '../models/Pin.js';
import Profile from '../models/Profile.js';
import PinComment from '../models/PinComment.js';
import CommentLike from '../models/CommentLike.js';
import PinMute from '../models/PinMute.js';
import PinReport, { REPORT_REASONS } from '../models/PinReport.js';
import { normaliseMentionIds } from '../config/comments.js';
import { getPagination, buildPaginationMeta } from '../utils/paginate.js';
import {
  notifyCommentLiked,
  notifyCommentReply,
  notifyMentioned,
  notifyPinCommented,
} from '../services/feedNotify.service.js';
import { resolveUploadUrl } from '../utils/resolveUrl.js';

const myProfile = async (userId) => {
  const profile = await Profile.findOne({ userId }).select('_id');
  if (!profile) throw new AppError('Profile not found.', 404);
  return profile;
};

// The viewer's profile when a token was sent, null when it was not. Comments
// read publicly, so every read path here has to work without one.
const viewerProfile = async (req) => {
  if (!req.user?.id) return null;
  return Profile.findOne({ userId: req.user.id }).select('_id').lean();
};

const shapeComment = (c, likedIds) => ({
  ...c,
  author: c.author ? { ...c.author, avatarUrl: resolveUploadUrl(c.author.avatarUrl) } : null,
  mentions: (c.mentions ?? []).map((m) =>
    m?.fullName ? { _id: m._id, fullName: m.fullName } : { _id: m }
  ),
  likedByMe: likedIds.has(String(c._id)),
});

/**
 * Which of these comments the viewer has already liked — one query for the
 * whole page rather than one per row.
 */
const likedSet = async (viewer, comments) => {
  if (!viewer || !comments.length) return new Set();
  const mine = await CommentLike.find({
    owner: viewer._id,
    comment: { $in: comments.map((c) => c._id) },
  })
    .select('comment')
    .lean();
  return new Set(mine.map((l) => String(l.comment)));
};

const withAuthorAndMentions = (query) =>
  query.populate('author', 'fullName avatarUrl role').populate('mentions', 'fullName');

// ── GET /pins/:id/comments ────────────────────────────────────────────────────
// Top-level only; replies are fetched per thread when one is opened. Ordered
// most-liked first, which is what makes a comment section feel curated rather
// than a log — the useful answer to "how much for this?" rises instead of being
// buried by whatever was typed last.
export const listComments = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const viewer = await viewerProfile(req);
  const newestFirst = req.query.sort === 'new';
  const filter = { pinId: req.params.id, parent: null, status: 'active' };

  const [comments, total] = await Promise.all([
    withAuthorAndMentions(
      PinComment.find(filter)
        .sort(newestFirst ? { createdAt: -1 } : { likes: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
    ).lean(),
    PinComment.countDocuments(filter),
  ]);

  const liked = await likedSet(viewer, comments);

  res.status(200).json({
    success: true,
    data: { comments: comments.map((c) => shapeComment(c, liked)) },
    pagination: buildPaginationMeta(total, page, limit),
  });
});

// ── GET /pins/comments/:commentId/replies ─────────────────────────────────────
// Oldest first: a thread is a conversation and should read downward.
export const listReplies = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const viewer = await viewerProfile(req);
  const filter = { parent: req.params.commentId, status: 'active' };

  const [replies, total] = await Promise.all([
    withAuthorAndMentions(
      PinComment.find(filter).sort({ createdAt: 1 }).skip(skip).limit(limit)
    ).lean(),
    PinComment.countDocuments(filter),
  ]);

  const liked = await likedSet(viewer, replies);

  res.status(200).json({
    success: true,
    data: { replies: replies.map((c) => shapeComment(c, liked)) },
    pagination: buildPaginationMeta(total, page, limit),
  });
});

// ── POST /pins/:id/comments ───────────────────────────────────────────────────
export const addComment = asyncHandler(async (req, res) => {
  const profile = await myProfile(req.user.id);
  const pin = await Pin.findById(req.params.id).select('_id status author title');
  if (!pin || pin.status !== 'active') throw new AppError('Pin not found.', 404);

  const body = String(req.body.body ?? '').trim();
  if (!body) throw new AppError('Write something first.', 400);

  // Replying to a reply attaches to the same top-level parent rather than
  // nesting deeper, so a thread can never grow an indent the phone cannot hold.
  let parent = null;
  if (req.body.parentId) {
    const target = await PinComment.findById(req.body.parentId).select('pinId parent status author');
    if (!target || target.status === 'removed' || String(target.pinId) !== String(pin._id)) {
      throw new AppError('That comment is no longer here.', 404);
    }
    parent = target.parent
      ? await PinComment.findById(target.parent).select('_id author status')
      : target;
    if (!parent || parent.status === 'removed') {
      throw new AppError('That comment is no longer here.', 404);
    }
  }

  const mentions = await resolveMentions(req.body.mentions);

  const created = await PinComment.create({
    pinId: pin._id,
    author: profile._id,
    body,
    parent: parent?._id ?? null,
    mentions,
  });

  // Replies count toward the pin's total: the number under the bubble is how
  // much conversation there is, not how many roots it happens to have.
  await Pin.updateOne({ _id: pin._id }, { $inc: { 'counters.comments': 1 } });
  if (parent) await PinComment.updateOne({ _id: parent._id }, { $inc: { replyCount: 1 } });

  const actor = await Profile.findById(profile._id).select('_id fullName').lean();
  if (parent) {
    await notifyCommentReply(req, { actor, pin, parentAuthorId: parent.author, comment: body });
  } else {
    await notifyPinCommented(req, { actor, pin, comment: body });
  }
  // Last, and skipping anyone the lines above already reached, so one sentence
  // is at most one buzz.
  await notifyMentioned(req, {
    actor,
    pin,
    mentionedIds: mentions,
    comment: body,
    skipIds: [parent ? parent.author : pin.author],
  });

  const comment = await withAuthorAndMentions(PinComment.findById(created._id)).lean();
  const shaped = shapeComment(comment, new Set());

  // Sent whole, so a reader with the sheet open can insert the row without a
  // round trip to find out what was said.
  emitToPin(req, pin._id, 'comment:new', {
    pinId: String(pin._id),
    parentId: parent ? String(parent._id) : null,
    comment: shaped,
  });

  res.status(201).json({
    success: true,
    data: { comment: shaped },
    message: parent ? 'Reply posted.' : 'Comment posted.',
  });
});

/**
 * Mentions arrive as profile ids the composer picked from its own suggestions.
 * They are re-checked here because the client choosing who to notify is exactly
 * the kind of thing that gets abused: unknown ids are dropped, duplicates
 * collapse, and the list is capped.
 */
async function resolveMentions(raw) {
  const ids = normaliseMentionIds(raw, (id) => mongoose.isValidObjectId(id));
  if (!ids.length) return [];

  const found = await Profile.find({ _id: { $in: ids } }).select('_id').lean();
  return found.map((p) => p._id);
}

/**
 * Tell everybody looking at this pin what just happened to its comments.
 *
 * A room per pin, joined by clients with the sheet open. Notifications already
 * reach the pin's author, but the author is not the only person reading — a
 * thread under a popular pin is a conversation, and a conversation where you
 * have to pull down to refresh is not one.
 *
 * Never throws into the request: a comment that saved and failed to broadcast is
 * a comment, and the next fetch will show it anyway.
 */
function emitToPin(req, pinId, event, payload) {
  try {
    const io = req.app.get('io');
    if (io && pinId) io.to(`pin:${String(pinId)}`).emit(event, payload);
  } catch {
    /* a missed broadcast is cosmetic */
  }
}

// ── POST /pins/comments/:commentId/like ───────────────────────────────────────
export const likeComment = asyncHandler(async (req, res) => {
  const profile = await myProfile(req.user.id);
  const comment = await PinComment.findById(req.params.commentId).select('_id author body status pinId');
  if (!comment || comment.status === 'removed') throw new AppError('Comment not found.', 404);

  // Same shape as likePin: find, then create only on the transition, so the
  // counter moves once and the author is pinged once. An upsert cannot be used
  // here — there is no version-stable way to ask one whether it inserted, and
  // guessing wrong makes every repeat tap count again.
  const existing = await CommentLike.findOne({ comment: comment._id, owner: profile._id });
  if (!existing) {
    try {
      await CommentLike.create({ comment: comment._id, owner: profile._id });
      await PinComment.updateOne({ _id: comment._id }, { $inc: { likes: 1 } });

      const actor = await Profile.findById(profile._id).select('_id fullName').lean();
      await notifyCommentLiked(req, {
        actor,
        pin: { _id: comment.pinId },
        commentAuthorId: comment.author,
        comment: comment.body,
      });
    } catch (err) {
      // Two taps landing at once: the unique index rejects the second, which
      // means the like already exists and there is nothing left to do.
      if (err.code !== 11000) throw err;
    }
  }

  const fresh = await PinComment.findById(comment._id).select('likes').lean();
  emitToPin(req, comment.pinId, 'comment:likes', {
    pinId: String(comment.pinId),
    commentId: String(comment._id),
    likes: fresh?.likes ?? 0,
  });
  res.status(200).json({ success: true, data: { likedByMe: true, likes: fresh?.likes ?? 0 } });
});

// ── DELETE /pins/comments/:commentId/like ─────────────────────────────────────
export const unlikeComment = asyncHandler(async (req, res) => {
  const profile = await myProfile(req.user.id);
  const removed = await CommentLike.findOneAndDelete({
    comment: req.params.commentId,
    owner: profile._id,
  });

  if (removed) {
    await PinComment.updateOne(
      { _id: req.params.commentId, likes: { $gt: 0 } },
      { $inc: { likes: -1 } }
    );
  }

  const fresh = await PinComment.findById(req.params.commentId).select('likes pinId').lean();
  emitToPin(req, fresh?.pinId, 'comment:likes', {
    pinId: String(fresh?.pinId ?? ''),
    commentId: String(req.params.commentId),
    likes: fresh?.likes ?? 0,
  });
  res.status(200).json({ success: true, data: { likedByMe: false, likes: fresh?.likes ?? 0 } });
});

// ── DELETE /pins/comments/:commentId ──────────────────────────────────────────
// The comment's author, the pin's author, or an admin. A pin owner needs to be
// able to clear their own wall without waiting on moderation.
export const deleteComment = asyncHandler(async (req, res) => {
  const comment = await PinComment.findById(req.params.commentId);
  if (!comment || comment.status === 'removed') throw new AppError('Comment not found.', 404);

  const profile = await Profile.findOne({ userId: req.user.id }).select('_id');
  const pin = await Pin.findById(comment.pinId).select('author');
  const mine = profile && comment.author.toString() === profile._id.toString();
  const myPin = profile && pin && pin.author.toString() === profile._id.toString();
  if (!mine && !myPin && req.user.role !== 'admin') {
    throw new AppError('You cannot remove this comment.', 403);
  }

  comment.status = 'removed';
  await comment.save();

  // Removing a top-level comment takes its replies with it. Leaving them would
  // strand answers under a question nobody can read any more, and on a
  // marketplace an orphaned "no, he never showed up" is worse than no thread.
  let removedCount = 1;
  if (!comment.parent) {
    const replies = await PinComment.updateMany(
      { parent: comment._id, status: 'active' },
      { $set: { status: 'removed' } }
    );
    removedCount += replies.modifiedCount ?? 0;
    await PinComment.updateOne({ _id: comment._id }, { $set: { replyCount: 0 } });
  } else {
    await PinComment.updateOne(
      { _id: comment.parent, replyCount: { $gt: 0 } },
      { $inc: { replyCount: -1 } }
    );
  }

  await Pin.updateOne(
    { _id: comment.pinId, 'counters.comments': { $gte: removedCount } },
    { $inc: { 'counters.comments': -removedCount } }
  );

  emitToPin(req, comment.pinId, 'comment:removed', {
    pinId: String(comment.pinId),
    commentId: String(comment._id),
    parentId: comment.parent ? String(comment.parent) : null,
    // How far the pin's own counter moved, so a reader's header can follow it
    // without refetching the pin.
    removedCount,
  });

  res.status(200).json({ success: true, data: null, message: 'Comment removed.' });
});

// ── POST /pins/:id/report ─────────────────────────────────────────────────────
// Filed, not enforced. Auto-hiding on a report count would hand anyone with
// three accounts the power to take down a competitor's work, which on a
// marketplace is a business weapon rather than a moderation tool.
export const reportPin = asyncHandler(async (req, res) => {
  const profile = await myProfile(req.user.id);
  const pin = await Pin.findById(req.params.id).select('_id status taxonomy.trade');
  if (!pin || pin.status === 'deleted') throw new AppError('Pin not found.', 404);

  const reason = String(req.body.reason ?? '').trim();
  if (!REPORT_REASONS.includes(reason)) throw new AppError('Pick a reason.', 400);

  const note = String(req.body.note ?? '').trim().slice(0, 500);

  // Reporting twice is not twice the signal, and the second attempt should read
  // as done rather than as a failure.
  await PinReport.updateOne(
    { pinId: pin._id, reporter: profile._id },
    { $setOnInsert: { pinId: pin._id, reporter: profile._id, reason, note, status: 'open' } },
    { upsert: true }
  );

  // Reporting implies not wanting to see it again — doing that in one step
  // spares the reporter having to also find "see fewer like this".
  await PinMute.updateOne(
    { pinId: pin._id, owner: profile._id },
    { $setOnInsert: { pinId: pin._id, owner: profile._id, trade: pin.taxonomy?.trade ?? null } },
    { upsert: true }
  );

  res.status(201).json({
    success: true,
    data: null,
    message: 'Thanks — our team will take a look.',
  });
});

