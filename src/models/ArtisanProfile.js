import mongoose from 'mongoose';
import { resolveUploadUrl } from '../utils/resolveUrl.js';

const portfolioItemSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, trim: true },
    caption: { type: String, trim: true, maxlength: 200 },
  },
  { _id: false }
);

const certificationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    issuedBy: { type: String, trim: true },
    year: { type: Number, min: 1900, max: new Date().getFullYear() + 1 },
    fileUrl: { type: String, trim: true },
  },
  { _id: false }
);

const artisanProfileSchema = new mongoose.Schema(
  {
    profileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Profile',
      required: [true, 'profileId is required'],
      unique: true,
    },
    skill: {
      type: String,
      trim: true,
      required: [true, 'Primary skill is required'],
      maxlength: [100, 'Skill name cannot exceed 100 characters'],
    },
    skillCategory: {
      type: String,
      trim: true,
      maxlength: [80, 'Skill category cannot exceed 80 characters'],
    },
    // GeoJSON Point for geospatial queries.
    // Omitted until the artisan captures real coordinates — [0, 0] would
    // place them at "Null Island" in the Gulf of Guinea and pollute nearby
    // search results for every user on the platform.
    location: {
      type: {
        type: String,
        enum: ['Point'],
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
      },
    },
    serviceRadiusKm: {
      type: Number,
      default: 20,
      min: [1, 'Service radius must be at least 1 km'],
      max: [500, 'Service radius cannot exceed 500 km'],
    },
    city: { type: String, trim: true, maxlength: 80 },
    state: { type: String, trim: true, maxlength: 80 },
    address: { type: String, trim: true, maxlength: 200 },
    pricePerDay: {
      type: Number,
      min: [0, 'Price per day cannot be negative'],
    },
    experienceYears: {
      type: Number,
      min: [0, 'Experience years cannot be negative'],
      max: [60, 'Experience years seems too high'],
    },
    isAvailable: {
      type: Boolean,
      default: true,
    },
    portfolio: {
      type: [portfolioItemSchema],
      default: [],
    },
    certifications: {
      type: [certificationSchema],
      default: [],
    },
    availableDays: {
      type: [String],
      enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
      default: [],
    },
    workHoursStart: {
      type: String, // e.g. "08:00"
      trim: true,
    },
    workHoursEnd: {
      type: String, // e.g. "17:00"
      trim: true,
    },
    tools: {
      type: [String],
      default: [],
    },
    additionalSkills: {
      type: [String],
      default: [],
    },
    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    reviewCount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform(_doc, ret) {
        if (ret.portfolio) {
          ret.portfolio = ret.portfolio.map((item) => ({
            ...item,
            url: resolveUploadUrl(item.url),
          }));
        }
        if (ret.certifications) {
          ret.certifications = ret.certifications.map((cert) => ({
            ...cert,
            fileUrl: resolveUploadUrl(cert.fileUrl),
          }));
        }
        return ret;
      },
    },
    toObject: {
      transform(_doc, ret) {
        if (ret.portfolio) {
          ret.portfolio = ret.portfolio.map((item) => ({
            ...item,
            url: resolveUploadUrl(item.url),
          }));
        }
        if (ret.certifications) {
          ret.certifications = ret.certifications.map((cert) => ({
            ...cert,
            fileUrl: resolveUploadUrl(cert.fileUrl),
          }));
        }
        return ret;
      },
    },
  }
);

// ── Geospatial index (required for $near / $geoNear queries) ──────────────────
artisanProfileSchema.index({ location: '2dsphere' });
artisanProfileSchema.index({ skillCategory: 1 });
artisanProfileSchema.index({ isAvailable: 1 });

const ArtisanProfile = mongoose.model('ArtisanProfile', artisanProfileSchema);

export default ArtisanProfile;
