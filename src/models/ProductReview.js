import mongoose from 'mongoose';

/**
 * What a buyer thought of the thing itself.
 *
 * Distinct from Review, which is about a *person* — whether a supplier turns up
 * when they say they will. Both matter and they answer different questions: a
 * reliable seller can still stock cement that sets badly, and one score cannot
 * carry both facts. This is what finally gives Product.rating something to hold;
 * that field existed from the beginning and nothing ever wrote to it.
 *
 * One review per person per product, enforced by index rather than by checking
 * first — two taps on a slow connection would otherwise leave two rows and a
 * doubled average.
 */
const productReviewSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: [true, 'productId is required'],
    },
    reviewerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Profile',
      required: [true, 'reviewerId is required'],
    },
    /**
     * The order that earns the right to say this. Kept on the row rather than
     * only checked at write time, so a review can still be shown as verified
     * years later without re-deriving it.
     */
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      default: null,
    },
    rating: {
      type: Number,
      required: [true, 'A rating is required'],
      min: [1, 'Rating must be between 1 and 5'],
      max: [5, 'Rating must be between 1 and 5'],
    },
    comment: {
      type: String,
      trim: true,
      maxlength: [1000, 'A review cannot exceed 1000 characters'],
    },
    /**
     * Buyer photographs. The single most useful thing on any review, and the
     * hardest to fake — capped so one person cannot fill the page.
     */
    images: {
      type: [String],
      default: [],
      validate: {
        validator: (v) => v.length <= 4,
        message: 'A review can carry at most 4 photographs',
      },
    },
  },
  { timestamps: true }
);

productReviewSchema.index({ productId: 1, createdAt: -1 });
productReviewSchema.index({ productId: 1, reviewerId: 1 }, { unique: true });

const ProductReview = mongoose.model('ProductReview', productReviewSchema);
export default ProductReview;
