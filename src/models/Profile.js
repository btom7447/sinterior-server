import mongoose from 'mongoose';
import { resolveUploadUrl } from '../utils/resolveUrl.js';

const profileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'userId is required'],
      unique: true,
    },
    fullName: {
      type: String,
      trim: true,
      maxlength: [120, 'Full name cannot exceed 120 characters'],
    },
    phone: {
      type: String,
      trim: true,
      maxlength: [20, 'Phone number cannot exceed 20 characters'],
    },
    avatarUrl: {
      type: String,
      trim: true,
    },
    city: {
      type: String,
      trim: true,
      maxlength: [80, 'City name cannot exceed 80 characters'],
    },
    state: {
      type: String,
      trim: true,
      maxlength: [80, 'State name cannot exceed 80 characters'],
    },
    bio: {
      type: String,
      trim: true,
      maxlength: [500, 'Bio cannot exceed 500 characters'],
    },
    // Mirrors the role on User so profiles can be queried without a join
    role: {
      type: String,
      enum: ['client', 'artisan', 'supplier', 'admin'],
      default: 'client',
    },
    settings: {
      notifications: { type: Boolean, default: true },
      darkMode: { type: Boolean, default: false },
      autoRenew: { type: Boolean, default: true },
      landRegistry: { type: Boolean, default: true },
      landInsurance: { type: Boolean, default: true },
      fireAlarm: { type: Boolean, default: false },
    },

    // Admin moderation. Suspended sellers can't accept new orders/jobs but
    // existing in-progress work continues to completion.
    isSuspended: { type: Boolean, default: false },
    suspensionReason: { type: String, trim: true, maxlength: 500 },
    suspendedAt: { type: Date },
    suspendedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform(_doc, ret) {
        if (ret.avatarUrl) ret.avatarUrl = resolveUploadUrl(ret.avatarUrl);
        return ret;
      },
    },
    toObject: {
      transform(_doc, ret) {
        if (ret.avatarUrl) ret.avatarUrl = resolveUploadUrl(ret.avatarUrl);
        return ret;
      },
    },
  }
);

profileSchema.index({ role: 1 });

const Profile = mongoose.model('Profile', profileSchema);

export default Profile;
