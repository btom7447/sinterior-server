import mongoose from 'mongoose';

const propertySchema = new mongoose.Schema(
  {
    supplierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Profile',
      required: [true, 'supplierId is required'],
    },
    title: {
      type: String,
      required: [true, 'Property title is required'],
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters'],
    },
    description: {
      type: String,
      trim: true,
      maxlength: [3000, 'Description cannot exceed 3000 characters'],
    },
    type: {
      type: String,
      enum: {
        values: ['sale', 'rent'],
        message: "Type must be 'sale' or 'rent'",
      },
      required: [true, 'Listing type is required'],
    },
    propertyType: {
      type: String,
      enum: {
        values: ['apartment', 'house', 'land', 'commercial'],
        message: "propertyType must be one of: apartment, house, land, commercial",
      },
      required: [true, 'Property type is required'],
    },
    price: {
      type: Number,
      required: [true, 'Price is required'],
      min: [0, 'Price cannot be negative'],
    },
    bedrooms: {
      type: Number,
      min: 0,
    },
    bathrooms: {
      type: Number,
      min: 0,
    },
    size: {
      type: Number,
      min: [0, 'Size cannot be negative'],
    },
    sizeUnit: {
      type: String,
      trim: true,
      default: 'sqm',
      maxlength: [10, 'Size unit cannot exceed 10 characters'],
    },
    location: {
      type: String,
      trim: true,
      maxlength: [200, 'Location cannot exceed 200 characters'],
    },
    city: {
      type: String,
      trim: true,
      maxlength: [80, 'City cannot exceed 80 characters'],
    },
    state: {
      type: String,
      trim: true,
      maxlength: [80, 'State cannot exceed 80 characters'],
    },
    images: {
      type: [String],
      default: [],
    },
    features: {
      type: [String],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

propertySchema.index({ supplierId: 1 });
propertySchema.index({ type: 1 });
propertySchema.index({ propertyType: 1 });
propertySchema.index({ city: 1, state: 1 });
propertySchema.index({ price: 1 });
propertySchema.index({ isActive: 1 });

const Property = mongoose.model('Property', propertySchema);

export default Property;
