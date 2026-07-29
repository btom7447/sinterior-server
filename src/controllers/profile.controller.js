import path from 'path';
import { fileURLToPath } from 'url';
import Profile from '../models/Profile.js';
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';

import { resolveUploadUrl } from '../utils/resolveUrl.js';
import escapeRegex from '../utils/escapeRegex.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── GET /api/v1/profiles/search?q= ────────────────────────────────────────────
// Feeds the @mention picker in comments. Deliberately narrow: names, avatars
// and roles only — enough to pick the right person out of a list and nothing
// that would turn the directory into an export.
export const searchProfiles = asyncHandler(async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 1) return sendSuccess(res, { profiles: [] }, 'Profiles retrieved.');

  const pattern = new RegExp(escapeRegex(q), 'i');
  const profiles = await Profile.find({ fullName: pattern })
    .select('fullName avatarUrl role')
    .limit(20)
    .lean();

  // Someone typing "ade" means Adeola before Folasade. Ordering happens here
  // rather than in the query because it needs both matches to compare.
  const starts = (p) => (p.fullName?.toLowerCase().startsWith(q.toLowerCase()) ? 0 : 1);
  const ranked = profiles
    .sort((a, b) => starts(a) - starts(b) || (a.fullName ?? '').localeCompare(b.fullName ?? ''))
    .slice(0, 8)
    .map((p) => ({ ...p, avatarUrl: resolveUploadUrl(p.avatarUrl) }));

  sendSuccess(res, { profiles: ranked }, 'Profiles retrieved.');
});

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
  const ALLOWED = ['fullName', 'phone', 'city', 'state', 'bio', 'preferredTrades'];

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

// ── GET /api/v1/profiles/me/settings ──────────────────────────────────────────
export const getSettings = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id }).select('settings');
  if (!profile) throw new AppError('Profile not found.', 404);
  sendSuccess(res, { settings: profile.settings }, 'Settings retrieved.');
});

// ── PATCH /api/v1/profiles/me/settings ───────────────────────────────────────
export const updateSettings = asyncHandler(async (req, res) => {
  const ALLOWED = ['notifications', 'darkMode', 'autoRenew', 'landRegistry', 'landInsurance', 'fireAlarm'];
  const updates = {};
  ALLOWED.forEach((key) => {
    if (typeof req.body[key] === 'boolean') {
      updates[`settings.${key}`] = req.body[key];
    }
  });

  if (Object.keys(updates).length === 0) {
    throw new AppError('No valid settings provided.', 400);
  }

  const profile = await Profile.findOneAndUpdate(
    { userId: req.user.id },
    { $set: updates },
    { new: true, runValidators: true }
  ).select('settings');

  if (!profile) throw new AppError('Profile not found.', 404);
  sendSuccess(res, { settings: profile.settings }, 'Settings updated.');
});

// ── POST /api/v1/profiles/me/avatar ───────────────────────────────────────────
// Requires: uploadSingle('avatar') + resizeImage(400, 400) middleware upstream
export const uploadAvatar = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError('No file uploaded. Please attach an image.', 400);
  }

  const avatarUrl = req.file.url;

  const profile = await Profile.findOneAndUpdate(
    { userId: req.user.id },
    { $set: { avatarUrl } },
    { new: true, runValidators: true }
  );

  if (!profile) {
    throw new AppError('Profile not found.', 404);
  }

  sendSuccess(res, { avatarUrl: resolveUploadUrl(avatarUrl), profile }, 'Avatar uploaded successfully.');
});
