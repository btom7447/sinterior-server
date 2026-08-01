import mongoose from 'mongoose';

/**
 * "Will you deliver to Uyo?" — the questions a description never answers.
 *
 * Worth more here than on most marketplaces. Building materials are bought on
 * specifics that vary by batch and by site: whether the grade is 42.5R or
 * 42.5N, whether a lorry can reach the street, whether the tiles are rectified.
 * Every answered question is also content the next buyer reads instead of
 * asking again.
 *
 * Answers are embedded rather than their own collection: they are always read
 * with the question, never alone, and a question with forty answers is not a
 * thing that happens on a product page.
 */
const answerSchema = new mongoose.Schema(
  {
    body: {
      type: String,
      required: [true, 'An answer cannot be empty'],
      trim: true,
      maxlength: [1000, 'An answer cannot exceed 1000 characters'],
    },
    answeredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Profile',
      required: true,
    },
    /**
     * Whether this came from the person selling it.
     *
     * Stored rather than derived, because a supplier's answer stays the
     * supplier's answer even after the listing changes hands, and the badge is
     * the whole reason anyone trusts the reply.
     */
    fromSeller: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const productQuestionSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: [true, 'productId is required'],
    },
    askedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Profile',
      required: [true, 'askedBy is required'],
    },
    body: {
      type: String,
      required: [true, 'A question cannot be empty'],
      trim: true,
      maxlength: [500, 'A question cannot exceed 500 characters'],
    },
    answers: { type: [answerSchema], default: [] },
  },
  { timestamps: true }
);

// Answered questions first: an unanswered one is a worse advertisement than no
// question at all, and the useful ones should not be buried under it.
productQuestionSchema.index({ productId: 1, createdAt: -1 });

const ProductQuestion = mongoose.model('ProductQuestion', productQuestionSchema);
export default ProductQuestion;
