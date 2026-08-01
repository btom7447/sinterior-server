import mongoose from 'mongoose';
import { resolveImageUrls } from '../utils/resolveUrl.js';
import { syncProductPin, removePinsForSource } from '../services/pinSync.service.js';

const productSchema = new mongoose.Schema(
  {
    supplierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Profile',
      required: [true, 'supplierId is required'],
    },
    name: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
      maxlength: [200, 'Product name cannot exceed 200 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [2000, 'Description cannot exceed 2000 characters'],
    },
    category: {
      type: String,
      trim: true,
      required: [true, 'Category is required'],
      enum: {
        values: [
          'Lightings & Electrical', 'Panels', 'Wallpaper', 'Doors', 'Walls',
          'Cement', 'Steel & Iron', 'Tiles & Flooring', 'Paints', 'Roofing & Ceiling',
          'Smart Home', 'Furniture', 'Plumbing', 'Aggregates', 'Wood & Timber',
          'Automobile', 'Laundromat',
        ],
        message: '{VALUE} is not a valid category',
      },
    },
    subcategory: {
      type: String,
      trim: true,
      maxlength: [100, 'Subcategory cannot exceed 100 characters'],
    },
    price: {
      type: Number,
      required: [true, 'Price is required'],
      min: [0, 'Price cannot be negative'],
    },
    unit: {
      type: String,
      trim: true,
      default: 'piece',
      maxlength: [30, 'Unit cannot exceed 30 characters'],
    },
    images: {
      type: [String],
      default: [],
    },
    quantity: {
      type: Number,
      min: [0, 'Quantity cannot be negative'],
      default: 1,
    },
    inStock: {
      type: Boolean,
      default: true,
    },
    // Flexible specs — each key maps to an array of values
    // e.g. { "Color": ["Red", "Blue"], "Material": ["Wood"], "Weight": ["5kg"] }
    specs: {
      type: Map,
      of: [String],
      default: {},
    },
    /**
     * What it used to cost, when it is on promotion.
     *
     * Only ever displayed as a strike-through beside the asking price, and only
     * when it is genuinely higher — a "was" price below the current one is
     * either a mistake or a dark pattern, and the client refuses to render it
     * either way.
     */
    compareAtPrice: {
      type: Number,
      min: [0, 'Compare-at price cannot be negative'],
      default: null,
    },
    /**
     * How many have actually been delivered.
     *
     * Denormalised rather than counted per request: it appears on every card in
     * a grid, and an aggregation over orders per card is a page of queries.
     * Incremented only when an order reaches `delivered` — counting at checkout
     * would let an abandoned payment advertise a sale that never happened.
     */
    soldCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    reviewCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    /**
     * How the stars fall, written by the review recompute.
     *
     * Stored rather than aggregated on read: the product page shows the bars
     * above the reviews, and an aggregation per product is how a shop grid
     * becomes slow.
     */
    ratingBreakdown: {
      type: Object,
      default: () => ({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }),
    },
    // ── Identity ──────────────────────────────────────────────────────────
    /** The supplier's own code. Buyers use it to check they have the right thing. */
    sku: { type: String, trim: true, maxlength: 60 },
    barcode: { type: String, trim: true, maxlength: 40 },

    // ── What it physically is ─────────────────────────────────────────────
    // Not cosmetic on a materials marketplace: a ton of granite and a bag of
    // cement have nothing in common logistically, and this is what would let
    // delivery ever be computed rather than guessed.
    weightKg: { type: Number, min: 0 },
    dimensionsCm: {
      length: { type: Number, min: 0 },
      width: { type: Number, min: 0 },
      height: { type: Number, min: 0 },
    },

    // ── Variants ──────────────────────────────────────────────────────────
    /**
     * The axes a buyer chooses along, for building the selector.
     * e.g. [{ name: 'Size', values: ['600x600', '300x600'] }]
     */
    variantOptions: [
      {
        _id: false,
        name: { type: String, trim: true, maxlength: 40 },
        values: { type: [String], default: [] },
      },
    ],
    /**
     * The purchasable rows. One per combination that actually exists, each with
     * its own price and its own stock.
     *
     * Prices are absolute rather than deltas: a "+₦500 for the large one"
     * compounds unpredictably against a bulk tier, and nobody — supplier or
     * buyer — can work out what they will be charged.
     *
     * `key` is the canonical sorted form (see config/pricing.js). Sorting is
     * what makes { Size, Finish } and { Finish, Size } the same row; without it
     * two identical orders decrement two different counters.
     */
    skus: [
      {
        _id: false,
        key: { type: String, trim: true, required: true },
        options: { type: Map, of: String, default: {} },
        price: { type: Number, min: 0, required: true },
        quantity: { type: Number, min: 0, default: 0 },
        sku: { type: String, trim: true, maxlength: 60 },
        image: { type: String, trim: true },
      },
    ],

    // ── Bulk pricing ──────────────────────────────────────────────────────
    /**
     * "This price from this quantity upward." The descriptions already promise
     * trade prices on bulk; this is what lets the shop actually charge them.
     */
    priceTiers: [
      {
        _id: false,
        minQty: { type: Number, min: 1, required: true },
        price: { type: Number, min: 0, required: true },
      },
    ],

    // ── After the sale ────────────────────────────────────────────────────
    returnWindowDays: { type: Number, min: 0, default: null },
    warrantyMonths: { type: Number, min: 0, default: null },
    /** Order value above which this supplier ships this item free. */
    freeShippingOver: { type: Number, min: 0, default: null },

    /**
     * Things worth buying at the same time — cement wants sand and granite.
     * Curated by the supplier rather than inferred, because there is not yet
     * enough order history to infer anything honest from.
     */
    relatedIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],

    lowStockThreshold: {
      type: Number,
      min: [0, 'Low stock threshold cannot be negative'],
      default: 20,
    },
    lowStockNotified: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform(_doc, ret) {
        ret.images = resolveImageUrls(ret.images);
        return ret;
      },
    },
    toObject: {
      transform(_doc, ret) {
        ret.images = resolveImageUrls(ret.images);
        return ret;
      },
    },
  }
);

productSchema.index({ supplierId: 1 });
productSchema.index({ category: 1 });
productSchema.index({ isActive: 1 });
productSchema.index({ name: 'text', description: 'text' }); // full-text search

// ── Derived-pin sync (feed) ──────────────────────────────────────────────────
// Covers every mutation path the controllers use: create → save; edits and
// isActive soft-deletes → findOneAndUpdate. The update hook re-fetches because
// post('findOneAndUpdate') receives the PRE-update doc when {new:true} wasn't
// passed (the soft-delete path). Sync is best-effort and never throws.
productSchema.post('save', (doc) => {
  if (!doc) return;
  if (doc.isActive === false) removePinsForSource('product', doc._id);
  else syncProductPin(doc);
});

productSchema.post('findOneAndUpdate', async function (doc) {
  if (!doc) return;
  const fresh = await this.model.findById(doc._id);
  if (!fresh) return;
  if (fresh.isActive === false) removePinsForSource('product', fresh._id);
  else syncProductPin(fresh);
});

const Product = mongoose.model('Product', productSchema);

export default Product;
