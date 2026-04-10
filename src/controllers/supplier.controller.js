import SupplierProfile from '../models/SupplierProfile.js';
import Profile from '../models/Profile.js';
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import config from '../config/env.js';
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

  const logoUrl = `/${config.UPLOAD_DIR}/${req.file.filename}`;

  const supplier = await SupplierProfile.findOneAndUpdate(
    { profileId: profile._id },
    { $set: { logoUrl } },
    { new: true, runValidators: true, upsert: true, setDefaultsOnInsert: true }
  );

  sendSuccess(res, { logoUrl: resolveUploadUrl(logoUrl), supplier }, 'Logo uploaded successfully.');
});

// ── GET /api/v1/suppliers/me ────────────────────────────────────────────────
export const getMe = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) throw new AppError('Profile not found.', 404);

  const supplier = await SupplierProfile.findOne({ profileId: profile._id });
  if (!supplier) throw new AppError('Supplier profile not found.', 404);

  sendSuccess(res, { supplier }, 'Supplier profile retrieved.');
});
