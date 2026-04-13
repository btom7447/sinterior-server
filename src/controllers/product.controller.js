import Product from '../models/Product.js';
import Profile from '../models/Profile.js';
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess, sendPaginated } from '../utils/apiResponse.js';
import { getPagination, buildPaginationMeta } from '../utils/paginate.js';

/**
 * Normalize specs to the canonical { key: [values] } format.
 * Accepts:
 *  - { "Color": "Red" }           → { "Color": ["Red"] }
 *  - { "Color": ["Red", "Blue"] } → unchanged
 *  - { "Color": "Red, Blue" }     → { "Color": ["Red", "Blue"] }
 */
function normalizeSpecs(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const out = {};
  for (const [key, val] of Object.entries(raw)) {
    const k = key.trim();
    if (!k) continue;
    if (Array.isArray(val)) {
      out[k] = val.map((v) => String(v).trim()).filter(Boolean);
    } else if (typeof val === 'string') {
      // Split comma-separated values
      out[k] = val.split(',').map((v) => v.trim()).filter(Boolean);
    } else {
      out[k] = [String(val)];
    }
  }
  return out;
}

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

  const { name, description, category, subcategory, price, unit, quantity, specs, images, lowStockThreshold } = req.body;

  const qty = Math.max(0, parseInt(quantity, 10) || 1);
  const product = await Product.create({
    supplierId: profile._id,
    name,
    description,
    category,
    subcategory: subcategory || undefined,
    price,
    unit,
    quantity: qty,
    inStock: qty > 0,
    specs: normalizeSpecs(specs) || {},
    images: images || [],
    lowStockThreshold: lowStockThreshold !== undefined ? parseInt(lowStockThreshold, 10) : 20,
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

  const ALLOWED = ['name', 'description', 'category', 'subcategory', 'price', 'unit', 'quantity', 'images', 'inStock', 'specs', 'lowStockThreshold'];
  const updates = {};
  ALLOWED.forEach((field) => {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  });

  // Normalize specs to array-of-values format
  if (updates.specs) {
    updates.specs = normalizeSpecs(updates.specs) || {};
  }

  const updated = await Product.findByIdAndUpdate(
    req.params.id,
    { $set: updates },
    { new: true, runValidators: true }
  );

  sendSuccess(res, { product: updated }, 'Product updated.');
});

// ── POST /api/v1/products/upload-images ──────────────────────────────────────
// Upload product images to Cloudinary. Returns an array of URLs.
export const uploadImages = asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) {
    throw new AppError('No files uploaded. Please attach at least one image.', 400);
  }

  const urls = req.files.map((f) => f.url);
  sendSuccess(res, { urls }, 'Images uploaded.');
});

// ── POST /api/v1/products/check-stock ────────────────────────────────────────
// Accepts an array of { productId, quantity } and returns availability for each.
export const checkStock = asyncHandler(async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    throw new AppError('items must be a non-empty array.', 400);
  }

  const productIds = items.map((i) => i.productId);
  const products = await Product.find({ _id: { $in: productIds }, isActive: true }).select(
    '_id name quantity inStock'
  );
  const productMap = new Map(products.map((p) => [p._id.toString(), p]));

  const results = items.map((item) => {
    const product = productMap.get(item.productId);
    if (!product) {
      return { productId: item.productId, available: false, reason: 'Product not found or inactive' };
    }
    if (!product.inStock || product.quantity === 0) {
      return { productId: item.productId, available: false, availableQuantity: 0, reason: 'Out of stock' };
    }
    if (product.quantity < item.quantity) {
      return {
        productId: item.productId,
        available: false,
        availableQuantity: product.quantity,
        reason: `Only ${product.quantity} available`,
      };
    }
    return { productId: item.productId, available: true, availableQuantity: product.quantity };
  });

  sendSuccess(res, { results }, 'Stock checked.');
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
