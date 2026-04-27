import mongoose from 'mongoose';

// Distributed lock for cron jobs. Multi-instance deploys (Render >1 instance,
// kubernetes replicas, etc.) all share one MongoDB — so we coordinate cron
// firing through unique-index-backed leases.
//
// Pattern: each cron run does findOneAndUpdate({ name, expiresAt: { $lte: now } | none })
// with $set: { expiresAt: now + lease, ownedBy }. If the result is non-null,
// we hold the lease and run; otherwise another instance has it, we skip.
//
// `expiresAt` doubles as a TTL via the Mongo TTL monitor — leases auto-expire
// even if the holder crashes mid-run.
const cronLockSchema = new mongoose.Schema(
  {
    // Cron job identifier (e.g. 'expireHoldPeriod', 'invoiceScheduledFees').
    name: { type: String, required: true, unique: true, index: true },
    // Hostname / pid of the holder — purely for debugging.
    ownedBy: { type: String },
    // Lease expiry. The TTL index removes stale leases automatically so a
    // crashed holder doesn't block forever.
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  },
  { timestamps: true }
);

const CronLock = mongoose.model('CronLock', cronLockSchema);
export default CronLock;
