import mongoose from 'mongoose';

// "See fewer like this", recorded server-side.
//
// It lived only on the device before, which made it a lie in two directions:
// the pin came back on a second phone, and the ranking never learned anything
// from the strongest negative signal a user can give.
//
// The trade is copied in at mute time rather than joined later, because a pin's
// trade can be edited afterwards and this is a record of what the person was
// reacting to, not of what the pin says today.
const pinMuteSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile', required: true },
    pinId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pin', required: true },
    trade: { type: String, default: null },
  },
  { timestamps: true }
);

pinMuteSchema.index({ owner: 1, pinId: 1 }, { unique: true });
pinMuteSchema.index({ owner: 1, createdAt: -1 });

const PinMute = mongoose.model('PinMute', pinMuteSchema);
export default PinMute;
