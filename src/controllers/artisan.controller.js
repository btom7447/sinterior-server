import ArtisanProfile from '../models/ArtisanProfile.js';
import Profile from '../models/Profile.js';
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess, sendPaginated } from '../utils/apiResponse.js';
import { getPagination, buildPaginationMeta } from '../utils/paginate.js';


// ── GET /api/v1/artisans ─────────────────────────────────────────────────────
// General list — no geo required. Supports ?category, ?skill, ?search, ?limit, ?page
export const list = asyncHandler(async (req, res) => {
  const { category, skill, search } = req.query;
  const { page, limit, skip } = getPagination(req.query);

  const filter = { isAvailable: true };
  if (category) {
    filter.skillCategory = { $regex: category, $options: 'i' };
  }
  if (skill) {
    filter.skill = { $regex: skill, $options: 'i' };
  }

  const [total, artisans] = await Promise.all([
    ArtisanProfile.countDocuments(filter),
    ArtisanProfile.find(filter)
      .populate({ path: 'profileId', select: 'fullName avatarUrl phone city state bio isSuspended' })
      .sort({ rating: -1, reviewCount: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  // If search term provided, filter in-memory (profile fields aren't indexed)
  let results = artisans;
  if (search) {
    const q = search.toLowerCase();
    results = artisans.filter((a) => {
      const profile = a.profileId;
      return (
        a.skill?.toLowerCase().includes(q) ||
        a.skillCategory?.toLowerCase().includes(q) ||
        a.city?.toLowerCase().includes(q) ||
        profile?.fullName?.toLowerCase().includes(q)
      );
    });
  }

  const pagination = buildPaginationMeta(search ? results.length : total, page, limit);
  sendPaginated(res, results, pagination, 'Artisans retrieved.');
});

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ── GET /api/v1/artisans/nearby ───────────────────────────────────────────────
// Returns artisans near the requested coordinates, with a city/state fallback
// for artisans whose location coordinates aren't populated yet.
export const getNearby = asyncHandler(async (req, res) => {
  const { lat, lng, radiusKm = 50, category, skill, city, state } = req.query;
  const { page, limit, skip } = getPagination(req.query);

  if (!lat || !lng) {
    throw new AppError('lat and lng query parameters are required.', 400);
  }

  const latitude = parseFloat(lat);
  const longitude = parseFloat(lng);
  const radius = parseFloat(radiusKm);

  if (isNaN(latitude) || isNaN(longitude) || isNaN(radius)) {
    throw new AppError('lat, lng, and radiusKm must be valid numbers.', 400);
  }

  // Defensive: only docs with a valid GeoJSON Point participate in $geoNear.
  // A single doc with a partial `location` field can otherwise crash the
  // aggregation with a 500.
  const geoMatch = {
    isAvailable: true,
    'location.type': 'Point',
    'location.coordinates': { $type: 'array' },
  };
  if (category) geoMatch.skillCategory = { $regex: category, $options: 'i' };
  if (skill) geoMatch.skill = { $regex: skill, $options: 'i' };

  const projectStage = {
    $project: {
      profileId: 1,
      skill: 1,
      skillCategory: 1,
      city: 1,
      state: 1,
      pricePerDay: 1,
      experienceYears: 1,
      isAvailable: 1,
      isVerified: 1,
      rating: 1,
      reviewCount: 1,
      distanceKm: 1,
      availableDays: 1,
      'profile.fullName': 1,
      'profile.avatarUrl': 1,
      'profile.phone': 1,
      'profile.isSuspended': 1,
    },
  };

  const lookupAndUnwind = [
    {
      $lookup: {
        from: 'profiles',
        localField: 'profileId',
        foreignField: '_id',
        as: 'profile',
      },
    },
    { $unwind: { path: '$profile', preserveNullAndEmpty: false } },
  ];

  // 1. Geo query — falls through to city match on any aggregation error.
  let geoResults = [];
  try {
    geoResults = await ArtisanProfile.aggregate([
      {
        $geoNear: {
          near: { type: 'Point', coordinates: [longitude, latitude] },
          distanceField: 'distanceMeters',
          maxDistance: radius * 1000,
          spherical: true,
          query: geoMatch,
        },
      },
      ...lookupAndUnwind,
      { $addFields: { distanceKm: { $divide: ['$distanceMeters', 1000] } } },
      projectStage,
    ]);
  } catch (err) {
    console.warn('[getNearby] $geoNear failed, falling back to city match:', err.message);
    geoResults = [];
  }

  // 2. City/state fallback — surfaces artisans without coordinates when the
  //    client passes a city/state hint.
  let cityResults = [];
  if (city || state) {
    const cityMatch = { isAvailable: true };
    if (category) cityMatch.skillCategory = { $regex: category, $options: 'i' };
    if (skill) cityMatch.skill = { $regex: skill, $options: 'i' };
    if (city) cityMatch.city = { $regex: `^${escapeRegex(city)}$`, $options: 'i' };
    if (state) cityMatch.state = { $regex: `^${escapeRegex(state)}$`, $options: 'i' };

    cityResults = await ArtisanProfile.aggregate([
      { $match: cityMatch },
      ...lookupAndUnwind,
      projectStage,
    ]);
  }

  // 3. Merge + dedupe by _id (geo results win since they have distanceKm).
  const seen = new Set();
  const merged = [];
  for (const a of [...geoResults, ...cityResults]) {
    const id = a._id.toString();
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(a);
  }

  const total = merged.length;
  const paged = merged.slice(skip, skip + limit);
  const pagination = buildPaginationMeta(total, page, limit);

  sendPaginated(res, paged, pagination, 'Nearby artisans retrieved.');
});

// ── GET /api/v1/artisans/:id ──────────────────────────────────────────────────
export const getById = asyncHandler(async (req, res) => {
  const artisan = await ArtisanProfile.findById(req.params.id).populate({
    path: 'profileId',
    select: 'fullName avatarUrl phone city state bio isSuspended',
    populate: { path: 'userId', select: 'email role isEmailVerified' },
  });

  if (!artisan) {
    throw new AppError('Artisan not found.', 404);
  }

  sendSuccess(res, { artisan }, 'Artisan retrieved.');
});

// ── GET /api/v1/artisans/me ──────────────────────────────────────────────────
// Authenticated artisan fetches their own artisan profile (full document
// including portfolio, certifications, location, etc.) for the editor.
export const getMine = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) throw new AppError('Profile not found.', 404);

  const artisan = await ArtisanProfile.findOne({ profileId: profile._id });
  if (!artisan) throw new AppError('Artisan profile not found.', 404);

  sendSuccess(res, { artisan }, 'Artisan profile retrieved.');
});

// ── PATCH /api/v1/artisans/onboarding ────────────────────────────────────────
// Authenticated artisan updates their own artisan profile
export const updateOnboarding = asyncHandler(async (req, res) => {
  // Find the logged-in user's Profile first
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) {
    throw new AppError('Profile not found.', 404);
  }

  const ALLOWED = [
    'skill',
    'skillCategory',
    'serviceRadiusKm',
    'city',
    'state',
    'address',
    'pricingModes',
    'pricePerDay',
    'pricePerHour',
    'experienceYears',
    'isAvailable',
    'portfolio',
    'certifications',
    'availableDays',
    'workHoursStart',
    'workHoursEnd',
    'tools',
    'additionalSkills',
  ];

  const updates = {};
  ALLOWED.forEach((field) => {
    if (req.body[field] !== undefined) {
      updates[field] = req.body[field];
    }
  });

  if (Object.keys(updates).length === 0) {
    throw new AppError('No valid fields provided for update.', 400);
  }

  // Validate that required rates are set when a time-based mode is selected.
  const modes = updates.pricingModes ?? [];
  if (modes.includes('daily') && !updates.pricePerDay) {
    const existing = await ArtisanProfile.findOne({ profileId: (await Profile.findOne({ userId: req.user.id }))._id }).select('pricePerDay');
    if (!existing?.pricePerDay) throw new AppError('pricePerDay is required when daily mode is selected.', 400);
  }
  if (modes.includes('hourly') && !updates.pricePerHour) {
    const existing = await ArtisanProfile.findOne({ profileId: (await Profile.findOne({ userId: req.user.id }))._id }).select('pricePerHour');
    if (!existing?.pricePerHour) throw new AppError('pricePerHour is required when hourly mode is selected.', 400);
  }

  const artisan = await ArtisanProfile.findOneAndUpdate(
    { profileId: profile._id },
    { $set: updates },
    { new: true, runValidators: true, upsert: false }
  );

  if (!artisan) {
    throw new AppError('Artisan profile not found. Complete registration first.', 404);
  }

  sendSuccess(res, { artisan }, 'Artisan profile updated.');
});

