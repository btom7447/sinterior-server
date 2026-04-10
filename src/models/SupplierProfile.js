import mongoose from 'mongoose';
import { resolveUploadUrl } from '../utils/resolveUrl.js';

const supplierProfileSchema = new mongoose.Schema(
  {
    profileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Profile',
      required: [true, 'profileId is required'],
      unique: true,
    },
    businessName: { type: String, trim: true, maxlength: 200 },
    businessType: {
      type: String,
      enum: ['materials', 'real_estate', 'both'],
      default: 'materials',
    },
    description: { type: String, trim: true, maxlength: 500 },
    logoUrl: { type: String, trim: true },

    // Verification
    cacNumber: { type: String, trim: true, maxlength: 50 },
    taxId: { type: String, trim: true, maxlength: 50 },
    isVerified: { type: Boolean, default: false },

    // Categories
    categories: { type: [String], default: [] },

    // Delivery
    deliveryOptions: { type: [String], default: [] },
    minOrderValue: { type: Number, min: 0 },
    deliveryDays: { type: String, trim: true },
    coverageStates: { type: String, trim: true },

    // Payout
    businessAddress: { type: String, trim: true, maxlength: 300 },
    whatsappNumber: { type: String, trim: true, maxlength: 20 },
    bankName: { type: String, trim: true },
    accountNumber: { type: String, trim: true, maxlength: 10 },
    accountName: { type: String, trim: true },

    // Metrics (updated by system)
    rating: { type: Number, default: 0, min: 0, max: 5 },
    reviewCount: { type: Number, default: 0, min: 0 },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform(_doc, ret) {
        if (ret.logoUrl) ret.logoUrl = resolveUploadUrl(ret.logoUrl);
        return ret;
      },
    },
    toObject: {
      transform(_doc, ret) {
        if (ret.logoUrl) ret.logoUrl = resolveUploadUrl(ret.logoUrl);
        return ret;
      },
    },
  }
);

const SupplierProfile = mongoose.model('SupplierProfile', supplierProfileSchema);

export default SupplierProfile;
