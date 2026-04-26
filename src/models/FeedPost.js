import mongoose from 'mongoose';

// Admin-curated content card surfaced on the public /feed page alongside
// artisan portfolio items. Pinterest-style: media-dominant card with optional
// caption and link-out. Supports image OR video as the primary media.
const feedPostSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    caption: { type: String, trim: true, maxlength: 500 },

    // Media — exactly one of (image, video). `mediaUrl` holds the URL for both.
    mediaType: {
      type: String,
      enum: ['image', 'video'],
      default: 'image',
    },
    mediaUrl: { type: String, required: true, trim: true },

    // For videos: optional poster/thumbnail shown until the user clicks play.
    posterUrl: { type: String, trim: true },

    // Optional CTA — clicking the pin opens the modal; the "Visit" button
    // inside the modal goes here.
    linkUrl: { type: String, trim: true, maxlength: 500 },

    // Free-form tags shown as filter chips on the public feed.
    tags: [{ type: String, trim: true }],

    // Pinned to the top of the feed when published.
    isFeatured: { type: Boolean, default: false },

    status: {
      type: String,
      enum: ['draft', 'published'],
      default: 'draft',
    },
    publishedAt: { type: Date },
  },
  { timestamps: true }
);

feedPostSchema.index({ status: 1, publishedAt: -1 });
feedPostSchema.index({ isFeatured: 1 });

// Back-compat virtual: legacy code/seed data may still pass `imageUrl`.
feedPostSchema
  .virtual('imageUrl')
  .get(function () {
    return this.mediaUrl;
  })
  .set(function (v) {
    this.mediaUrl = v;
    if (!this.mediaType) this.mediaType = 'image';
  });

feedPostSchema.set('toJSON', { virtuals: true });
feedPostSchema.set('toObject', { virtuals: true });

feedPostSchema.pre('save', function (next) {
  if (this.isModified('status') && this.status === 'published' && !this.publishedAt) {
    this.publishedAt = new Date();
  }
  next();
});

const FeedPost = mongoose.model('FeedPost', feedPostSchema);
export default FeedPost;
