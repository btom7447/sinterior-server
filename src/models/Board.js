import mongoose from 'mongoose';

// A user's named collection of saved pins ("My Kitchen Project").
// Membership lives in BoardPin (join collection) — not an embedded array —
// so boards scale and saves stay O(1) writes.
const boardSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Profile',
      required: [true, 'owner is required'],
    },
    name: {
      type: String,
      required: [true, 'Board name is required'],
      trim: true,
      maxlength: [80, 'Board name cannot exceed 80 characters'],
    },
    description: { type: String, trim: true, maxlength: 300 },
    // Privacy is enforced server-side on every read path (docs/security.md).
    isPrivate: { type: Boolean, default: false },
    /**
     * Where the owner has dragged this board. Boards with no order fall back to
     * most-recently-touched, so an account that has never reordered anything
     * behaves exactly as it did before this existed.
     */
    order: { type: Number, default: null },
    // Denormalized for board cards: newest saved pin's media.
    coverUrl: { type: String, trim: true },
    pinCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

boardSchema.index({ owner: 1, updatedAt: -1 });
// One board name per owner keeps the picker unambiguous.
boardSchema.index({ owner: 1, name: 1 }, { unique: true });

const Board = mongoose.model('Board', boardSchema);
export default Board;
