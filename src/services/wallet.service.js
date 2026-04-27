// Single point of truth for wallet mutations. Every credit/debit goes through
// here so balances stay in sync with the ledger and snapshots are consistent.
//
// Public functions are idempotent where possible (the caller passes a unique
// referenceId) but full idempotency guards live in the calling code (e.g. the
// payment verify handler dedupes by paystackReference).

import Wallet from '../models/Wallet.js';
import WalletTransaction from '../models/WalletTransaction.js';
import PlatformSetting from '../models/PlatformSetting.js';

// Map bucket → wallet field. Throwing on an unknown bucket prevents typos
// from silently mutating feesOwed.
const BUCKET_TO_FIELD = {
  pending: 'pendingBalance',
  holding: 'holdingBalance',
  available: 'availableBalance',
  feesOwed: 'feesOwed',
};

// Apply a delta to a single bucket on a wallet, write the ledger entry, return
// the updated wallet. NOT a Mongo transaction — caller wraps if needed.
const applyDelta = async (wallet, bucket, delta, txMeta) => {
  const field = BUCKET_TO_FIELD[bucket];
  if (!field) throw new Error(`Unknown wallet bucket: ${bucket}`);

  // Increment lifetime totals if this is a credit.
  const lifetimeUpdates = {};
  if (txMeta.type === 'fee_deduction' && delta < 0) {
    lifetimeUpdates.totalFeesPaid = -delta;
  }
  if (txMeta.type === 'fee_invoice' && delta < 0) {
    // Weekly fee invoice — counts toward the seller's lifetime fees paid.
    lifetimeUpdates.totalFeesPaid = -delta;
  }
  if (txMeta.type === 'payout' && delta < 0) {
    lifetimeUpdates.totalPaidOut = -delta;
  }
  if (txMeta.type === 'refund_out' && delta < 0) {
    lifetimeUpdates.totalRefunded = -delta;
  }
  if (txMeta.type === 'escrow_release' && delta > 0 && bucket === 'holding') {
    // Hitting the holding bucket on a release is when we count "earned".
    // Note: this is the NET amount (gross - fee). Total earnings include the
    // platform fee separately via `lifetimeFeesAbsorbed` if needed in future.
    lifetimeUpdates.totalEarned = delta;
  }

  const inc = { [field]: delta };
  for (const [key, val] of Object.entries(lifetimeUpdates)) {
    inc[key] = (inc[key] || 0) + val;
  }

  const updated = await Wallet.findByIdAndUpdate(
    wallet._id,
    { $inc: inc },
    { new: true }
  );

  await WalletTransaction.create({
    walletId: wallet._id,
    type: txMeta.type,
    amount: delta,
    bucket,
    source: txMeta.source,
    referenceId: txMeta.referenceId,
    availableAt: txMeta.availableAt,
    description: txMeta.description,
    balanceSnapshot: {
      pending: updated.pendingBalance,
      holding: updated.holdingBalance,
      available: updated.availableBalance,
      feesOwed: updated.feesOwed,
    },
  });

  return updated;
};

// ── Operations ──────────────────────────────────────────────────────────────

// Buyer paid → escrow held → seller's pendingBalance grows.
export const creditEscrow = async ({ sellerProfileId, amount, referenceId, source = 'order', description }) => {
  const wallet = await Wallet.findOrCreate(sellerProfileId);
  return applyDelta(wallet, 'pending', amount, {
    type: 'escrow_credit',
    source,
    referenceId,
    description: description || `Escrow held for ${source}`,
  });
};

