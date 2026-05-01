import mongoose from 'mongoose';

const materialRowSchema = new mongoose.Schema(
  {
    description: { type: String, required: true, trim: true, maxlength: 200 },
    qty:         { type: Number, required: true, min: 0 },
    unit:        { type: String, trim: true, maxlength: 50 }, // free text: bags, m², doors…
    unitPrice:   { type: Number, required: true, min: 0 },
    lineTotal:   { type: Number, default: 0 },               // qty * unitPrice, computed
  },
  { _id: false }
);

const quoteSchema = new mongoose.Schema(
  {
    jobId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Job',     required: true, index: true },
    artisanId: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile', required: true },
    clientId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Profile', required: true },

    // ── Artisan business identity snapshot ───────────────────────────────────
    // Captured at send time so the quote always reflects who issued it,
    // even if the artisan later edits their profile.
    artisanBusiness: {
      name:    { type: String, trim: true, maxlength: 100 },
      tagline: { type: String, trim: true, maxlength: 200 },
      logoUrl: { type: String, trim: true },
    },

    // ── Labour line ──────────────────────────────────────────────────────────
    // labourType tells the client how the artisan priced their work:
    //   flat   — one fixed amount  (e.g. "Paint this room: ₦80,000")
    //   hourly — rate × hours      (e.g. ₦5,000/hr × 16 hrs)
    //   daily  — rate × days       (e.g. ₦20,000/day × 3 days)
    //   sqm    — rate × area m²    (e.g. ₦2,500/m² × 45 m²)
    //   unit   — rate × item count (e.g. ₦15,000/door × 4 doors)
    labourType: {
      type: String,
      enum: ['flat', 'hourly', 'daily', 'sqm', 'unit'],
      required: true,
    },
    labourRate: { type: Number, required: true, min: 0 }, // unit price (or flat total)
    labourQty:  { type: Number, default: 1, min: 0 },     // multiplier (1 for flat)
    labourCost: { type: Number, required: true, min: 0 }, // labourRate * labourQty

    // ── Materials ────────────────────────────────────────────────────────────
    materials:     { type: [materialRowSchema], default: [] },
    materialTotal: { type: Number, default: 0 },

    // ── Grand total ──────────────────────────────────────────────────────────
    total: { type: Number, required: true, min: 0 }, // labourCost + materialTotal

    notes: { type: String, trim: true, maxlength: 1000 },

    // sent       — artisan submitted, client reviewing
    // accepted   — client agreed, totalAmount locked on Job
    // rejected   — client declined; artisan may revise and resend
    // superseded — artisan edited, a newer version exists
    status: {
      type: String,
      enum: ['sent', 'accepted', 'rejected', 'superseded'],
      default: 'sent',
      index: true,
    },

    version:     { type: Number, default: 1 },
    sentAt:      { type: Date, default: Date.now },
    respondedAt: { type: Date },
    respondedBy: { type: String, enum: ['client', 'artisan'] },
  },
  { timestamps: true }
);

quoteSchema.index({ jobId: 1, status: 1 });
quoteSchema.index({ jobId: 1, version: -1 });

const Quote = mongoose.model('Quote', quoteSchema);
export default Quote;
