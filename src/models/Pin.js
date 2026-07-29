import mongoose from 'mongoose';
import { resolvePinAlbum, resolveUploadUrl } from '../utils/resolveUrl.js';
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

    // Album pins. A finished job is rarely one photograph, and forcing an
    // artisan to post the same kitchen five times buries everyone else's work.
    //
    // When this is set it is the full set, and mediaUrl / mediaType /
    // posterUrl / aspectRatio above mirror media[0] — so every existing reader
    // (the feed grid, derived-pin sync, the website) keeps working untouched
    // and only surfaces that know about albums have to care.
    media: {
      type: [
        {
          _id: false,
          type: { type: String, enum: ['image', 'video'], default: 'image' },
          url: { type: String, required: true, trim: true },
          posterUrl: { type: String, trim: true },
          aspectRatio: { type: Number, default: 1, min: 0.2, max: 5 },
        },
      ],
      default: [],
      validate: {
        validator: (v) => !v || v.length <= 10,
        message: 'A pin can hold at most 10 items.',
      },
    },
    // width / height — stored at upload so masonry renders with zero layout
    // shift. Defaults to 1 (square) when the source dimensions are unknown.
    aspectRatio: { type: Number, default: 1, min: 0.2, max: 5 },

    /**
     * Required to be live, optional while a draft. A draft that cannot be put
     * down until it has a title is not a draft — somebody photographing a job
     * on site needs to save the photograph first and find the words later.
     * publishPin enforces this at the moment it starts to matter.
     */
    title: {
      type: String,
      required: [
        function () {
          return this.status !== 'draft';
        },
        'title is required',
      ],
      trim: true,
      maxlength: 200,
    },
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
      // Counts share-sheet opens, not confirmed sends: the OS never reports
      // whether anything was actually sent. A ranking signal, never a claim.
      shares: { type: Number, default: 0, min: 0 },
      // Schema-only in v1 — tracking endpoint lands in P2 (DECISIONS 2026-07-27).
      views: { type: Number, default: 0, min: 0 },
    },

    /**
     * draft   — written but not published. Never in any feed, never counted,
     *           visible only to its author on their own profile.
     * active  — live.
     * hidden  — taken down by moderation.
     * removed — deleted by the author. Kept as a tombstone so save counters on
     *           other people's boards do not go negative.
     *
     * Drafts exist because a job is photographed over days: the tiling goes in
     * on Tuesday and the grouting on Friday, and an artisan should be able to
     * start the pin on Tuesday without putting half a job in front of clients.
     */
    status: {
      type: String,
      enum: ['draft', 'active', 'hidden', 'removed'],
      default: 'active',
    },
    /** When it went live. Null while it is still a draft. */
    publishedAt: { type: Date, default: null },
    isFeatured: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        if (ret.mediaUrl) ret.mediaUrl = resolveUploadUrl(ret.mediaUrl);
        if (ret.posterUrl) ret.posterUrl = resolveUploadUrl(ret.posterUrl);
        if (ret.media?.length) ret.media = resolvePinAlbum(ret.media);
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
