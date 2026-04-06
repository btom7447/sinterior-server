import mongoose from 'mongoose';

const bookmarkSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Profile',
      required: true,
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: 'entityType',
    },
    entityType: {
      type: String,
      required: true,
      enum: ['Profile', 'Product', 'Property'],
    },
    // Legacy field — kept for backward compat with existing artisan bookmarks
    artisanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Profile',
    },
  },
  { timestamps: true }
);

bookmarkSchema.index({ userId: 1, entityId: 1, entityType: 1 }, { unique: true });
bookmarkSchema.index({ userId: 1, entityType: 1, createdAt: -1 });

// Migrate old data: if artisanId is set but entityId is not, copy it
bookmarkSchema.pre('save', function (next) {
  if (this.artisanId && !this.entityId) {
    this.entityId = this.artisanId;
    this.entityType = 'Profile';
  }
  next();
});

const Bookmark = mongoose.model('Bookmark', bookmarkSchema);
export default Bookmark;
