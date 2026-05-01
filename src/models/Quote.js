import mongoose from 'mongoose';

const materialRowSchema = new mongoose.Schema(
  {
    description: { type: String, required: true, trim: true, maxlength: 200 },
    qty: { type: Number, required: true, min: 0 },
    unit: { type: String, trim: true, maxlength: 50 }, // free text: m², doors, etc.
    unitPrice: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, default: 0 }, // qty * unitPrice, computed before save
  },
  { _id: false }
);

const quoteSchema = new mongoose.Schema(
  {
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Job',
      required: true,
      index: true,
    },
    artisanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Profile',
      required: true,
    },
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Profile',
      required: true,
    },

    // Pricing mode context — quote-only modes (flat/sqm/unit).
    pricingMode: {
      type: String,
      enum: ['flat', 'sqm', 'unit'],
      required: true,
    },

    labourCost: { type: Number, required: true, min: 0 }, // NGN
    materials: { type: [materialRowSchema], default: [] },
    materialTotal: { type: Number, default: 0 }, // sum of lineTotals
    total: { type: Number, required: true, min: 0 }, // labourCost + materialTotal

    notes: { type: String, trim: true, maxlength: 1000 },

    // sent      — artisan submitted, client reviewing
    // accepted  — client agreed, totalAmount locked on Job
    // rejected  — client declined; artisan may send a new quote
    // superseded — artisan edited and resubmitted a newer version
    status: {
      type: String,
      enum: ['sent', 'accepted', 'rejected', 'superseded'],
      default: 'sent',
      index: true,
    },

    version: { type: Number, default: 1 },
    sentAt: { type: Date, default: Date.now },
    respondedAt: { type: Date },
    respondedBy: { type: String, enum: ['client', 'artisan'] },
  },
  { timestamps: true }
);

quoteSchema.index({ jobId: 1, status: 1 });
quoteSchema.index({ jobId: 1, version: -1 });

const Quote = mongoose.model('Quote', quoteSchema);
export default Quote;
