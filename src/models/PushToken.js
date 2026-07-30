import mongoose from 'mongoose';

/**
 * Where to reach somebody when the app is closed.
 *
 * One row per device rather than per account: an artisan with a phone and a
 * tablet wants the job on both, and somebody who signs out of one must not stop
 * being reachable on the other.
 *
 * Keyed on the token itself, because that is what the push service issues and
 * what it later tells us has expired. Tokens also migrate between accounts — a
 * shared phone, a reinstall — so the row is re-pointed at whoever registered it
 * last rather than duplicated.
 */
const pushTokenSchema = new mongoose.Schema(
  {
    /** Expo push token, e.g. ExponentPushToken[xxxxxxxx]. */
    token: { type: String, required: true, unique: true, trim: true },

    /** Notifications are addressed to a user; profiles are the social identity. */
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    profileId: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile', default: null },

    platform: { type: String, enum: ['ios', 'android', 'web'], default: null },
    /**
     * Stable per install. Used to clear a token that a reinstall replaced,
     * since the old one keeps working for a while and would double-deliver.
     */
    deviceId: { type: String, default: null },

    /**
     * Last time the device said hello. A token nobody has re-registered in
     * months is a phone that has been thrown away, and sending to it costs a
     * request and a receipt every time.
     */
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

pushTokenSchema.index({ userId: 1 });
pushTokenSchema.index({ deviceId: 1 });

const PushToken = mongoose.model('PushToken', pushTokenSchema);
export default PushToken;
