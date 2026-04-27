// Weekly cron — runs on Mondays. For every wallet with feesOwed > 0, deducts
// from `availableBalance` (allowing it to go negative). If insufficient,
// blocks payouts via withdrawalsPaused = true and pings admins.
//
// Triggered cadence is platform-wide; per-seller `feeMode = 'weekly' | 'monthly'`
// could be honoured to skip / batch differently in the future. For MVP, we
// invoice everyone weekly Monday.

import Wallet from '../models/Wallet.js';
import WalletTransaction from '../models/WalletTransaction.js';
import Profile from '../models/Profile.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';

export const runInvoiceScheduledFees = async () => {
  const wallets = await Wallet.find({
    isPlatform: { $ne: true },
    feesOwed: { $gt: 0 },
  });

  let invoiced = 0;
  for (const wallet of wallets) {
    const owed = wallet.feesOwed;
    const available = wallet.availableBalance;

    // How much can we actually pull right now? If they have less than owed,
    // pull what's there and let availableBalance go negative for the rest.
    // The wallet stays flagged as negative → payouts blocked.
    const pulled = owed; // we always settle the full owed (going negative if needed)

    // Build a snapshot before we mutate so the ledger has accurate before/after.
    const debited = await Wallet.findByIdAndUpdate(
      wallet._id,
      {
        $inc: {
          availableBalance: -pulled,
          feesOwed: -pulled,
          totalFeesPaid: pulled,
        },
      },
      { new: true }
    );

    await WalletTransaction.create({
      walletId: wallet._id,
      type: 'fee_invoice',
      amount: -pulled,
      bucket: 'available',
      source: 'platform_fee',
      description: 'Weekly Monday fee invoice',
      balanceSnapshot: {
        pending: debited.pendingBalance,
        holding: debited.holdingBalance,
        available: debited.availableBalance,
        feesOwed: debited.feesOwed,
      },
    });
    // Mirror credit on platform wallet. Read post-update so the snapshot
    // reflects the actual platform state, not zeros.
    const platform = await Wallet.getPlatform();
    const platformAfter = await Wallet.findByIdAndUpdate(
      platform._id,
      { $inc: { availableBalance: pulled } },
      { new: true }
    );
    await WalletTransaction.create({
      walletId: platform._id,
      type: 'platform_fee_in',
      amount: pulled,
      bucket: 'available',
      source: 'platform_fee',
      referenceId: wallet._id,
      description: 'Weekly fee invoice from seller',
      balanceSnapshot: {
        pending: platformAfter.pendingBalance,
        holding: platformAfter.holdingBalance,
        available: platformAfter.availableBalance,
        feesOwed: platformAfter.feesOwed,
      },
    });

    // If the seller went negative, force-pause their payouts and notify.
    if (debited.availableBalance < 0 && !debited.withdrawalsPaused) {
      debited.withdrawalsPaused = true;
      debited.pauseReason = 'Wallet in the red after weekly fee invoice. Settle to resume payouts.';
      await debited.save();
    }

    // Notify the seller + admin if negative.
    const profile = await Profile.findById(wallet.profileId).select('userId fullName');
    if (profile?.userId) {
      const isNegative = debited.availableBalance < 0;
      await Notification.create({
        userId: profile.userId,
        title: isNegative ? 'Fee invoice — wallet in the red' : 'Weekly platform fees deducted',
        body: isNegative
          ? `₦${(pulled / 100).toLocaleString('en-NG')} in platform fees was invoiced. Your balance is now negative — payouts are paused until cleared.`
          : `₦${(pulled / 100).toLocaleString('en-NG')} in platform fees was deducted from your wallet.`,
        type: 'wallet',
        data: { amount: pulled, negative: isNegative },
      });
      if (isNegative) {
        const admins = await User.find({ role: 'admin' }).select('_id');
        for (const admin of admins) {
          await Notification.create({
            userId: admin._id,
            title: 'Seller wallet went negative on fee invoice',
            body: `${profile.fullName || 'Seller'} now has a negative wallet of ₦${Math.abs(debited.availableBalance / 100).toLocaleString('en-NG')}.`,
            type: 'admin',
            data: { profileId: wallet.profileId, amount: debited.availableBalance },
          });
        }
      }
    }

    invoiced += 1;
  }

  if (invoiced > 0) {
    console.log(`[cron invoiceScheduledFees] invoiced ${invoiced} wallets`);
  }
  return invoiced;
};
