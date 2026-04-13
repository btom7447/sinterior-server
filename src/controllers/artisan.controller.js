import ArtisanProfile from '../models/ArtisanProfile.js';
import Profile from '../models/Profile.js';
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess, sendPaginated } from '../utils/apiResponse.js';
import { getPagination, buildPaginationMeta } from '../utils/paginate.js';


// ── GET /api/v1/artisans ─────────────────────────────────────────────────────
// General list — no geo required. Supports ?category, ?search, ?limit, ?page
export const list = asyncHandler(async (req, res) => {
  const { category, search } = req.query;
  const { page, limit, skip } = getPagination(req.query);

  const filter = { isAvailable: true };
  if (category) {
    filter.skillCategory = { $regex: category, $options: 'i' };
  }

  const [total, artisans] = await Promise.all([
    ArtisanProfile.countDocuments(filter),
    ArtisanProfile.find(filter)
      .populate({ path: 'profileId', select: 'fullName avatarUrl phone city state bio' })
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

// ── GET /api/v1/artisans/nearby ───────────────────────────────────────────────
export const getNearby = asyncHandler(async (req, res) => {
  const { lat, lng, radiusKm = 50, category } = req.query;
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

  // Build match stage for optional category filter.
  // Exclude artisans with missing or [0, 0] coordinates (legacy default).
  const matchStage = {
    isAvailable: true,
    'location.coordinates': { $exists: true, $ne: [0, 0] },
  };
  if (category) {
    matchStage.skillCategory = { $regex: category, $options: 'i' };
  }

  // $geoNear must be the first stage in an aggregation pipeline
  const pipeline = [
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [longitude, latitude] },
        distanceField: 'distanceMeters',
        maxDistance: radius * 1000, // km → metres
        spherical: true,
        query: matchStage,
      },
    },
    {
      $lookup: {
        from: 'profiles',
        localField: 'profileId',
        foreignField: '_id',
        as: 'profile',
      },
    },
    { $unwind: { path: '$profile', preserveNullAndEmpty: false } },
    {
      $addFields: {
        distanceKm: { $divide: ['$distanceMeters', 1000] },
      },
    },
    {
      $project: {
        profileId: 1,
        skill: 1,
        skillCategory: 1,
        city: 1,
        state: 1,
        pricePerDay: 1,
        experienceYears: 1,
        isAvailable: 1,
        rating: 1,
        reviewCount: 1,
        distanceKm: 1,
        availableDays: 1,
        'profile.fullName': 1,
        'profile.avatarUrl': 1,
        'profile.phone': 1,
      },
    },
  ];

  // Count total for pagination (run a separate lightweight aggregation)
  const countPipeline = pipeline.slice(0, 2); // up to $geoNear stage
  countPipeline.push({ $count: 'total' });

  const [countResult, artisans] = await Promise.all([
    ArtisanProfile.aggregate(countPipeline),
    ArtisanProfile.aggregate([...pipeline, { $skip: skip }, { $limit: limit }]),
  ]);

  const total = countResult[0]?.total || 0;
  const pagination = buildPaginationMeta(total, page, limit);

  sendPaginated(res, artisans, pagination, 'Nearby artisans retrieved.');
});

// ── GET /api/v1/artisans/:id ──────────────────────────────────────────────────
export const getById = asyncHandler(async (req, res) => {
  const artisan = await ArtisanProfile.findById(req.params.id).populate({
    path: 'profileId',
    select: 'fullName avatarUrl phone city state bio',
    populate: { path: 'userId', select: 'email role isEmailVerified' },
  });

  if (!artisan) {
    throw new AppError('Artisan not found.', 404);
  }

  sendSuccess(res, { artisan }, 'Artisan retrieved.');
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
    'pricePerDay',
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
