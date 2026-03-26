import path from 'path';
import { fileURLToPath } from 'url';
import Profile from '../models/Profile.js';
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import config from '../config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── GET /api/v1/profiles/me ───────────────────────────────────────────────────
export const getMe = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id }).populate(
    'userId',
    'email role isEmailVerified lastLogin createdAt'
  );

  if (!profile) {
    throw new AppError('Profile not found for this user.', 404);
  }

  sendSuccess(res, { profile }, 'Profile retrieved.');
});

// ── PATCH /api/v1/profiles/me ─────────────────────────────────────────────────
export const updateMe = asyncHandler(async (req, res) => {
  // Whitelist of fields the user may update via this endpoint
  const ALLOWED = ['fullName', 'phone', 'city', 'state', 'bio'];

  const updates = {};
  ALLOWED.forEach((field) => {
    if (req.body[field] !== undefined) {
      updates[field] = req.body[field];
    }
  });

  if (Object.keys(updates).length === 0) {
    throw new AppError('No valid fields provided for update.', 400);
  }

  const profile = await Profile.findOneAndUpdate(
    { userId: req.user.id },
    { $set: updates },
    { new: true, runValidators: true }
  );

  if (!profile) {
    throw new AppError('Profile not found.', 404);
  }

  sendSuccess(res, { profile }, 'Profile updated.');
});

// ── POST /api/v1/profiles/me/avatar ───────────────────────────────────────────
// Requires: uploadSingle('avatar') + resizeImage(400, 400) middleware upstream
export const uploadAvatar = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError('No file uploaded. Please attach an image.', 400);
  }

  // Build the public URL path for the stored file
  const avatarUrl = `/${config.UPLOAD_DIR}/${req.file.filename}`;

  const profile = await Profile.findOneAndUpdate(
    { userId: req.user.id },
    { $set: { avatarUrl } },
    { new: true, runValidators: true }
  );

  if (!profile) {
    throw new AppError('Profile not found.', 404);
  }

  sendSuccess(res, { avatarUrl, profile }, 'Avatar uploaded successfully.');
});
