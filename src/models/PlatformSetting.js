import mongoose from 'mongoose';

const platformSettingSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    value: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    description: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

// Helper statics
platformSettingSchema.statics.get = async function (key, defaultValue = null) {
  const doc = await this.findOne({ key });
  return doc ? doc.value : defaultValue;
};

platformSettingSchema.statics.set = async function (key, value, description) {
  return this.findOneAndUpdate(
    { key },
    { value, ...(description ? { description } : {}) },
    { upsert: true, new: true }
  );
};

platformSettingSchema.statics.getAll = async function () {
  const docs = await this.find();
  const result = {};
  for (const doc of docs) {
    result[doc.key] = doc.value;
  }
  return result;
};

// Payment / escrow defaults. Used as fallback when a key isn't set in DB.
platformSettingSchema.statics.PAYMENT_DEFAULTS = Object.freeze({
  orderFeeBps: 500,             // 5%
  jobFeeBps: 700,               // 7%
  holdHours: 24,
  payoutReviewHours: 24,
  workAcceptanceDays: 7,
  minPayoutKobo: 500000,        // ₦5,000
  scheduledFeeWeekday: 1,       // Monday
  codFeeMode: 'accrue',
  codFeeThresholdKobo: 5000000, // ₦50,000
  globalPayoutsPaused: false,
  passPaystackFee: false,
});

// Returns a single payment-config object with DB overrides applied over defaults.
platformSettingSchema.statics.getPaymentConfig = async function () {
  const all = await this.getAll();
  const cfg = { ...this.PAYMENT_DEFAULTS };
  for (const key of Object.keys(this.PAYMENT_DEFAULTS)) {
    if (all[key] !== undefined) cfg[key] = all[key];
  }
  return cfg;
};

const PlatformSetting = mongoose.model('PlatformSetting', platformSettingSchema);
export default PlatformSetting;
