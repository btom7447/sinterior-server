import mongoose from 'mongoose';

const documentSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      enum: ['cac_certificate', 'business_license', 'tax_id', 'utility_bill', 'national_id', 'other'],
    },
    url: { type: String, required: true, trim: true },
    label: { type: String, trim: true, maxlength: 100 }, // optional human label
  },
  { _id: false }
);

const verificationRequestSchema = new mongoose.Schema(
  {
    // Whose verification this is.
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Profile',
      required: true,
    },

    // Differentiates the two verification flows. Suppliers verify a business
    // (CAC + supporting docs), artisans verify themselves (national ID +
    // optional certs).
    kind: {
      type: String,
      enum: ['business', 'individual'],
      default: 'business',
    },

    // Business verification: business name on CAC. Individual: full name on ID.
    businessName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },

    // Multi-document: every request can carry one or more uploaded documents.
    documents: {
      type: [documentSchema],
      default: [],
    },

    // Legacy single-document fields retained so old rows keep working until
    // we run a migration. New rows always use `documents` above.
    documentType: {
      type: String,
      enum: ['cac_certificate', 'business_license', 'tax_id', 'utility_bill', 'national_id', 'other'],
    },
    documentUrl: {
      type: String,
      trim: true,
    },

    // pending → approved → (optional) revoked
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'revoked'],
      default: 'pending',
    },
    // Reason shown to the requestor when status is rejected or revoked.
    reviewNote: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    reviewedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

verificationRequestSchema.index({ sellerId: 1 });
verificationRequestSchema.index({ status: 1, createdAt: -1 });

const VerificationRequest = mongoose.model('VerificationRequest', verificationRequestSchema);
export default VerificationRequest;
