// Hourly cron — picks up pending payouts whose cooldown has elapsed and fires
// the Paystack transfer. The wallet was already debited at request time, so
// failure here triggers a `transfer.failed` webhook → `reversePayout` puts
// the funds back.

import PayoutRequest from '../models/PayoutRequest.js';
import BankAccount from '../models/BankAccount.js';
import Wallet from '../models/Wallet.js';
import { initiateTransfer } from '../utils/paystack.js';
import PlatformSetting from '../models/PlatformSetting.js';
import { reversePayout } from '../services/wallet.service.js';

export const runProcessPayoutCooldown = async () => {
  const cfg = await PlatformSetting.getPaymentConfig();
  if (cfg.globalPayoutsPaused) {
    console.log('[cron processPayoutCooldown] global pause active — skipping');
    return 0;
  }

  const now = new Date();
  const due = await PayoutRequest.find({
    status: 'pending',
    scheduledFor: { $lte: now },
  }).populate('bankAccountId');

  let processed = 0;
  for (const payout of due) {
    // Per-seller pause / negative balance gate — re-check now in case admin
    // toggled state between request and cooldown elapse.
    const wallet = await Wallet.findOrCreate(payout.profileId);
    if (wallet.withdrawalsPaused || wallet.availableBalance < 0) {
      // Defer — leave it pending. Don't reverse the wallet debit; admin can
      // manually cancel + refund if they want to abort.
      console.warn(
        `[cron processPayoutCooldown] payout ${payout._id} skipped — wallet paused or negative`
      );
      continue;
    }

    // Atomic claim — flip pending → processing in one shot so a parallel cron
    // tick (multi-instance deploy) can't pick the same row. If the update
    // misses (already processing/completed/etc), skip.
    const claimed = await PayoutRequest.findOneAndUpdate(
      { _id: payout._id, status: 'pending' },
      { status: 'processing' },
      { new: true }
    );
    if (!claimed) {
      continue;
    }

    if (!payout.bankAccountId?.paystackRecipientCode) {
      claimed.status = 'failed';
      claimed.failureReason = 'Bank account missing Paystack recipient code.';
      claimed.processedAt = new Date();
      await claimed.save();
      await reversePayout({
        profileId: claimed.profileId,
        amount: claimed.amount,
        referenceId: claimed._id,
      });
      processed += 1;
      continue;
    }

    try {
      // Stable reference — Paystack treats repeat calls with the same reference
      // as the same transfer (no duplicate disbursement). Re-runs are safe.
      const reference = `payout_${payout._id}`;
      const transfer = await initiateTransfer({
        amount: payout.amount,
        recipientCode: payout.bankAccountId.paystackRecipientCode,
        reference,
        reason: `Sintherior payout ${payout._id.toString().slice(-6)}`,
      });
      claimed.paystackTransferCode = transfer.transfer_code;
      claimed.paystackTransferReference = transfer.reference || reference;
      claimed.processedAt = new Date();
      await claimed.save();
      processed += 1;
      continue;
    } catch (err) {
      console.error(
        `[cron processPayoutCooldown] transfer failed for ${claimed._id}:`,
        err.message
      );
      claimed.status = 'failed';
      claimed.failureReason = err.message;
      claimed.processedAt = new Date();
      await claimed.save();
      // Refund the wallet since the transfer never went out.
      await reversePayout({
        profileId: claimed.profileId,
        amount: claimed.amount,
        referenceId: claimed._id,
      });
    }
  }

  if (processed > 0) {
    console.log(`[cron processPayoutCooldown] processed ${processed} payouts`);
  }
  return processed;
};