// ── POST /api/v1/artisans/portfolio ──────────────────────────────────────────
// Upload portfolio images (multipart). Returns array of URLs.
export const uploadPortfolio = asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    throw new AppError('No files uploaded. Please attach at least one image.', 400);
  }

  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) throw new AppError('Profile not found.', 404);

  const artisan = await ArtisanProfile.findOne({ profileId: profile._id });
  if (!artisan) throw new AppError('Artisan profile not found.', 404);

  const newItems = req.files.map((file, i) => ({
    url: file.url,
    caption: req.body.captions?.[i] || '',
  }));

  artisan.portfolio.push(...newItems);
  await artisan.save();

  sendSuccess(res, { portfolio: artisan.portfolio }, 'Portfolio images uploaded.');
});

// ── POST /api/v1/artisans/certifications ────────────────────────────────────
// Upload certification file. Returns the URL.
export const uploadCertification = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError('No file uploaded.', 400);
  }

  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) throw new AppError('Profile not found.', 404);

  const artisan = await ArtisanProfile.findOne({ profileId: profile._id });
  if (!artisan) throw new AppError('Artisan profile not found.', 404);

  const fileUrl = req.file.url;

  sendSuccess(res, { fileUrl }, 'Certification file uploaded.');
});

// ── PATCH /api/v1/artisans/location ──────────────────────────────────────────
// Update artisan GPS coordinates
export const updateLocation = asyncHandler(async (req, res) => {
  const { lat, lng } = req.body;

  if (lat === undefined || lng === undefined) {
    throw new AppError('lat and lng are required.', 400);
  }

  const latitude = parseFloat(lat);
  const longitude = parseFloat(lng);

  if (isNaN(latitude) || isNaN(longitude)) {
    throw new AppError('lat and lng must be valid numbers.', 400);
  }

  if (latitude < -90 || latitude > 90) {
    throw new AppError('lat must be between -90 and 90.', 400);
  }

  if (longitude < -180 || longitude > 180) {
    throw new AppError('lng must be between -180 and 180.', 400);
  }

  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) {
    throw new AppError('Profile not found.', 404);
  }

  const artisan = await ArtisanProfile.findOneAndUpdate(
    { profileId: profile._id },
    {
      $set: {
        location: {
          type: 'Point',
          coordinates: [longitude, latitude],
        },
      },
    },
    { new: true, runValidators: true }
  );

  if (!artisan) {
    throw new AppError('Artisan profile not found.', 404);
  }

  sendSuccess(res, { location: artisan.location }, 'Location updated.');
});
