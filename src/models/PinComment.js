import mongoose from 'mongoose';

// A comment on a pin. On a marketplace this is where a job starts ("how much
// for this?"), so the thread under a pin is worth as much as the pin.
//
// Threading is exactly one level deep. A reply to a reply attaches to the same
// top-level parent and addresses the person by mention instead of nesting
// further — the same shape TikTok and Instagram use. Arbitrary depth reads
// badly on a phone at any width, and on a 360dp Android screen a third
// indent leaves about nine characters per line.
//
// Removal is a status change, not a delete: moderation needs to be able to see
// what was said, and Pin.counters.comments counts only what is visible.
const pinCommentSchema = new mongoose.Schema(
  {
    pinId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pin', required: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile', required: true },
    body: { type: String, required: true, trim: true, maxlength: 1000 },

    // null for a top-level comment; otherwise the comment this one sits under.
    parent: { type: mongoose.Schema.Types.ObjectId, ref: 'PinComment', default: null },

    // Profiles named with @ in the body. Stored resolved so a rename does not
    // silently break the link, and so notifying does not mean re-parsing text.
    mentions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Profile' }],

    // Denormalised counters, mirroring how Pin keeps its own. Both are needed
    // for sorting and for rendering "N replies" without a query per row;
    // CommentLike stays the source of truth for who liked what.
    likes: { type: Number, default: 0, min: 0 },
    replyCount: { type: Number, default: 0, min: 0 },

    status: { type: String, enum: ['active', 'removed'], default: 'active' },
  },
  { timestamps: true }
);

// The default listing: top-level comments under a pin, most-liked first.
pinCommentSchema.index({ pinId: 1, parent: 1, status: 1, likes: -1, createdAt: -1 });
// Replies under one parent, oldest first — a thread reads as a conversation.
pinCommentSchema.index({ parent: 1, status: 1, createdAt: 1 });
pinCommentSchema.index({ author: 1, createdAt: -1 });

const PinComment = mongoose.model('PinComment', pinCommentSchema);
export default PinComment;
