// Daily cron — auto-accepts paid + completed jobs the client never explicitly
// accepted, after the configured workAcceptanceDays grace period. Triggers
// the same escrow release as a manual accept. Skipped if there's an open
// dispute on the job (admin will resolve it).

import Job from '../models/Job.js';
import EscrowEntry from '../models/EscrowEntry.js';
import Dispute from '../models/Dispute.js';
import Notification from '../models/Notification.js';
import PlatformSetting from '../models/PlatformSetting.js';
import Profile from '../models/Profile.js';
import { releaseEscrow } from '../services/wallet.service.js';

export const runAutoAcceptJobs = async () => {
  const cfg = await PlatformSetting.getPaymentConfig();
  const now = new Date();

  // Use the explicit `workAutoAcceptAt` field set when escrow was created.
  // Falls back to a `updatedAt`-derived cutoff for legacy rows that pre-date
  // the field — those jobs would otherwise never auto-accept.
  const fallbackCutoff = new Date(now.getTime() - cfg.workAcceptanceDays * 24 * 60 * 60 * 1000);

  const candidates = await Job.find({
    status: 'completed',
    paymentStatus: 'paid',
    workAccepted: { $ne: true },
    $or: [
      { workAutoAcceptAt: { $lte: now } },
      { workAutoAcceptAt: { $exists: false }, updatedAt: { $lte: fallbackCutoff } },
    ],
  });

  let accepted = 0;
  for (const job of candidates) {
    // Skip if there's an open dispute — admin handles it.
    const openDispute = await Dispute.findOne({
      type: 'job',
      jobId: job._id,
      status: { $in: ['open', 'under_review'] },
    });
    if (openDispute) continue;

    // Atomic claim on the job — flip workAccepted from unset/false → true.
    // Prevents two cron instances from racing on the same job.
    const claimedJob = await Job.findOneAndUpdate(
      { _id: job._id, workAccepted: { $ne: true } },
      { workAccepted: true, workAcceptedAt: new Date() },
      { new: true }
    );
    if (!claimedJob) continue;

    const entry = await EscrowEntry.findOneAndUpdate(
      { entityType: 'job', entityId: job._id, status: 'held' },
      { status: 'released', releasedAt: new Date() },
      { new: true }
    );
    if (entry) {
      const { feeAmount, netAmount } = await releaseEscrow({
        sellerProfileId: entry.sellerProfileId,
        amount: entry.amount,
        source: 'job',
        referenceId: job._id,
      });
      entry.feeAmount = feeAmount;
      entry.netAmount = netAmount;
      await entry.save();
    }

    // Notify client + artisan that auto-acceptance happened.
    const [client, artisan] = await Promise.all([
      Profile.findById(job.clientId).select('userId'),
      Profile.findById(job.artisanId).select('userId'),
    ]);
    if (artisan?.userId) {
      await Notification.create({
        userId: artisan.userId,
        title: 'Work auto-accepted',
        body: `"${job.title}" was auto-accepted after the review window expired. Funds released to your wallet.`,
        type: 'job',
        data: { jobId: job._id },
      });
    }
    if (client?.userId) {
      await Notification.create({
        userId: client.userId,
        title: 'Job auto-accepted',
        body: `"${job.title}" was automatically marked accepted after the review window. The artisan has been paid.`,
        type: 'job',
        data: { jobId: job._id },
      });
    }
    accepted += 1;
  }

  if (accepted > 0) {
    console.log(`[cron autoAcceptJobs] auto-accepted ${accepted} jobs`);
  }
  return accepted;
};
