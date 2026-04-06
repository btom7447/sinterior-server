import Product from '../models/Product.js';
import Profile from '../models/Profile.js';
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess, sendPaginated } from '../utils/apiResponse.js';
import { getPagination, buildPaginationMeta } from '../utils/paginate.js';

// ── GET /api/v1/products ──────────────────────────────────────────────────────
export const list = asyncHandler(async (req, res) => {
  const { category, search, supplierId } = req.query;
  const { page, limit, skip } = getPagination(req.query);

  const filter = { isActive: true };

  if (category) {
    filter.category = category;
  }

  if (supplierId) {
    filter.supplierId = supplierId;
  }

  if (search) {
    // Use MongoDB full-text search if the text index is present
    filter.$text = { $search: search };
  }

  const [total, products] = await Promise.all([
    Product.countDocuments(filter),
    Product.find(filter)
      .sort(search ? { score: { $meta: 'textScore' } } : { createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('supplierId', 'fullName avatarUrl city state'),
  ]);

  const pagination = buildPaginationMeta(total, page, limit);
  sendPaginated(res, products, pagination, 'Products retrieved.');
});

// ── GET /api/v1/products/:id ──────────────────────────────────────────────────
export const getById = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id).populate(
    'supplierId',
    'fullName avatarUrl city state phone'
  );

  if (!product || !product.isActive) {
    throw new AppError('Product not found.', 404);
  }

  sendSuccess(res, { product }, 'Product retrieved.');
});

// ── POST /api/v1/products ─────────────────────────────────────────────────────
export const create = asyncHandler(async (req, res) => {
  // Only suppliers may create products — enforced by restrictTo upstream
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) {
    throw new AppError('Supplier profile not found.', 404);
  }

  const { name, description, category, price, unit, quantity, specs, images } = req.body;

  const qty = Math.max(0, parseInt(quantity, 10) || 1);
  const product = await Product.create({
    supplierId: profile._id,
    name,
    description,
    category,
    price,
    unit,
    quantity: qty,
    inStock: qty > 0,
    specs,
    images: images || [],
  });

  sendSuccess(res, { product }, 'Product created.', 201);
});

// ── PATCH /api/v1/products/:id ────────────────────────────────────────────────
export const update = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) {
    throw new AppError('Profile not found.', 404);
  }

  const product = await Product.findById(req.params.id);
  if (!product || !product.isActive) {
    throw new AppError('Product not found.', 404);
  }

  // Ensure the requesting supplier owns this product
  if (product.supplierId.toString() !== profile._id.toString()) {
    throw new AppError('You are not authorised to update this product.', 403);
  }

  const ALLOWED = ['name', 'description', 'category', 'price', 'unit', 'quantity', 'images', 'inStock', 'specs'];
  const updates = {};
  ALLOWED.forEach((field) => {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  });

  const updated = await Product.findByIdAndUpdate(
    req.params.id,
    { $set: updates },
    { new: true, runValidators: true }
  );

  sendSuccess(res, { product: updated }, 'Product updated.');
});

// ── DELETE /api/v1/products/:id ───────────────────────────────────────────────
export const remove = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) {
    throw new AppError('Profile not found.', 404);
  }

  const product = await Product.findById(req.params.id);
  if (!product || !product.isActive) {
    throw new AppError('Product not found.', 404);
  }

  if (product.supplierId.toString() !== profile._id.toString()) {
    throw new AppError('You are not authorised to delete this product.', 403);
  }

  // Soft-delete: set isActive to false
  await Product.findByIdAndUpdate(req.params.id, { isActive: false });

  sendSuccess(res, null, 'Product deleted.');
});
