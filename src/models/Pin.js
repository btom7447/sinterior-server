import mongoose from 'mongoose';
import { resolveUploadUrl } from '../utils/resolveUrl.js';
import { TRADES, ROOMS, BUDGET_BAND_IDS } from '../config/taxonomy.js';

// Canonical feed unit (docs/prd.md). A pin is either authored natively by an
// artisan/supplier or derived from a Product/Property/FeedPost — derived pins
// are upserted by pinSync.service.js whenever their source mutates, so the
// feed can never drift from inventory.
const pinSchema = new mongoose.Schema(
  {
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Profile',
      required: [true, 'author is required'],
    },
    sourceType: {
      type: String,
      enum: ['native', 'product', 'property', 'admin'],
      required: true,
      default: 'native',
    },
    // Product/Property/FeedPost id for derived pins; null for native.
    sourceRef: { type: mongoose.Schema.Types.ObjectId, default: null },
    // Derived pins may fan out one pin per source image — this disambiguates.
    sourceIndex: { type: Number, default: 0 },

    mediaType: { type: String, enum: ['image', 'video'], default: 'image' },
    mediaUrl: { type: String, required: [true, 'mediaUrl is required'], trim: true },
    posterUrl: { type: String, trim: true },
    // width / height — stored at upload so masonry renders with zero layout
    // shift. Defaults to 1 (square) when the source dimensions are unknown.
    aspectRatio: { type: Number, default: 1, min: 0.2, max: 5 },

    title: { type: String, required: [true, 'title is required'], trim: true, maxlength: 200 },
    caption: { type: String, trim: true, maxlength: 1000 },

    taxonomy: {
      trade: { type: String, enum: [...TRADES, null], default: null },
      room: { type: String, enum: [...ROOMS, null], default: null },
      budgetBand: { type: String, enum: [...BUDGET_BAND_IDS, null], default: null },
      tags: { type: [String], default: [] },
    },

    counters: {
      saves: { type: Number, default: 0, min: 0 },
      likes: { type: Number, default: 0, min: 0 },
      comments: { type: Number, default: 0, min: 0 },
      // Schema-only in v1 — tracking endpoint lands in P2 (DECISIONS 2026-07-27).
      views: { type: Number, default: 0, min: 0 },
    },

    status: {
      type: String,
      enum: ['active', 'hidden', 'removed'],
      default: 'active',
    },
    isFeatured: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        if (ret.mediaUrl) ret.mediaUrl = resolveUploadUrl(ret.mediaUrl);
        if (ret.posterUrl) ret.posterUrl = resolveUploadUrl(ret.posterUrl);
        return ret;
      },
    },
  }
);

// Feed query path: active pins ranked by recency/score, filterable by taxonomy.
pinSchema.index({ status: 1, createdAt: -1 });
pinSchema.index({ title: 'text', caption: 'text', 'taxonomy.tags': 'text' }); // free-text search
pinSchema.index({ status: 1, 'taxonomy.trade': 1, createdAt: -1 });
pinSchema.index({ status: 1, 'taxonomy.room': 1, createdAt: -1 });
pinSchema.index({ author: 1, createdAt: -1 });
// One derived pin per (source, image slot) — makes upserts idempotent.
pinSchema.index(
  { sourceType: 1, sourceRef: 1, sourceIndex: 1 },
  { unique: true, partialFilterExpression: { sourceRef: { $type: 'objectId' } } }
);

const Pin = mongoose.model('Pin', pinSchema);
export default Pin;
