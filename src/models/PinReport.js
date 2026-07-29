import mongoose from 'mongoose';

// Somebody flagging a pin.
//
// Required by both app stores for any app carrying user-generated content, and
// the only channel through which a platform learns it is hosting something it
// should not be.
//
// Reports are kept rather than acted on automatically. Auto-hiding on a report
// count hands anyone with three accounts the power to remove a competitor's
// work, which on a marketplace is a business weapon rather than a moderation
// tool. A human decides; this is the queue they read.
const REASONS = ['spam', 'not-their-work', 'offensive', 'misleading', 'other'];

const pinReportSchema = new mongoose.Schema(
  {
    pinId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pin', required: true },
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile', required: true },
    reason: { type: String, enum: REASONS, required: true },
    note: { type: String, trim: true, maxlength: 500 },
    status: {
      type: String,
      enum: ['open', 'reviewed', 'actioned', 'dismissed'],
      default: 'open',
    },
  },
  { timestamps: true }
);

// One report per person per pin: reporting twice is not twice the signal.
pinReportSchema.index({ pinId: 1, reporter: 1 }, { unique: true });
pinReportSchema.index({ status: 1, createdAt: -1 });

export const REPORT_REASONS = REASONS;

const PinReport = mongoose.model('PinReport', pinReportSchema);
export default PinReport;
