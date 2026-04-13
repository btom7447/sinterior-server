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

platformSettingSchema.index({ key: 1 });

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

const PlatformSetting = mongoose.model('PlatformSetting', platformSettingSchema);
export default PlatformSetting;
