import mongoose from 'mongoose';

// A like on a comment. The unique index makes it idempotent, and this stays the
// record of who liked what; PinComment.likes carries the count, because the
// default comment order is most-liked-first and that sort cannot run over a
// collection it would have to count per row.
const commentLikeSchema = new mongoose.Schema(
  {
    comment: { type: mongoose.Schema.Types.ObjectId, ref: 'PinComment', required: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile', required: true },
  },
  { timestamps: true }
);

commentLikeSchema.index({ comment: 1, owner: 1 }, { unique: true });
commentLikeSchema.index({ comment: 1 });

const CommentLike = mongoose.model('CommentLike', commentLikeSchema);
export default CommentLike;
