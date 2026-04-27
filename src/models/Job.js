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

    // ── Booking timing ────────────────────────────────────────────────────────
    // 'urgent'    — client wants the artisan ASAP; no scheduledDate.
    // 'scheduled' — client picks a future date; artisan sees it under
    //               Appointments until that date arrives.
    bookingType: {
      type: String,
      enum: ['urgent', 'scheduled'],
      default: 'urgent',
    },
    scheduledDate: {
      type: Date,
    },
    // Legacy field kept for back-compat with the appointments page (mirrors scheduledDate).
    appointmentDate: {
      type: Date,
    },

    // ── Status machine ────────────────────────────────────────────────────────
    // pending     — request sent to artisan, awaiting accept/reject
    // accepted    — artisan accepted; nothing started yet
    // in_progress — both parties confirmed start; daily billing clock running
    // completed   — both parties confirmed end; payment computed
    // cancelled   — rejected or aborted at any earlier point
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

    // ── Pricing snapshot at hire time ──────────────────────────────────────────
    // We snapshot the artisan's daily rate when the job is created so a later
    // rate change doesn't retroactively bump an in-progress contract.
    dailyRate: {
      type: Number,
      min: 0,
    },

    // ── Dual-approval flags for start (in_progress) and end (completed) ─────
    clientStartApproved: { type: Boolean, default: false },
    artisanStartApproved: { type: Boolean, default: false },
    clientEndApproved: { type: Boolean, default: false },
    artisanEndApproved: { type: Boolean, default: false },

    // Set when both parties have approved start / end — used to compute
    // billable duration and to display timeline on both dashboards.
    startedAt: { type: Date },
    endedAt: { type: Date },

    // Computed at completion: ceil((endedAt - startedAt) / 1 day), min 1.
    daysCharged: { type: Number, min: 0 },
    totalAmount: { type: Number, min: 0 },

    // Legacy compatibility — older rows used these; new rows use startedAt/endedAt.
    startDate: Date,
    endDate: Date,

    // Why a job was cancelled or rejected. Always required from the actor at
    // cancel/reject time so the other party sees what went wrong.
    cancellationReason: { type: String, trim: true, maxlength: 1000 },
    cancelledBy: {
      type: String,
      enum: ['client', 'artisan'],
    },

    // Escrow + work-acceptance fields (Phase 1 of payments work).
    escrowEntryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'EscrowEntry',
    },
    // Client confirms the work meets standard → triggers escrow release.
    workAccepted: { type: Boolean, default: false },
    workAcceptedAt: { type: Date },
    // If client doesn't accept by this time and there's no open dispute,
    // the autoAcceptJobs cron releases automatically.
    workAutoAcceptAt: { type: Date },
  },
  { timestamps: true }
);

jobSchema.index({ artisanId: 1, status: 1 });
jobSchema.index({ clientId: 1, status: 1 });
jobSchema.index({ createdAt: -1 });

const Job = mongoose.model('Job', jobSchema);
export default Job;
