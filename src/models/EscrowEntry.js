import mongoose from 'mongoose';

// Tracks one held position of money between buyer and seller. One per
// (order, supplier) pair and one per job. Released to seller's wallet when
// the relevant condition is met (delivery confirmed for orders, work
// accepted for jobs).
const escrowEntrySchema = new mongoose.Schema(
  {
    entityType: {
      type: String,
      enum: ['order', 'job'],
      required: true,
      index: true,
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    buyerProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Profile',
      required: true,
    },
    sellerProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Profile',
      required: true,
      index: true,
    },

    // All amounts in kobo.
    amount: { type: Number, required: true, min: 0 },     // gross from buyer
    feeAmount: { type: Number, default: 0, min: 0 },      // platform cut at release time
    netAmount: { type: Number, default: 0, min: 0 },      // amount - feeAmount = what seller actually got

    status: {
      type: String,
      enum: ['held', 'released', 'refunded', 'partially_refunded'],
      default: 'held',
      index: true,
    },

    // Links back to the original Paystack charge so we can refund through
    // the right transaction if needed.
    paystackReference: { type: String, trim: true, index: true },

    heldAt: { type: Date, default: Date.now },
    releasedAt: { type: Date },
    refundedAt: { type: Date },
    refundedAmount: { type: Number, default: 0 },         // for partial refunds
    refundReason: { type: String, trim: true, maxlength: 500 },

    // Admin force-release audit trail.
    adminOverrideReason: { type: String, trim: true, maxlength: 500 },
    adminOverrideBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

escrowEntrySchema.index({ entityType: 1, entityId: 1 });
escrowEntrySchema.index({ sellerProfileId: 1, status: 1 });
// Idempotency guard — one escrow per (paystack charge, seller). Prevents
// double-creation if both /verify and the webhook race for a multi-supplier order.
escrowEntrySchema.index(
  { paystackReference: 1, sellerProfileId: 1 },
  { unique: true, partialFilterExpression: { paystackReference: { $type: 'string' } } }
);

const EscrowEntry = mongoose.model('EscrowEntry', escrowEntrySchema);
export default EscrowEntry;
