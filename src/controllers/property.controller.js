import Property from '../models/Property.js';
import Profile from '../models/Profile.js';
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess, sendPaginated } from '../utils/apiResponse.js';
import { getPagination, buildPaginationMeta } from '../utils/paginate.js';

// ── GET /api/v1/properties ────────────────────────────────────────────────────
export const list = asyncHandler(async (req, res) => {
  const { type, propertyType, city, minPrice, maxPrice } = req.query;
  const { page, limit, skip } = getPagination(req.query);

  const filter = { isActive: true };

  if (type) filter.type = type;
  if (propertyType) filter.propertyType = propertyType;
  if (city) filter.city = { $regex: city, $options: 'i' };

  if (minPrice !== undefined || maxPrice !== undefined) {
    filter.price = {};
    if (minPrice !== undefined) filter.price.$gte = parseFloat(minPrice);
    if (maxPrice !== undefined) filter.price.$lte = parseFloat(maxPrice);
  }

  const [total, properties] = await Promise.all([
    Property.countDocuments(filter),
    Property.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('supplierId', 'fullName avatarUrl city state phone'),
  ]);

  const pagination = buildPaginationMeta(total, page, limit);
  sendPaginated(res, properties, pagination, 'Properties retrieved.');
});

// ── GET /api/v1/properties/:id ────────────────────────────────────────────────
export const getById = asyncHandler(async (req, res) => {
  const property = await Property.findById(req.params.id).populate(
    'supplierId',
    'fullName avatarUrl city state phone bio'
  );

  if (!property || !property.isActive) {
    throw new AppError('Property not found.', 404);
  }

  sendSuccess(res, { property }, 'Property retrieved.');
});

// ── POST /api/v1/properties ───────────────────────────────────────────────────
export const create = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) {
    throw new AppError('Supplier profile not found.', 404);
  }

  const {
    title,
    description,
    type,
    propertyType,
    price,
    bedrooms,
    bathrooms,
    size,
    sizeUnit,
    location,
    city,
    state,
    images,
    features,
  } = req.body;

  const property = await Property.create({
    supplierId: profile._id,
    title,
    description,
    type,
    propertyType,
    price,
    bedrooms,
    bathrooms,
    size,
    sizeUnit,
    location,
    city,
    state,
    images: images || [],
    features: features || [],
  });

  sendSuccess(res, { property }, 'Property listed.', 201);
});

// ── PATCH /api/v1/properties/:id ──────────────────────────────────────────────
export const update = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) {
    throw new AppError('Profile not found.', 404);
  }

  const property = await Property.findById(req.params.id);
  if (!property || !property.isActive) {
    throw new AppError('Property not found.', 404);
  }

  if (property.supplierId.toString() !== profile._id.toString()) {
    throw new AppError('You are not authorised to update this property.', 403);
  }

  const ALLOWED = [
    'title', 'description', 'type', 'propertyType', 'price',
    'bedrooms', 'bathrooms', 'size', 'sizeUnit', 'location',
    'city', 'state', 'images', 'features', 'isActive',
  ];

  const updates = {};
  ALLOWED.forEach((field) => {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  });

  const updated = await Property.findByIdAndUpdate(
    req.params.id,
    { $set: updates },
    { new: true, runValidators: true }
  );

  sendSuccess(res, { property: updated }, 'Property updated.');
});

// ── DELETE /api/v1/properties/:id ─────────────────────────────────────────────
export const remove = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) {
    throw new AppError('Profile not found.', 404);
  }

  const property = await Property.findById(req.params.id);
  if (!property || !property.isActive) {
    throw new AppError('Property not found.', 404);
  }

  if (property.supplierId.toString() !== profile._id.toString()) {
    throw new AppError('You are not authorised to delete this property.', 403);
  }

  await Property.findByIdAndUpdate(req.params.id, { isActive: false });

  sendSuccess(res, null, 'Property removed.');
});
