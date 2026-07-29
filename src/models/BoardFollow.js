import mongoose from 'mongoose';

// A profile subscribing to a board. Separate from Follow (profile → profile)
// because the two answer different questions: following a person says "show me
// what they make", following a board says "show me what they collect", and a
// good curator is rarely the same account as a good maker.
//
// Counts are computed with countDocuments on the indexed pairs, matching the
// Follow model's decision not to keep denormalized counters that can drift.
const boardFollowSchema = new mongoose.Schema(
  {
    follower: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile', required: true },
    board: { type: mongoose.Schema.Types.ObjectId, ref: 'Board', required: true },
  },
  { timestamps: true }
);

boardFollowSchema.index({ follower: 1, board: 1 }, { unique: true });
boardFollowSchema.index({ board: 1, createdAt: -1 });

const BoardFollow = mongoose.model('BoardFollow', boardFollowSchema);
export default BoardFollow;
