import mongoose from 'mongoose';
import { resolveImageUrls } from '../utils/resolveUrl.js';
import { syncProductPin, removePinsForSource } from '../services/pinSync.service.js';
import { isValidCategory } from '../services/catalogue.service.js';

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
      /*
       * Checked against the catalogue an admin maintains, not a frozen list.
       *
       * This was an enum of seventeen strings — fifteen the shop used and two
       * ("Automobile", "Laundromat") that nothing ever did. Now that categories
       * are records an admin can create, an enum would mean every new shelf
       * rejected the first product filed on it, with an error naming a category
       * the admin could see on their own screen.
       *
       * Still a closed vocabulary: free text produces "Tiles", "tiles" and
       * "Tles" inside a week, and a filter over them matches one of the three.
       * The validator reads a cached list, so it is not a query per save.
       */
      validate: {
        validator: (value) => isValidCategory(value),
        message: '{VALUE} is not a category this shop offers',
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
    /**
     * Who made it.
     *
     * On a materials marketplace the brand *is* the purchase decision — people
     * buy Dangote or BUA, not "cement". It was buried inside the name string,
     * which meant it could not be filtered, grouped or shown as its own line.
     */
    brand: { type: String, trim: true, maxlength: 60 },
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

    // ── How it is fulfilled ───────────────────────────────────────────────
    /**
     * Whether this is on the ground or brought in when ordered.
     *
     * A pre-order is, by definition, a thing the supplier does not have — so it
     * must never be refused by the stock guards, and it must never decrement a
     * count. Treating it as ordinary stock would either block every sale or
     * drive the quantity negative.
     */
    fulfilment: {
      type: String,
      enum: {
        values: ['stocked', 'preorder'],
        message: "Fulfilment must be 'stocked' or 'preorder'",
      },
      default: 'stocked',
    },
    /** The window quoted to buyers, e.g. 4 to 6 weeks. */
    preorderWeeksMin: { type: Number, min: 0, default: null },
    preorderWeeksMax: { type: Number, min: 0, default: null },

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
productSchema.index({ category: 1, subcategory: 1 });
productSchema.index({ brand: 1 });
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
