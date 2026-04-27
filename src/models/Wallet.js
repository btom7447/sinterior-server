import mongoose from 'mongoose';

// Per-seller (and one platform-singleton) wallet. All amounts in kobo.
//
// Three-bucket balance model:
//   pendingBalance — credited on payment, held in escrow until release condition met
//   holdingBalance — released, in cool-down hold period (default 24h)
//   availableBalance — withdrawable now
//
// Negative `availableBalance` is allowed (e.g. after a refund pulls more than
// is available). When negative, `withdrawalsPaused` is forced true at the
// service layer and the user sees a banner explaining the situation.
const walletSchema = new mongoose.Schema(
  {
    profileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Profile',
      // null for the platform singleton
      index: true,
      sparse: true,
      unique: true,
    },
    isPlatform: { type: Boolean, default: false },

    pendingBalance: { type: Number, default: 0 },
    holdingBalance: { type: Number, default: 0 },
    availableBalance: { type: Number, default: 0 },

    // COD + scheduled-fee accrual. Cleared every Monday by invoice cron.
    feesOwed: { type: Number, default: 0 },

    // Per-seller controls (admin-set). Empty = inherit PlatformSetting defaults.
    withdrawalsPaused: { type: Boolean, default: false },
    pauseReason: { type: String, trim: true, maxlength: 500 },
    feeMode: {
      type: String,
      enum: ['per_transaction', 'weekly', 'monthly'],
      default: 'per_transaction',
    },
    customHoldHours: { type: Number, min: 0 },
    customPayoutReviewHours: { type: Number, min: 0 },
    customMinPayoutKobo: { type: Number, min: 0 },

    // Lifetime totals (denormalised for fast reads).
    totalEarned: { type: Number, default: 0 },
    totalPaidOut: { type: Number, default: 0 },
    totalFeesPaid: { type: Number, default: 0 },
    totalRefunded: { type: Number, default: 0 },

    currency: { type: String, default: 'NGN' },
  },
  { timestamps: true }
);

// Unique partial index — only ONE platform wallet ever exists. Without this,
// concurrent boot calls to getPlatform() could race-create duplicates.
walletSchema.index(
  { isPlatform: 1 },
  { unique: true, partialFilterExpression: { isPlatform: true } }
);

// Get-or-create helper. Used wherever we need to credit/debit but don't know
// if a wallet exists yet for a seller. Uses upsert so concurrent first-touches
// can't create two wallets for the same profile.
walletSchema.statics.findOrCreate = async function (profileId) {
  return this.findOneAndUpdate(
    { profileId },
    { $setOnInsert: { profileId } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

walletSchema.statics.getPlatform = async function () {
  return this.findOneAndUpdate(
    { isPlatform: true },
    { $setOnInsert: { isPlatform: true, profileId: null } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

const Wallet = mongoose.model('Wallet', walletSchema);
export default Wallet;
