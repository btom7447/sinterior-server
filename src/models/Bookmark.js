import mongoose from 'mongoose';

const bookmarkSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Profile',
      required: true,
    },
    artisanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Profile',
      required: true,
    },
  },
  { timestamps: true }
);

bookmarkSchema.index({ userId: 1, artisanId: 1 }, { unique: true });
bookmarkSchema.index({ userId: 1, createdAt: -1 });

const Bookmark = mongoose.model('Bookmark', bookmarkSchema);
export default Bookmark;
