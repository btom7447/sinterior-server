import mongoose from 'mongoose';

// One row per payout request. The flow:
//   1. Seller requests payout → row created with status 'pending', wallet
//      `availableBalance` debited immediately (so they can't double-spend).
//   2. After cooldown (default 24h), `processPayoutCooldown` cron fires the
//      Paystack transfer → status 'processing'.
//   3. Webhook `transfer.success` → status 'completed', `processedAt` set.
//   4. Webhook `transfer.failed` / `transfer.reversed` → status 'failed',
//      wallet credited back via `reversePayout`.
const payoutRequestSchema = new mongoose.Schema(
  {
    profileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Profile',
      required: true,
      index: true,
    },
    bankAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BankAccount',
      required: true,
    },

    amount: { type: Number, required: true, min: 1 }, // kobo

    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
      default: 'pending',
      index: true,
    },

    // Set when the cooldown elapses and we hand off to Paystack.
    paystackTransferCode: { type: String, trim: true },
    paystackTransferReference: { type: String, trim: true, index: true },

    failureReason: { type: String, trim: true, maxlength: 500 },

    // Earliest moment the cron can fire the transfer. Set at creation time
    // based on `payoutReviewHours` (admin can release earlier).
    scheduledFor: { type: Date, required: true },

    requestedAt: { type: Date, default: Date.now },
    processedAt: { type: Date }, // when Paystack handed off (transfer.success)
  },
  { timestamps: true }
);

payoutRequestSchema.index({ profileId: 1, createdAt: -1 });
payoutRequestSchema.index({ status: 1, scheduledFor: 1 });

const PayoutRequest = mongoose.model('PayoutRequest', payoutRequestSchema);
export default PayoutRequest;
