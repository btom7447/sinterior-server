import crypto from 'crypto';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Profile from '../models/Profile.js';
import ArtisanProfile from '../models/ArtisanProfile.js';
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import {
  generateAccessToken,
  generateRefreshToken,
  setRefreshCookie,
  clearRefreshCookie,
} from '../utils/generateTokens.js';
import config from '../config/env.js';
import { resolveUploadUrl } from '../utils/resolveUrl.js';
import { sendEmail } from '../utils/sendEmail.js';

// ── Helper: generate verification token, save to user, send email ────────────
const sendVerificationEmail = async (user) => {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

  user.emailVerificationToken = hashedToken;
  user.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  await user.save({ validateBeforeSave: false });

  const verifyUrl = `${config.CLIENT_URL}/verify-email?token=${rawToken}`;

  await sendEmail({
    to: user.email,
    subject: 'Verify your Sintherior account',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #1a1a1a;">Welcome to Sintherior</h2>
        <p>Please verify your email address to get started.</p>
        <p>Click the button below to verify. This link expires in 24 hours.</p>
        <a href="${verifyUrl}" style="display: inline-block; padding: 12px 24px; background: #1a1a1a; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600; margin: 16px 0;">
          Verify Email
        </a>
        <p style="color: #666; font-size: 13px;">If you didn't create a Sintherior account, you can safely ignore this email.</p>
      </div>
    `,
  });

  return rawToken;
};

// ── Helper: build the safe user payload returned to the client ────────────────
const buildUserPayload = (user, profile) => ({
  id: user._id,
  email: user.email,
  role: user.role,
  isEmailVerified: user.isEmailVerified,
  profile: profile
    ? {
        id: profile._id,
        fullName: profile.fullName,
        avatarUrl: resolveUploadUrl(profile.avatarUrl),
        phone: profile.phone || null,
        bio: profile.bio || null,
        city: profile.city,
        state: profile.state,
      }
    : null,
});

// ── POST /api/v1/auth/register ────────────────────────────────────────────────
export const register = asyncHandler(async (req, res) => {
  const { email, password, role = 'client', fullName, city, state } = req.body;

  // Check for duplicate email before starting transaction
  const existing = await User.findOne({ email: email.toLowerCase().trim() });
  if (existing) {
    throw new AppError('An account with this email already exists.', 409);
  }

  // Use a session so User + Profile are created atomically
  const session = await mongoose.startSession();
  session.startTransaction();

  let user;
  let profile;

  try {
    // Create user — passwordHash pre-save hook will hash the plain text
    [user] = await User.create(
      [
        {
          email,
          passwordHash: password, // hashed by pre-save hook
          role,
        },
      ],
      { session }
    );

    // Create matching profile
    [profile] = await Profile.create(
      [
        {
          userId: user._id,
          fullName: fullName || '',
          city: city || '',
          state: state || '',
          role,
        },
      ],
      { session }
    );

    // If role is artisan, scaffold an empty artisan profile so it's ready for onboarding
    if (role === 'artisan') {
      await ArtisanProfile.create(
        [
          {
            profileId: profile._id,
            skill: 'General', // placeholder — updated during onboarding
          },
        ],
        { session }
      );
    }

    await session.commitTransaction();
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }

  // Generate tokens
  const tokenPayload = { id: user._id.toString(), role: user.role };
  const accessToken = generateAccessToken(tokenPayload);
  const refreshToken = generateRefreshToken(tokenPayload);

  // Store hashed refresh token on user record
  user.refreshTokenHash = await bcrypt.hash(refreshToken, 10);
  user.lastLogin = new Date();
  await user.save({ validateBeforeSave: false });

  setRefreshCookie(res, refreshToken);

  // Send verification email (non-blocking — don't fail registration if email fails)
  sendVerificationEmail(user).catch((err) => {
    console.error('[AUTH] Failed to send verification email:', err.message);
  });

  sendSuccess(
    res,
    { accessToken, user: buildUserPayload(user, profile) },
    'Registration successful. Please check your email to verify your account.',
    201
  );
});

// ── POST /api/v1/auth/login ───────────────────────────────────────────────────
export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  // findByEmail selects passwordHash too
  const user = await User.findByEmail(email);
  if (!user) {
    throw new AppError('Invalid email or password.', 401);
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    throw new AppError('Invalid email or password.', 401);
  }

  // Fetch associated profile
  const profile = await Profile.findOne({ userId: user._id });

  // Generate tokens
  const tokenPayload = { id: user._id.toString(), role: user.role };
  const accessToken = generateAccessToken(tokenPayload);
  const refreshToken = generateRefreshToken(tokenPayload);

  // Update last login and store hashed refresh token
  user.lastLogin = new Date();
  user.refreshTokenHash = await bcrypt.hash(refreshToken, 10);
  await user.save({ validateBeforeSave: false });

  setRefreshCookie(res, refreshToken);

  sendSuccess(res, { accessToken, user: buildUserPayload(user, profile) }, 'Login successful.');
});

// ── POST /api/v1/auth/refresh ─────────────────────────────────────────────────
export const refresh = asyncHandler(async (req, res) => {
  const token = req.cookies?.refreshToken;

  if (!token) {
    throw new AppError('Refresh token not found. Please log in.', 401);
  }

  // Verify signature — throws JsonWebTokenError or TokenExpiredError
  let decoded;
  try {
    decoded = jwt.verify(token, config.JWT_REFRESH_SECRET);
  } catch {
    throw new AppError('Invalid or expired refresh token. Please log in again.', 401);
  }

  // Fetch user with refreshTokenHash
  const user = await User.findById(decoded.id).select('+refreshTokenHash');
  if (!user || !user.refreshTokenHash) {
    throw new AppError('Session not found. Please log in again.', 401);
  }

  // Verify the incoming token matches what we stored
  const isValid = await bcrypt.compare(token, user.refreshTokenHash);
  if (!isValid) {
    throw new AppError('Refresh token is no longer valid. Please log in again.', 401);
  }

  // Issue a fresh access token
  const accessToken = generateAccessToken({ id: user._id.toString(), role: user.role });

  sendSuccess(res, { accessToken }, 'Access token refreshed.');
});

// ── POST /api/v1/auth/logout ──────────────────────────────────────────────────
// Does NOT use protect — must work even when the access token has already expired
export const logout = asyncHandler(async (req, res) => {
  const token = req.cookies?.refreshToken;

  if (token) {
    try {
      // Decode refresh token to find the user and invalidate their stored hash
      const decoded = jwt.verify(token, config.JWT_REFRESH_SECRET);
      await User.findByIdAndUpdate(decoded.id, { $unset: { refreshTokenHash: '' } });
    } catch {
      // Refresh token invalid or expired — nothing to invalidate, still clear cookie
    }
  }

  clearRefreshCookie(res);
  sendSuccess(res, null, 'Logged out successfully.');
});

// ── GET /api/v1/auth/me ───────────────────────────────────────────────────────
export const me = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) {
    throw new AppError('User not found.', 404);
  }

  const profile = await Profile.findOne({ userId: user._id });

  sendSuccess(res, { user: buildUserPayload(user, profile) }, 'Current user retrieved.');
});

// ── POST /api/v1/auth/forgot-password ─────────────────────────────────────────
export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  const user = await User.findOne({ email: email.toLowerCase().trim() });

  // Always respond with 200 to prevent email enumeration
  if (!user) {
    return sendSuccess(res, null, 'If that email exists, a reset link has been sent.');
  }

  // Generate a random 32-byte token and store its SHA-256 hash
  const rawToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

  user.resetPasswordToken = hashedToken;
  user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  await user.save({ validateBeforeSave: false });

  // In production this would send an email. In development, return the token directly.
  const resetUrl = `${config.CLIENT_URL}/reset-password?token=${rawToken}`;

  if (config.NODE_ENV === 'development') {
    return sendSuccess(
      res,
      { resetUrl, token: rawToken },
      'Reset token generated (development only — do not expose in production).'
    );
  }

  // Send password reset email via Resend
  await sendEmail({
    to: user.email,
    subject: 'Reset your Sintherior password',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #1a1a1a;">Password Reset</h2>
        <p>You requested a password reset for your Sintherior account.</p>
        <p>Click the button below to set a new password. This link expires in 1 hour.</p>
        <a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background: #1a1a1a; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600; margin: 16px 0;">
          Reset Password
        </a>
        <p style="color: #666; font-size: 13px;">If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  });

  sendSuccess(res, null, 'If that email exists, a reset link has been sent.');
});

// ── POST /api/v1/auth/reset-password/:token ────────────────────────────────────
export const resetPassword = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const { password } = req.body;

  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  const user = await User.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordExpires: { $gt: Date.now() },
  }).select('+resetPasswordToken +resetPasswordExpires');

  if (!user) {
    throw new AppError('Reset token is invalid or has expired.', 400);
  }

  user.passwordHash = password; // pre-save hook will hash it
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;
  user.refreshTokenHash = undefined; // invalidate existing sessions
  await user.save();

  clearRefreshCookie(res);
  sendSuccess(res, null, 'Password has been reset. Please log in with your new password.');
});

// ── POST /api/v1/auth/change-password ─────────────────────────────────────────
export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  const user = await User.findById(req.user.id).select('+passwordHash');
  if (!user) throw new AppError('User not found.', 404);

  const isMatch = await user.comparePassword(currentPassword);
  if (!isMatch) throw new AppError('Current password is incorrect.', 401);

  user.passwordHash = newPassword; // pre-save hook hashes it
  user.refreshTokenHash = undefined; // invalidate all other sessions
  await user.save();

  // Reissue tokens so the current session stays valid
  const tokenPayload = { id: user._id.toString(), role: user.role };
  const accessToken = generateAccessToken(tokenPayload);
  const refreshToken = generateRefreshToken(tokenPayload);
  user.refreshTokenHash = await bcrypt.hash(refreshToken, 10);
  await user.save({ validateBeforeSave: false });
  setRefreshCookie(res, refreshToken);

  sendSuccess(res, { accessToken }, 'Password changed successfully.');
});

// ── POST /api/v1/auth/send-verification ──────────────────────────────────────
export const sendVerification = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) throw new AppError('User not found.', 404);

  if (user.isEmailVerified) {
    return sendSuccess(res, null, 'Email is already verified.');
  }

  if (config.NODE_ENV === 'development') {
    const rawToken = await sendVerificationEmail(user);
    return sendSuccess(
      res,
      { verifyUrl: `${config.CLIENT_URL}/verify-email?token=${rawToken}`, token: rawToken },
      'Verification email sent (dev — token returned for convenience).'
    );
  }

  await sendVerificationEmail(user);
  sendSuccess(res, null, 'Verification email sent. Please check your inbox.');
});

// ── GET /api/v1/auth/verify-email/:token ─────────────────────────────────────
export const verifyEmail = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  const user = await User.findOne({
    emailVerificationToken: hashedToken,
    emailVerificationExpires: { $gt: Date.now() },
  }).select('+emailVerificationToken +emailVerificationExpires');

  if (!user) {
    throw new AppError('Verification link is invalid or has expired.', 400);
  }

  user.isEmailVerified = true;
  user.emailVerificationToken = undefined;
  user.emailVerificationExpires = undefined;
  await user.save({ validateBeforeSave: false });

  // Redirect to frontend with success flag
  res.redirect(`${config.CLIENT_URL}/verify-email?verified=true`);
});
