import mongoose from 'mongoose';

// follower subscribes to followed's pins (both are Profiles). Follower counts
// are computed with countDocuments on the indexed pairs — no denormalized
// counters to drift.
const followSchema = new mongoose.Schema(
  {
    follower: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Profile',
      required: true,
    },
    followed: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Profile',
      required: true,
    },
  },
  { timestamps: true }
);

followSchema.index({ follower: 1, followed: 1 }, { unique: true });
followSchema.index({ followed: 1, createdAt: -1 });

const Follow = mongoose.model('Follow', followSchema);
export default Follow;
