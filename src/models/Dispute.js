import mongoose from 'mongoose';

const disputeSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['order', 'job'],
      required: true,
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
    },
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Job',
    },
    raisedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Profile',
      required: true,
    },
    against: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Profile',
      required: true,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    status: {
      type: String,
      enum: ['open', 'under_review', 'resolved', 'dismissed'],
      default: 'open',
    },
    adminNote: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    resolution: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    resolvedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

disputeSchema.index({ status: 1, createdAt: -1 });
disputeSchema.index({ raisedBy: 1 });
disputeSchema.index({ against: 1 });

const Dispute = mongoose.model('Dispute', disputeSchema);
export default Dispute;
