import Product from '../models/Product.js';
import Profile from '../models/Profile.js';
import SavedProduct from '../models/SavedProduct.js';
import SupplierProfile from '../models/SupplierProfile.js';
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess, sendPaginated } from '../utils/apiResponse.js';
import { getPagination, buildPaginationMeta } from '../utils/paginate.js';
import { priceLine, skuKeyFor } from '../config/pricing.js';

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

/**
 * Canonicalise the purchasable rows a supplier sent.
 *
 * The key is computed here and never taken from the client: it is what stock
 * decrements match on, so a hand-written or stale key would decrement the wrong
 * counter — or nothing at all, and oversell.
 *
 * Rows without options, without a price, or duplicating a combination already
 * seen are dropped rather than stored. Two rows with the same key would race
 * each other on every order.
 */
function normalizeSkus(raw) {
  if (!Array.isArray(raw)) return undefined;

  const seen = new Set();
  const rows = [];

  for (const row of raw) {
    const options = row?.options;
    if (!options || typeof options !== 'object') continue;

    const key = skuKeyFor(options);
    if (!key || seen.has(key)) continue;

    const price = Number(row.price);
    if (!Number.isFinite(price) || price < 0) continue;

    seen.add(key);
    rows.push({
      key,
      options,
      price,
      quantity: Math.max(0, parseInt(row.quantity, 10) || 0),
      sku: typeof row.sku === 'string' ? row.sku.trim() : undefined,
      image: typeof row.image === 'string' ? row.image.trim() : undefined,
    });
  }
  return rows;
}

/** Bulk tiers, cleaned and ordered. Nonsense is dropped, not stored. */
function normalizeTiers(raw) {
  if (!Array.isArray(raw)) return undefined;
  return raw
    .map((t) => ({ minQty: parseInt(t?.minQty, 10), price: Number(t?.price) }))
    .filter((t) => Number.isFinite(t.minQty) && t.minQty >= 1 && Number.isFinite(t.price) && t.price >= 0)
    .sort((a, b) => a.minQty - b.minQty);
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
  sendPaginated(res, await withSavedFlag(req, products), pagination, 'Products retrieved.');
});

/**
 * Mark which of these the viewer has saved.
 *
 * One query for the whole page rather than one per product, and only when a
 * token was sent — a signed-out shopper gets false rather than somebody else's
 * list. Without this a card cannot draw a filled heart and the save silently
 * un-renders itself on the next scroll.
 */
async function withSavedFlag(req, products) {
  const list = products.map((p) => (typeof p.toJSON === 'function' ? p.toJSON() : p));
  if (!req.user?.id || !list.length) {
    return list.map((p) => ({ ...p, savedByMe: false }));
  }

  const profile = await Profile.findOne({ userId: req.user.id }).select('_id').lean();
  if (!profile) return list.map((p) => ({ ...p, savedByMe: false }));

  const saved = await SavedProduct.find({
    owner: profile._id,
    productId: { $in: list.map((p) => p._id) },
  })
    .select('productId')
    .lean();

  const mine = new Set(saved.map((s) => String(s.productId)));
  return list.map((p) => ({ ...p, savedByMe: mine.has(String(p._id)) }));
}

// ── GET /api/v1/products/:id ──────────────────────────────────────────────────
export const getById = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id).populate(
    'supplierId',
    'fullName avatarUrl city state phone'
  );

  if (!product || !product.isActive) {
    throw new AppError('Product not found.', 404);
  }

  const [shaped] = await withSavedFlag(req, [product]);

  /*
   * The seller's standing, attached here rather than fetched separately.
   *
   * A product carries rating fields of its own, but nothing writes them —
   * reviews are of the seller, not the item. Somebody deciding whether to send
   * money to a stranger for a lorry of cement is judging the seller anyway, so
   * that is the number worth showing, and it is one query rather than a second
   * round trip from the phone.
   *
   * Only on the detail route. A grid of cards all showing the same seller's
   * rating would be repeating one fact twenty times.
   */
  const sellerProfileId = product.supplierId?._id ?? product.supplierId;
  const seller = sellerProfileId
    ? await SupplierProfile.findOne({ profileId: sellerProfileId })
        .select(
          'rating reviewCount isVerified businessName deliveryDays minOrderValue coverageStates shippingRates courierServices'
        )
        .lean()
    : null;

  sendSuccess(
    res,
    {
      product: {
        ...shaped,
        seller: seller
          ? {
              rating: seller.rating ?? null,
              reviewCount: seller.reviewCount ?? 0,
              isVerified: !!seller.isVerified,
              businessName: seller.businessName ?? null,
            }
          : null,

        /*
         * What it costs to get here and how long it takes.
         *
         * Every one of these fields was already being collected from suppliers
         * and stored, and none of it had ever reached a buyer — checkout said
         * "delivery cost may be added by the supplier", which is the least
         * useful true thing we could have said. The rates map is small enough
         * (one entry per state) to send whole, so the client can price the
         * buyer's own state without a second request.
         */
        delivery: seller
          ? {
              leadTime: seller.deliveryDays ?? null,
              minOrderValue: seller.minOrderValue ?? null,
              coverage: seller.coverageStates ?? null,
              ratesByState: seller.shippingRates ?? {},
              couriers: (seller.courierServices ?? []).map((c) => ({
                name: c.name ?? null,
                phone: c.phone ?? null,
              })),
            }
          : null,
      },
    },
    'Product retrieved.'
  );
});

