import mongoose from 'mongoose';

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
      enum: ['client', 'artisan', 'supplier'],
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
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

profileSchema.index({ role: 1 });

const Profile = mongoose.model('Profile', profileSchema);

export default Profile;
