import path from 'path';
import { fileURLToPath } from 'url';
import Profile from '../models/Profile.js';
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';

import { resolveUploadUrl } from '../utils/resolveUrl.js';
import escapeRegex from '../utils/escapeRegex.js';
import Pin from '../models/Pin.js';
import ArtisanProfile from '../models/ArtisanProfile.js';
import SupplierProfile from '../models/SupplierProfile.js';
import Product from '../models/Product.js';
import Follow from '../models/Follow.js';
import { isProfileOnline } from '../socket.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── GET /api/v1/profiles/search?q= ────────────────────────────────────────────
// Feeds the @mention picker in comments. Deliberately narrow: names, avatars
// and roles only — enough to pick the right person out of a list and nothing
// that would turn the directory into an export.
export const searchProfiles = asyncHandler(async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 1) return sendSuccess(res, { profiles: [] }, 'Profiles retrieved.');

  const pattern = new RegExp(escapeRegex(q), 'i');

  // Staff are deliberately unfindable. An admin account in a name search is an
  // invitation to message the platform about a dispute in a private thread,
  // where nothing is logged against the job and nobody is on shift. Admins can
  // still open a conversation from their side; the way in from a member's side
  // is the report control in the chat header.
  const me = await Profile.findOne({ userId: req.user?.id }).select('_id').lean();
  const profiles = await Profile.find({
    fullName: pattern,
    role: { $ne: 'admin' },
    ...(me ? { _id: { $ne: me._id } } : {}),
  })
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

// ── GET /api/v1/profiles/:profileId/public ────────────────────────────────────
/**
 * Anybody's public profile, whatever their role.
 *
 * The artisan endpoints only answer for artisans, which left every other name in
 * the app unclickable — a client who comments on a job has no page, so there is
 * no way to see who they are or message them without already having a thread.
 *
 * Deliberately thin. Enough to decide whether to talk to somebody, and nothing
 * that would turn a comment thread into a way to harvest the directory: no
 * email, no phone, no location beyond the city they chose to publish.
 */
export const getPublicProfile = asyncHandler(async (req, res) => {
  const { profileId } = req.params;

  const profile = await Profile.findById(profileId)
    .select('fullName avatarUrl role city state bio createdAt')
    .lean();
  if (!profile) throw new AppError('Profile not found.', 404);

  const me = await Profile.findOne({ userId: req.user?.id }).select('_id').lean();

  /**
   * Everything the page can show, gathered at once.
   *
   * The counts are what the screen was missing: a profile with no posts and no follower
   * count is a portrait and a name, which is why a client's page looked broken next to
   * an artisan's. Zeroes are returned rather than omitted — the screen decides what a
   * zero should look like, and that is not a decision the server should make for it.
   */
  const [pins, followers, following, iFollow, artisan, supplier, products] =
    await Promise.all([
      // Only published work. A draft is not a portfolio.
      Pin.countDocuments({ author: profile._id, status: 'active' }),
      Follow.countDocuments({ followed: profile._id }),
      Follow.countDocuments({ follower: profile._id }),
      me ? Follow.exists({ follower: me._id, followed: profile._id }) : null,

      // Role-specific, and null for anybody it does not apply to rather than an empty
      // object — the client tests for presence to decide whether a section exists.
      profile.role === 'artisan'
        ? ArtisanProfile.findOne({ profileId: profile._id })
            .select(
              'skill skillCategory businessName businessTagline experienceYears isAvailable rating reviewCount city state'
            )
            .lean()
        : null,
      profile.role === 'supplier'
        ? SupplierProfile.findOne({ profileId: profile._id })
            .select('businessName businessType description logoUrl isVerified categories deliveryDays')
            .lean()
        : null,
      profile.role === 'supplier'
        ? Product.countDocuments({ supplierId: profile._id })
        : 0,
    ]);

  sendSuccess(
    res,
    {
      profile: {
        id: profile._id,
        fullName: profile.fullName,
        avatarUrl: resolveUploadUrl(profile.avatarUrl),
        role: profile.role,
        isStaff: profile.role === 'admin',
        isOnline: isProfileOnline(profile._id),
        city: profile.city ?? null,
        state: profile.state ?? null,
        bio: profile.bio ?? '',
        joinedAt: profile.createdAt,
        counts: { pins, followers, following, products },

        /** Whether the caller already follows them, so the button knows its own state. */
        isFollowing: !!iFollow,
        /** True for your own profile, so the page can drop every action at once. */
        isMe: !!me && me._id.toString() === profile._id.toString(),

        artisan: artisan
          ? {
              skill: artisan.skill ?? null,
              skillCategory: artisan.skillCategory ?? null,
              businessName: artisan.businessName ?? null,
              businessTagline: artisan.businessTagline ?? null,
              experienceYears: artisan.experienceYears ?? null,
              isAvailable: artisan.isAvailable ?? null,
              // What other people found. On a marketplace this outranks anything the
              // artisan wrote about themselves, so the page should be able to show it.
              rating: artisan.rating ?? null,
              reviewCount: artisan.reviewCount ?? 0,
            }
          : null,

        supplier: supplier
          ? {
              businessName: supplier.businessName ?? null,
              businessType: supplier.businessType ?? null,
              description: supplier.description ?? null,
              logoUrl: resolveUploadUrl(supplier.logoUrl),
              isVerified: !!supplier.isVerified,
              categories: supplier.categories ?? [],
              deliveryDays: supplier.deliveryDays ?? null,
            }
          : null,
      },
    },
    'Profile retrieved.'
  );
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