// Release condition met. Computes fee, moves pending → holding (with availableAt timer),
// records platform fee in either platform wallet (per_transaction) or seller's feesOwed (scheduled).
export const releaseEscrow = async ({ sellerProfileId, amount, source, referenceId }) => {
  const wallet = await Wallet.findOrCreate(sellerProfileId);
  const cfg = await PlatformSetting.getPaymentConfig();

  // Fee rate by source.
  const bps = source === 'job' ? cfg.jobFeeBps : cfg.orderFeeBps;
  const feeAmount = Math.floor((amount * bps) / 10000);
  const netAmount = amount - feeAmount;

  // Hold window — per-seller override beats platform default.
  const holdHours = wallet.customHoldHours ?? cfg.holdHours;
  const availableAt = new Date(Date.now() + holdHours * 60 * 60 * 1000);

  // 1. Debit pending by full amount (the gross was held there).
  await applyDelta(wallet, 'pending', -amount, {
    type: 'escrow_release',
    source,
    referenceId,
    description: 'Escrow released — moved to holding',
  });

  // 2. Credit holding by net amount.
  const updated = await applyDelta(wallet, 'holding', netAmount, {
    type: 'escrow_release',
    source,
    referenceId,
    availableAt,
    description: `Holding for ${holdHours}h before withdrawable`,
  });

  // 3. Platform fee — per_transaction credits platform wallet now;
  //    scheduled accrues on the seller's feesOwed for weekly invoicing.
  if (feeAmount > 0) {
    if (wallet.feeMode === 'per_transaction') {
      const platformWallet = await Wallet.getPlatform();
      await applyDelta(platformWallet, 'available', feeAmount, {
        type: 'platform_fee_in',
        source,
        referenceId,
        description: `Fee from ${source}`,
      });
      // Track per-transaction fees on the seller's lifetime totals so the
      // dashboard's "fees paid" stat is accurate. Uses Wallet.findByIdAndUpdate
      // directly — this is a stat-only increment, not a balance change.
      await Wallet.findByIdAndUpdate(updated._id, { $inc: { totalFeesPaid: feeAmount } });
    } else {
      await applyDelta(updated, 'feesOwed', feeAmount, {
        type: 'fee_accrue',
        source,
        referenceId,
        description: `Fee accrued (${wallet.feeMode} invoicing)`,
      });
    }
  }

  return { feeAmount, netAmount, availableAt };
};

// Cron promotes holding → available for entries past their availableAt.
//
// Concurrency safety: the aggregation finds candidate `escrow_release` rows with
// no paired `hold_expire`. Two parallel runs could pick up the same row before
// either has written its pair — the cron-lease layer prevents that for the
// hourly tick, but as a second guard we use a distinct `promotionLockId` field
// claimed via findOneAndUpdate. Only the claimant proceeds with the wallet
// mutation; everyone else skips.
export const promoteExpiredHolds = async () => {
  const now = new Date();
  const due = await WalletTransaction.aggregate([
    { $match: { type: 'escrow_release', bucket: 'holding', amount: { $gt: 0 }, availableAt: { $lte: now } } },
    {
      $lookup: {
        from: 'wallettransactions',
        let: { wid: '$walletId', ref: '$referenceId', src: '$source' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$walletId', '$$wid'] },
                  { $eq: ['$referenceId', '$$ref'] },
                  { $eq: ['$source', '$$src'] },
                  { $eq: ['$type', 'hold_expire'] },
                ],
              },
            },
          },
        ],
        as: 'expired',
      },
    },
    { $match: { expired: { $size: 0 } } },
  ]);

  let promoted = 0;
  for (const entry of due) {
    // Atomic claim — flip the source row's `promotedAt` from unset to now.
    // If two crons pick up the same row, only the first claim succeeds.
    const claim = await WalletTransaction.findOneAndUpdate(
      { _id: entry._id, promotedAt: { $exists: false } },
      { $set: { promotedAt: new Date() } },
      { new: true }
    );
    if (!claim) continue;

    const wallet = await Wallet.findById(entry.walletId);
    if (!wallet) continue;
    // Move holding → available. Two ledger rows so the bucket changes are clear.
    await applyDelta(wallet, 'holding', -entry.amount, {
      type: 'hold_expire',
      source: entry.source,
      referenceId: entry.referenceId,
      description: 'Hold period ended',
    });
    await applyDelta(wallet, 'available', entry.amount, {
      type: 'hold_expire',
      source: entry.source,
      referenceId: entry.referenceId,
      description: 'Available for withdrawal',
    });
    promoted += 1;
  }
  return promoted;
};

// Outgoing payout — atomic conditional debit. Returns the updated wallet, or
// throws AppError-compatible 'INSUFFICIENT_BALANCE' if the conditional update
// missed (concurrent payout drained it). Callers must catch and surface as 400.
export const debitPayout = async ({ profileId, amount, referenceId }) => {
  // Ensure wallet exists for this profile (creates on first call).
  await Wallet.findOrCreate(profileId);
  // Atomic check-and-decrement: only succeeds if availableBalance covers amount.
  const updated = await Wallet.findOneAndUpdate(
    { profileId, availableBalance: { $gte: amount }, withdrawalsPaused: { $ne: true } },
    { $inc: { availableBalance: -amount } },
    { new: true }
  );
  if (!updated) {
    const err = new Error('Insufficient available balance for payout.');
    err.code = 'INSUFFICIENT_BALANCE';
    throw err;
  }
  // Write the ledger row. The balance snapshot reflects the post-debit state.
  await WalletTransaction.create({
    walletId: updated._id,
    type: 'payout',
    amount: -amount,
    bucket: 'available',
    source: 'payout',
    referenceId,
    description: 'Payout to bank account',
    balanceSnapshot: {
      pending: updated.pendingBalance,
      holding: updated.holdingBalance,
      available: updated.availableBalance,
      feesOwed: updated.feesOwed,
    },
  });
  return updated;
};

