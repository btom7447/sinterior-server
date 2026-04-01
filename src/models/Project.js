import mongoose from 'mongoose';

const projectSchema = new mongoose.Schema(
  {
    clientId: {
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
      maxlength: 3000,
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
    status: {
      type: String,
      enum: ['planning', 'in_progress', 'completed', 'on_hold'],
      default: 'planning',
    },
    startDate: Date,
    endDate: Date,
    artisans: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Profile',
      },
    ],
  },
  { timestamps: true }
);

projectSchema.index({ clientId: 1, status: 1 });
projectSchema.index({ createdAt: -1 });

const Project = mongoose.model('Project', projectSchema);
export default Project;
