import mongoose from 'mongoose';

// Join collection: a pin saved to a board. The unique index makes saves
// idempotent; Pin.counters.saves and Board.pinCount are maintained by the
// board controller alongside these writes.
const boardPinSchema = new mongoose.Schema(
  {
    boardId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Board',
      required: true,
    },
    pinId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Pin',
      required: true,
    },
    // Denormalized owner so "has this user saved this pin?" and affinity
    // queries skip a Board join.
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Profile',
      required: true,
    },
    /**
     * Set when the owner pins this to the top of their saved grid. Null for
     * everything else, which is almost all of it — a sparse marker rather than
     * a position, so pinning one thing never renumbers the rest.
     */
    pinnedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

boardPinSchema.index({ boardId: 1, pinId: 1 }, { unique: true });
boardPinSchema.index({ owner: 1, pinId: 1 });
boardPinSchema.index({ boardId: 1, createdAt: -1 });

const BoardPin = mongoose.model('BoardPin', boardPinSchema);
export default BoardPin;