// Reverse a failed payout — credit available back.
export const reversePayout = async ({ profileId, amount, referenceId }) => {
  const wallet = await Wallet.findOrCreate(profileId);
  return applyDelta(wallet, 'available', amount, {
    type: 'payout_reversal',
    source: 'payout',
    referenceId,
    description: 'Payout failed — refunded to wallet',
  });
};

// Refund out — admin force-refund pulls from seller's wallet.
// Tries available first, falls back to holding then pending. Allows negative
// available balance — when that happens we force `withdrawalsPaused = true`
// so the seller's banner + payout route both reflect the state.
//
// Re-reads the wallet between bucket iterations so concurrent refunds can't
// each see the same starting balance and over-pull from the same bucket.
export const refundFromSeller = async ({ profileId, amount, referenceId, reason }) => {
  await Wallet.findOrCreate(profileId);
  let remaining = amount;

  for (const bucket of ['available', 'holding', 'pending']) {
    if (remaining <= 0) break;
    // Re-read so each iteration sees the latest committed state.
    const fresh = await Wallet.findOne({ profileId });
    if (!fresh) throw new Error('Wallet vanished mid-refund.');
    const balance =
      bucket === 'available' ? fresh.availableBalance
      : bucket === 'holding' ? fresh.holdingBalance
      : fresh.pendingBalance;
    if (balance <= 0) continue;
    const take = Math.min(balance, remaining);
    await applyDelta(fresh, bucket, -take, {
      type: 'refund_out',
      source: 'refund',
      referenceId,
      description: reason || 'Admin refund',
    });
    remaining -= take;
  }

  // Still owing? Push the remainder into `available` (allowed to go negative)
  // and pause payouts so the seller can't withdraw while in the red.
  if (remaining > 0) {
    const fresh = await Wallet.findOne({ profileId });
    await applyDelta(fresh, 'available', -remaining, {
      type: 'refund_out',
      source: 'refund',
      referenceId,
      description: reason || 'Admin refund — wallet went negative',
    });
  }

  // After all debits, if available is negative, force-pause payouts and surface
  // a clear pauseReason for the dashboard banner.
  const final = await Wallet.findOne({ profileId });
  if (final && final.availableBalance < 0 && !final.withdrawalsPaused) {
    final.withdrawalsPaused = true;
    final.pauseReason =
      'Wallet negative after refund. Settle the negative balance to resume payouts.';
    await final.save();
  }

  return final;
};

// COD fee accrual — called when a supplier confirms cash on a COD order.
// Money never went through us, so we add the fee to feesOwed and let the
// weekly Monday cron deduct from their online earnings (or escalate to admin).
// Also bumps the seller's lifetime `totalEarned` so dashboard stats reflect
// COD revenue (the cash itself never touches our wallet — this is stat only).
// Returns notification data so the caller can fan out admin alerts on threshold.
export const accrueCodFee = async ({ sellerProfileId, orderAmountKobo, source = 'order', referenceId }) => {
  const wallet = await Wallet.findOrCreate(sellerProfileId);
  const cfg = await PlatformSetting.getPaymentConfig();
  const bps = source === 'job' ? cfg.jobFeeBps : cfg.orderFeeBps;
  const feeAmount = Math.floor((orderAmountKobo * bps) / 10000);
  if (feeAmount <= 0) return { feeAmount: 0, breachedThreshold: false };

  const before = wallet.feesOwed || 0;
  await applyDelta(wallet, 'feesOwed', feeAmount, {
    type: 'fee_accrue',
    source,
    referenceId,
    description: `COD platform fee accrued`,
  });
  // Bump lifetime totalEarned by the gross order amount (cash the seller
  // physically received) — keeps the dashboard "earnings" stat accurate.
  await Wallet.findByIdAndUpdate(wallet._id, { $inc: { totalEarned: orderAmountKobo } });

  const after = before + feeAmount;
  const breachedThreshold = before < cfg.codFeeThresholdKobo && after >= cfg.codFeeThresholdKobo;
  return { feeAmount, breachedThreshold, totalOwed: after };
};

// Manual admin adjustment.
export const adjust = async ({ profileId, amount, bucket = 'available', reason }) => {
  const wallet = profileId
    ? await Wallet.findOrCreate(profileId)
    : await Wallet.getPlatform();
  return applyDelta(wallet, bucket, amount, {
    type: 'adjustment',
    source: 'manual',
    description: reason || 'Manual adjustment',
  });
};
