import mongoose from 'mongoose';

// A comment on a pin. On a marketplace this is where a job starts ("how much
// for this?"), so comments are kept flat and public rather than threaded.
//
// Removal is a status change, not a delete: moderation needs to be able to see
// what was said, and Pin.counters.comments counts only what is visible.
const pinCommentSchema = new mongoose.Schema(
  {
    pinId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pin', required: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile', required: true },
    body: { type: String, required: true, trim: true, maxlength: 1000 },
    status: { type: String, enum: ['active', 'removed'], default: 'active' },
  },
  { timestamps: true }
);

pinCommentSchema.index({ pinId: 1, status: 1, createdAt: -1 });
pinCommentSchema.index({ author: 1, createdAt: -1 });

const PinComment = mongoose.model('PinComment', pinCommentSchema);
export default PinComment;
