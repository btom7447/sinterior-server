import mongoose from 'mongoose';

/**
 * Something somebody means to buy, later.
 *
 * Deliberately not a board. Boards hold pins — work somebody admires — and the
 * two get used for opposite things: a board is a mood, a saved product is a
 * shopping list. Mixing them would mean a client's "Kitchen ideas" board filling
 * with bags of cement.
 *
 * It is also not a cart. A cart is a decision with a quantity and a price
 * attached, held for minutes; this is "I will need tiles when the floor is
 * ready", held for weeks. Anything that expires a cart must not touch this.
 */
const savedProductSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile', required: true },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  },
  { timestamps: true }
);

// Saving twice is not saving more; the unique index makes the write idempotent.
savedProductSchema.index({ owner: 1, productId: 1 }, { unique: true });
// The list itself: one person's saves, newest first.
savedProductSchema.index({ owner: 1, createdAt: -1 });

const SavedProduct = mongoose.model('SavedProduct', savedProductSchema);
export default SavedProduct;
