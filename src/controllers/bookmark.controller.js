import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/AppError.js';
import Bookmark from '../models/Bookmark.js';
import Profile from '../models/Profile.js';
import Product from '../models/Product.js';
import Property from '../models/Property.js';
import { getPagination, buildPaginationMeta } from '../utils/paginate.js';
import { resolveUploadUrl } from '../utils/resolveUrl.js';

const VALID_TYPES = { artisan: 'Profile', product: 'Product', property: 'Property' };

export const toggleBookmark = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) throw new AppError('Profile not found.', 404);

  // Support both legacy { artisanId } and new { entityId, type }
  let entityId = req.body.entityId;
  let entityType = VALID_TYPES[req.body.type];

  // Legacy support
  if (!entityId && req.body.artisanId) {
    entityId = req.body.artisanId;
    entityType = 'Profile';
  }

  if (!entityId || !entityType) {
    throw new AppError('entityId and type (artisan/product/property) are required.', 400);
  }

  // Self-bookmark guard — saving your own profile / product / property is
  // pointless and clutters the dashboard. Block it explicitly.
  if (entityType === 'Profile' && entityId.toString() === profile._id.toString()) {
    throw new AppError('You cannot save your own profile.', 400);
  }
  if (entityType === 'Product') {
    const product = await Product.findById(entityId).select('supplierId');
    if (product && product.supplierId.toString() === profile._id.toString()) {
      throw new AppError('You cannot save your own product.', 400);
    }
  }
  if (entityType === 'Property') {
    const property = await Property.findById(entityId).select('supplierId');
    if (property && property.supplierId.toString() === profile._id.toString()) {
      throw new AppError('You cannot save your own property.', 400);
    }
  }

  const existing = await Bookmark.findOne({ userId: profile._id, entityId, entityType });
  if (existing) {
    await existing.deleteOne();
    return res.status(200).json({ success: true, data: { saved: false }, message: 'Bookmark removed.' });
  }

  await Bookmark.create({ userId: profile._id, entityId, entityType });
  res.status(201).json({ success: true, data: { saved: true }, message: 'Saved.' });
});

export const getBookmarks = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) throw new AppError('Profile not found.', 404);

  const { page, limit, skip } = getPagination(req.query);
  const type = req.query.type; // artisan | product | property
  const entityType = VALID_TYPES[type];

  const filter = { userId: profile._id };
  if (entityType) filter.entityType = entityType;
  // Legacy fallback: if no entityType set, also include old artisanId bookmarks
  if (!entityType) {
    filter.$or = [
      { entityType: { $exists: true } },
      { artisanId: { $exists: true } },
    ];
  }

  const [bookmarks, total] = await Promise.all([
    Bookmark.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate({
        path: 'entityId',
        select: entityType === 'Profile'
          ? 'fullName avatarUrl city state'
          : entityType === 'Product'
          ? 'name price images category inStock'
          : 'title price images type city state',
      })
      // Legacy populate
      .populate({
        path: 'artisanId',
        select: 'fullName avatarUrl city state',
      }),
    Bookmark.countDocuments(filter),
  ]);

  // Normalize response — resolve image URLs
  const normalized = bookmarks.map((b) => {
    const obj = b.toObject();
    const entity = obj.entityId || obj.artisanId;
    if (entity?.avatarUrl) entity.avatarUrl = resolveUploadUrl(entity.avatarUrl);
    if (entity?.images) entity.images = entity.images.map(resolveUploadUrl);
    return {
      _id: obj._id,
      entityType: obj.entityType || 'Profile',
      entity,
      createdAt: obj.createdAt,
    };
  });

  res.status(200).json({
    success: true,
    data: { bookmarks: normalized },
    pagination: buildPaginationMeta(total, page, limit),
    message: 'Saved items retrieved.',
  });
});

export const checkBookmark = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) throw new AppError('Profile not found.', 404);

  const { entityId } = req.params;
  const exists = await Bookmark.exists({
    userId: profile._id,
    $or: [
      { entityId },
      { artisanId: entityId }, // legacy
    ],
  });
  res.status(200).json({ success: true, data: { saved: !!exists } });
});
