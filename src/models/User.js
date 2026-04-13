import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const BCRYPT_ROUNDS = 12;

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address'],
    },
    passwordHash: {
      type: String,
      required: [true, 'Password is required'],
      select: false, // never returned in queries by default
      minlength: [8, 'Password must be at least 8 characters'],
    },
    role: {
      type: String,
      enum: {
        values: ['client', 'artisan', 'supplier', 'admin'],
        message: "Role must be one of: 'client', 'artisan', 'supplier', 'admin'",
      },
      default: 'client',
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    emailVerificationToken: {
      type: String,
      select: false,
    },
    emailVerificationExpires: {
      type: Date,
      select: false,
    },
    // Hashed refresh token — raw token never stored
    refreshTokenHash: {
      type: String,
      select: false,
    },
    // Password reset — token is hashed before storage; expires after 1 hour
    resetPasswordToken: {
      type: String,
      select: false,
    },
    resetPasswordExpires: {
      type: Date,
      select: false,
    },
    lastLogin: {
      type: Date,
    },
    isBanned: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    // Remove __v from JSON responses
    versionKey: false,
  }
);

// ── Pre-save hook: hash plain-text password before persisting ─────────────────
userSchema.pre('save', async function (next) {
  // Only re-hash if the passwordHash field was actually modified
  if (!this.isModified('passwordHash')) return next();

  try {
    this.passwordHash = await bcrypt.hash(this.passwordHash, BCRYPT_ROUNDS);
    next();
  } catch (err) {
    next(err);
  }
});

// ── Instance method: compare a candidate password against the stored hash ─────
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.passwordHash);
};

// ── Static method: find user by email, selecting passwordHash ─────────────────
userSchema.statics.findByEmail = function (email) {
  return this.findOne({ email: email.toLowerCase().trim() }).select('+passwordHash');
};

const User = mongoose.model('User', userSchema);

export default User;
