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
import Message from '../models/Message.js';
import Appointment from '../models/Appointment.js';
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
/**
 * How quickly somebody answers, measured rather than claimed.
 *
 * "Usually replies within an hour" is one of the most persuasive things a marketplace
 * profile can say, and it is worthless if it is self-reported. This reads it out of the
 * messages: for each of their recent conversations, the gap between the last message
 * somebody sent them and their first reply after it.
 *
 * The median, not the mean. One reply written three days later would drag an average
 * into uselessness, and what a client wants to know is the typical case rather than the
 * arithmetic one.
 *
 * Null when there is too little to be honest about. Four conversations is the floor —
 * below that a single fast reply would advertise a speed nobody can rely on.
 */
const RESPONSE_SAMPLE = 40;
const RESPONSE_MIN_CONVERSATIONS = 4;

async function medianResponseMs(profileId) {
  const recent = await Message.find({
    $or: [{ senderId: profileId }, { receiverId: profileId }],
  })
    .sort({ createdAt: -1 })
    .limit(600)
    .select('conversationId senderId createdAt')
    .lean();

  if (!recent.length) return null;

  // Oldest first per conversation, so a reply can be recognised as following something.
  const byConversation = new Map();
  for (const message of recent.reverse()) {
    if (!byConversation.has(message.conversationId)) byConversation.set(message.conversationId, []);
    byConversation.get(message.conversationId).push(message);
  }

  const gaps = [];
  for (const messages of byConversation.values()) {
    let waitingSince = null;

    for (const message of messages) {
      const mine = String(message.senderId) === String(profileId);

      if (!mine) {
        // Their first unanswered message is the one the clock starts on.
        if (waitingSince === null) waitingSince = new Date(message.createdAt).getTime();
        continue;
      }

      if (waitingSince !== null) {
        gaps.push(new Date(message.createdAt).getTime() - waitingSince);
        waitingSince = null;
        if (gaps.length >= RESPONSE_SAMPLE) break;
      }
    }
  }

  if (byConversation.size < RESPONSE_MIN_CONVERSATIONS || gaps.length < RESPONSE_MIN_CONVERSATIONS) {
    return null;
  }

  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

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
  const [pins, followers, following, iFollow, artisan, supplier, products, responseMs] =
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
              'skill skillCategory businessName businessTagline experienceYears isAvailable rating reviewCount isVerified serviceRadiusKm city state'
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

      // Only for the people somebody is deciding whether to rely on. A client's reply
      // speed is nobody's business and would be a strange thing to publish.
      ['artisan', 'supplier'].includes(profile.role)
        ? medianResponseMs(profile._id)
        : null,
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

        /**
         * Typical reply time in milliseconds, or null when there is too little to say.
         * Phrased on the client, since "within an hour" and "about a day" are the same
         * fact at different scales.
         */
        responseMs,

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
              // Trust signals. On a marketplace where somebody is deciding whether to let
              // a stranger into their house, these outrank anything else on the page.
              isVerified: !!artisan.isVerified,
              serviceRadiusKm: artisan.serviceRadiusKm ?? null,
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

// -- GET /api/v1/profiles/:profileId/availability ------------------------------
/**
 * Which of the next two weeks an artisan already has work on.
 *
 * Not a booking calendar — it does not know their working hours, their travel, or the
 * jobs they have taken off the platform. It knows what is scheduled here, which is enough
 * for the question a client actually asks: "can you come Thursday?"
 *
 * Returned as a list of days with a count rather than as free/busy, because one
 * appointment on a Tuesday does not make the Tuesday unavailable — and pretending it does
 * would lose the artisan work.
 */
export const getAvailability = asyncHandler(async (req, res) => {
  const { profileId } = req.params;
  if (!mongoose.isValidObjectId(profileId)) throw new AppError('Profile not found.', 404);

  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 14);

  const appointments = await Appointment.find({
    artisanId: profileId,
    status: 'scheduled',
    date: { $gte: from, $lt: to },
  })
    .select('date')
    .lean();

  // Counted per day, keyed by date so the client does not have to bucket them itself.
  const byDay = new Map();
  for (const appointment of appointments) {
    const key = new Date(appointment.date).toISOString().slice(0, 10);
    byDay.set(key, (byDay.get(key) ?? 0) + 1);
  }

  const days = [];
  for (let i = 0; i < 14; i += 1) {
    const day = new Date(from);
    day.setDate(day.getDate() + i);
    const key = day.toISOString().slice(0, 10);
    days.push({ date: key, booked: byDay.get(key) ?? 0 });
  }

  sendSuccess(res, { days }, 'Availability retrieved.');
});

// -- GET /api/v1/profiles/me --------------------------------------------------──
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
