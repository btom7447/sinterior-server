import mongoose from 'mongoose';

// A like on a pin. Separate from BoardPin because saving and liking answer
// different questions: a save is "I want this later", a like is "this is good".
// The unique index makes liking idempotent; Pin.counters.likes is maintained by
// the pin controller alongside these writes.
const pinLikeSchema = new mongoose.Schema(
  {
    pinId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pin', required: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile', required: true },
  },
  { timestamps: true }
);

pinLikeSchema.index({ pinId: 1, owner: 1 }, { unique: true });
pinLikeSchema.index({ owner: 1, createdAt: -1 });

const PinLike = mongoose.model('PinLike', pinLikeSchema);
export default PinLike;
