import SupplierProfile from '../models/SupplierProfile.js';
import Profile from '../models/Profile.js';
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';

import { resolveUploadUrl } from '../utils/resolveUrl.js';

// ── PATCH /api/v1/suppliers/onboarding ──────────────────────────────────────
export const updateOnboarding = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) throw new AppError('Profile not found.', 404);

  const ALLOWED = [
    'businessName', 'businessType', 'description',
    'cacNumber', 'taxId',
    'categories',
    'deliveryOptions', 'minOrderValue', 'deliveryDays', 'coverageStates',
    'businessAddress', 'whatsappNumber', 'bankName', 'accountNumber', 'accountName',
  ];

  const updates = {};
  ALLOWED.forEach((field) => {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  });

  if (Object.keys(updates).length === 0) {
    throw new AppError('No valid fields provided for update.', 400);
  }

  const supplier = await SupplierProfile.findOneAndUpdate(
    { profileId: profile._id },
    { $set: updates },
    { new: true, runValidators: true, upsert: true, setDefaultsOnInsert: true }
  );

  sendSuccess(res, { supplier }, 'Supplier profile updated.');
});

// ── POST /api/v1/suppliers/logo ──────────────────────────────────────────────
export const uploadLogo = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError('No file uploaded. Please attach an image.', 400);
  }

  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) throw new AppError('Profile not found.', 404);

  const logoUrl = req.file.url;

  const supplier = await SupplierProfile.findOneAndUpdate(
    { profileId: profile._id },
    { $set: { logoUrl } },
    { new: true, runValidators: true, upsert: true, setDefaultsOnInsert: true }
  );

  sendSuccess(res, { logoUrl: resolveUploadUrl(logoUrl), supplier }, 'Logo uploaded successfully.');
});

// ── GET /api/v1/suppliers/:profileId — public ──────────────────────────────
export const getByProfileId = asyncHandler(async (req, res) => {
  const profile = await Profile.findById(req.params.profileId).select(
    'fullName avatarUrl phone city state bio role createdAt'
  );
  if (!profile || profile.role !== 'supplier') {
    throw new AppError('Supplier not found.', 404);
  }

  const supplier = await SupplierProfile.findOne({ profileId: profile._id });

  // Count how many states have shipping configured
  const shippingStatesCount = supplier?.shippingRates
    ? [...supplier.shippingRates.keys()].length
    : 0;

  sendSuccess(
    res,
    {
      profile: {
        _id: profile._id,
        fullName: profile.fullName,
        avatarUrl: profile.avatarUrl,
        phone: profile.phone,
        city: profile.city,
        state: profile.state,
        bio: profile.bio,
        memberSince: profile.createdAt,
      },
      business: supplier
        ? {
            businessName: supplier.businessName,
            businessType: supplier.businessType,
            description: supplier.description,
            logoUrl: supplier.logoUrl,
            categories: supplier.categories,
            deliveryOptions: supplier.deliveryOptions,
            deliveryDays: supplier.deliveryDays,
            coverageStates: supplier.coverageStates,
            businessAddress: supplier.businessAddress,
            whatsappNumber: supplier.whatsappNumber,
            isVerified: supplier.isVerified,
            rating: supplier.rating,
            reviewCount: supplier.reviewCount,
            courierServices: (supplier.courierServices || []).map((c) => ({
              name: c.name,
              phone: c.phone,
            })),
            minOrderValue: supplier.minOrderValue,
            shippingStatesCount,
          }
        : null,
    },
    'Supplier profile retrieved.'
  );
});

// ── GET /api/v1/suppliers/me ────────────────────────────────────────────────
export const getMe = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) throw new AppError('Profile not found.', 404);

  const supplier = await SupplierProfile.findOne({ profileId: profile._id });
  if (!supplier) throw new AppError('Supplier profile not found.', 404);

  sendSuccess(res, { supplier }, 'Supplier profile retrieved.');
});

// ── PATCH /api/v1/suppliers/shipping ───────────────────────────────────────
export const updateShipping = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) throw new AppError('Profile not found.', 404);

  const { shippingRates, courierServices } = req.body;

  const updates = {};
  if (shippingRates !== undefined) updates.shippingRates = shippingRates;
  if (courierServices !== undefined) updates.courierServices = courierServices;

  if (Object.keys(updates).length === 0) {
    throw new AppError('No valid fields provided.', 400);
  }

  const supplier = await SupplierProfile.findOneAndUpdate(
    { profileId: profile._id },
    { $set: updates },
    { new: true, runValidators: true, upsert: true, setDefaultsOnInsert: true }
  );

  sendSuccess(res, { supplier }, 'Shipping settings updated.');
});

// ── GET /api/v1/suppliers/:profileId/shipping ── public ───────────────────
export const getShippingRates = asyncHandler(async (req, res) => {
  const profileDoc = await Profile.findById(req.params.profileId).select('role');
  if (!profileDoc || profileDoc.role !== 'supplier') {
    throw new AppError('Supplier not found.', 404);
  }

  const supplier = await SupplierProfile.findOne({ profileId: profileDoc._id }).select(
    'shippingRates courierServices'
  );

  sendSuccess(
    res,
    {
      shippingRates: supplier?.shippingRates || {},
      courierServices: supplier?.courierServices || [],
    },
    'Shipping rates retrieved.'
  );
});
