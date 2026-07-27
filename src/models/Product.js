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
