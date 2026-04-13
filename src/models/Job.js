import mongoose from 'mongoose';

const jobSchema = new mongoose.Schema(
  {
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Profile',
      required: true,
    },
    artisanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Profile',
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    budget: {
      type: Number,
      min: 0,
    },
    location: {
      type: String,
      trim: true,
      maxlength: 200,
    },
    state: {
      type: String,
      trim: true,
      maxlength: 50,
    },
    city: {
      type: String,
      trim: true,
      maxlength: 80,
    },
    appointmentDate: {
      type: Date,
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'in_progress', 'completed', 'cancelled'],
      default: 'pending',
    },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'failed'],
      default: 'pending',
    },
    startDate: Date,
    endDate: Date,
  },
  { timestamps: true }
);

jobSchema.index({ artisanId: 1, status: 1 });
jobSchema.index({ clientId: 1, status: 1 });
jobSchema.index({ createdAt: -1 });

const Job = mongoose.model('Job', jobSchema);
export default Job;