// ── POST /api/v1/products ─────────────────────────────────────────────────────
export const create = asyncHandler(async (req, res) => {
  // Only suppliers may create products — enforced by restrictTo upstream
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) {
    throw new AppError('Supplier profile not found.', 404);
  }

  const {
    name, description, category, subcategory, price, compareAtPrice, unit, quantity,
    specs, images, lowStockThreshold, sku, barcode, weightKg, dimensionsCm,
    variantOptions, skus, priceTiers, returnWindowDays, warrantyMonths,
    freeShippingOver, relatedIds,
  } = req.body;

  const qty = Math.max(0, parseInt(quantity, 10) || 1);
  const product = await Product.create({
    supplierId: profile._id,
    name,
    description,
    category,
    subcategory: subcategory || undefined,
    price,
    // Only kept when it is genuinely higher; a "was" price at or below the
    // asking price is not a promotion and must not be stored as one.
    compareAtPrice:
      Number(compareAtPrice) > Number(price) ? Number(compareAtPrice) : undefined,
    unit,
    quantity: qty,
    inStock: qty > 0,
    specs: normalizeSpecs(specs) || {},
    images: images || [],
    lowStockThreshold: lowStockThreshold !== undefined ? parseInt(lowStockThreshold, 10) : 20,
    sku,
    barcode,
    weightKg,
    dimensionsCm,
    variantOptions: Array.isArray(variantOptions) ? variantOptions : undefined,
    skus: normalizeSkus(skus),
    priceTiers: normalizeTiers(priceTiers),
    returnWindowDays,
    warrantyMonths,
    freeShippingOver,
    relatedIds: Array.isArray(relatedIds) ? relatedIds : undefined,
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

  const ALLOWED = [
    'name', 'description', 'category', 'subcategory', 'price', 'compareAtPrice',
    'unit', 'quantity', 'images', 'inStock', 'specs', 'lowStockThreshold',
    'sku', 'barcode', 'weightKg', 'dimensionsCm', 'variantOptions', 'skus',
    'priceTiers', 'returnWindowDays', 'warrantyMonths', 'freeShippingOver', 'relatedIds',
  ];
  const updates = {};
  ALLOWED.forEach((field) => {
    if (req.body[field] !== undefined) updates[field] = req.body[field];
  });

  // Normalize specs to array-of-values format
  if (updates.specs) {
    updates.specs = normalizeSpecs(updates.specs) || {};
  }

  // Variant rows and bulk tiers are re-keyed and re-checked on every write, so
  // a client cannot post a key that matches the wrong counter.
  if (updates.skus !== undefined) updates.skus = normalizeSkus(updates.skus) ?? [];
  if (updates.priceTiers !== undefined) updates.priceTiers = normalizeTiers(updates.priceTiers) ?? [];

  /*
   * Stock and buyability are two fields that must never disagree.
   *
   * `create` derives inStock from the quantity; this did not, so a supplier who
   * restocked a sold-out product went on being shown as out of stock — the shop
   * hid the Add button and nobody could buy what had just arrived. The reverse
   * was worse in a quieter way: quantity edited to zero left inStock true, so
   * buyers filled a cart that could only fail at checkout.
   *
   * An explicit inStock in the same request still wins; a supplier is allowed
   * to say "I have thirty but stop selling it".
   */
  if (updates.quantity !== undefined && updates.inStock === undefined) {
    updates.inStock = Number(updates.quantity) > 0;
  }

  /*
   * Restocking re-arms the low-stock warning. It is a one-shot flag set when
   * the quantity crosses the threshold downward, and nothing cleared it — so a
   * product that ran low once would never warn again for the rest of its life.
   */
  const threshold = updates.lowStockThreshold ?? product.lowStockThreshold ?? 20;
  if (updates.quantity !== undefined && Number(updates.quantity) > threshold) {
    updates.lowStockNotified = false;
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
    '_id name quantity inStock price unit skus priceTiers'
  );
  const productMap = new Map(products.map((p) => [p._id.toString(), p]));

  const results = items.map((item) => {
    const product = productMap.get(item.productId);
    if (!product) {
      return { productId: item.productId, available: false, reason: 'Product not found or inactive' };
    }

    /*
     * The price as it stands, alongside availability.
     *
     * A cart holds whatever a product cost when it was added, which on a
     * marketplace of building materials can be weeks ago — and the order
     * endpoint re-prices from the database. Without this the shopper reads
     * ₦9,500, taps pay, and is charged ₦10,200 with no warning.
     *
     * Priced through the same module the order uses, so the warning and the
     * charge cannot disagree: the same variant, the same bulk tier, the same
     * arithmetic.
     */
    const line = priceLine({ product, quantity: item.quantity, options: item.selectedSpecs });
    const pricing = { name: product.name, price: line.unitPrice, unit: product.unit };
    const stock = line.available ?? 0;

    if (stock <= 0) {
      return {
        productId: item.productId,
        available: false,
        availableQuantity: 0,
        reason: line.skuKey ? 'That option is out of stock' : 'Out of stock',
        ...pricing,
      };
    }
    if (stock < item.quantity) {
      return {
        productId: item.productId,
        available: false,
        availableQuantity: stock,
        reason: `Only ${stock} available`,
        ...pricing,
      };
    }
    return {
      productId: item.productId,
      available: true,
      availableQuantity: stock,
      ...pricing,
    };
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

// ── GET /api/v1/products/saved ────────────────────────────────────────────────
// The shopping list. Products that have since been withdrawn are dropped rather
// than shown as dead rows — a saved item you cannot buy is worse than one that
// quietly went away, because it invites a tap that can only disappoint.
export const listSaved = asyncHandler(async (req, res) => {
  const profile = await myProfile(req.user.id);
  const { page, limit, skip } = getPagination(req.query);

  const [total, rows] = await Promise.all([
    SavedProduct.countDocuments({ owner: profile._id }),
    SavedProduct.find({ owner: profile._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate({
        path: 'productId',
        match: { isActive: true },
        populate: { path: 'supplierId', select: 'fullName avatarUrl city state' },
      })
      .lean(),
  ]);

  const products = rows
    .map((r) => r.productId)
    .filter(Boolean)
    .map((p) => ({ ...p, savedByMe: true }));

  sendPaginated(res, products, buildPaginationMeta(total, page, limit), 'Saved products retrieved.');
});

// ── POST/DELETE /api/v1/products/:id/save ─────────────────────────────────────
// Idempotent both ways: the unique index absorbs a double tap, and unsaving
// something that was never saved is the state the caller asked for.
export const toggleSaved = asyncHandler(async (req, res) => {
  const profile = await myProfile(req.user.id);
  const saving = req.method === 'POST';

  if (saving) {
    const product = await Product.findById(req.params.id).select('_id isActive');
    if (!product || !product.isActive) throw new AppError('Product not found.', 404);

    await SavedProduct.updateOne(
      { owner: profile._id, productId: product._id },
      { $setOnInsert: { owner: profile._id, productId: product._id } },
      { upsert: true }
    );
  } else {
    await SavedProduct.deleteOne({ owner: profile._id, productId: req.params.id });
  }

  sendSuccess(res, { savedByMe: saving }, saving ? 'Saved.' : 'Removed from saved.');
});

/** The viewer's profile, or a 404 — every route here is behind protect. */
async function myProfile(userId) {
  const profile = await Profile.findOne({ userId }).select('_id').lean();
  if (!profile) throw new AppError('Profile not found.', 404);
  return profile;
}
