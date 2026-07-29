import mongoose from 'mongoose';

// A like on a board.
//
// Distinct from BoardFollow on purpose: following says "keep showing me what
// this person collects", liking says "this particular collection is good". The
// first is a subscription and changes someone's feed; the second is a signal
// and changes what gets featured. Conflating them would mean a user cannot
// applaud a board without committing to it.
const boardLikeSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile', required: true },
    board: { type: mongoose.Schema.Types.ObjectId, ref: 'Board', required: true },
  },
  { timestamps: true }
);

boardLikeSchema.index({ owner: 1, board: 1 }, { unique: true });
boardLikeSchema.index({ board: 1, createdAt: -1 });

const BoardLike = mongoose.model('BoardLike', boardLikeSchema);
export default BoardLike;
