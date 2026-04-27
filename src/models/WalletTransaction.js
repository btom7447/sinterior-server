import mongoose from 'mongoose';

// Append-only ledger. Every wallet balance change writes a row here so we can
// reconstruct/audit balances and surface activity in the UI.
const walletTransactionSchema = new mongoose.Schema(
  {
    walletId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Wallet',
      required: true,
      index: true,
    },

    // What kind of change this row represents.
    type: {
      type: String,
      enum: [
        'escrow_credit',      // money received into pending (from buyer payment)
        'escrow_release',     // pending → holding (released from escrow)
        'hold_expire',        // holding → available (cool-down passed)
        'fee_deduction',      // platform fee debited from supplier
        'fee_accrue',         // platform fee accrued (scheduled mode + COD)
        'fee_invoice',        // weekly Monday cron debiting feesOwed from available
        'payout',             // outgoing transfer to seller's bank
        'payout_reversal',    // failed transfer credited back
        'refund_in',          // refund credited (rare — buyer side TBD)
        'refund_out',         // refund debited from seller (admin force-refund)
        'platform_fee_in',    // platform wallet receiving fee
        'adjustment',         // admin manual adjustment
      ],
      required: true,
    },

    // signed kobo. Negative = debit, positive = credit.
    amount: { type: Number, required: true },

    // Which bucket the change hit (so we can render activity meaningfully).
    bucket: {
      type: String,
      enum: ['pending', 'holding', 'available', 'feesOwed'],
      required: true,
    },

    // Source entity for traceability + UI deep-links.
    source: {
      type: String,
      enum: ['order', 'job', 'payout', 'platform_fee', 'manual', 'refund'],
    },
    referenceId: { type: mongoose.Schema.Types.ObjectId },

    // For credits that have a hold period — when this credit becomes withdrawable.
    availableAt: { type: Date },

    // Set by promoteExpiredHolds when the cron has claimed this row for
    // promotion. Used as an atomic guard so concurrent cron runs can't
    // double-promote the same holding credit.
    promotedAt: { type: Date },

    description: { type: String, trim: true, maxlength: 500 },

    // Snapshot of all four buckets after this transaction was applied.
    balanceSnapshot: {
      pending: Number,
      holding: Number,
      available: Number,
      feesOwed: Number,
    },
  },
  { timestamps: true }
);

walletTransactionSchema.index({ walletId: 1, createdAt: -1 });
walletTransactionSchema.index({ source: 1, referenceId: 1 });

const WalletTransaction = mongoose.model('WalletTransaction', walletTransactionSchema);
export default WalletTransaction;
