// Refund flow — handles both directions:
//   1. Escrow still `held` → easy. Mark refunded, fire Paystack refund.
//   2. Escrow already `released` → pull from seller's wallet (allow negative),
//      fire Paystack refund. Wallet will block payouts until cleared.
//
// `amount` is in kobo. Pass null to refund the full escrow amount.

import EscrowEntry from '../models/EscrowEntry.js';
import Notification from '../models/Notification.js';
import Profile from '../models/Profile.js';
import AppError from '../utils/AppError.js';
import { refundCharge } from '../utils/paystack.js';
import { refundFromSeller, reversePayout } from './wallet.service.js';

export const issueRefund = async ({ escrowEntryId, amount, reason, adminUserId }) => {
  const entry = await EscrowEntry.findById(escrowEntryId);
  if (!entry) throw new AppError('Escrow entry not found.', 404);
  if (entry.status === 'refunded') {
    throw new AppError('Escrow already fully refunded.', 400);
  }

  const refundAmount = amount && amount > 0 ? Math.floor(amount) : entry.amount - (entry.refundedAmount || 0);
  if (refundAmount <= 0) throw new AppError('Refund amount must be positive.', 400);
  if (refundAmount > entry.amount - (entry.refundedAmount || 0)) {
    throw new AppError('Refund exceeds remaining escrow amount.', 400);
  }

  const fullRefund = refundAmount === entry.amount - (entry.refundedAmount || 0);

  // 1. Pull from seller wallet if already released — allow it to go negative.
  let walletDebited = false;
  if (entry.status === 'released') {
    await refundFromSeller({
      profileId: entry.sellerProfileId,
      amount: refundAmount,
      referenceId: entry._id,
      reason: reason || 'Admin refund (post-release)',
    });
    walletDebited = true;
  }
  // If still held, money is in our balance — no seller debit needed.

  // 2. Fire Paystack refund (returns to buyer's card). If this fails, we must
  //    reverse the wallet debit so the seller isn't out money for a refund the
  //    buyer never received.
  if (entry.paystackReference) {
    try {
      await refundCharge({
        transactionReference: entry.paystackReference,
        amount: refundAmount,
        reason: reason || 'Sintherior refund',
      });
    } catch (err) {
      if (walletDebited) {
        // Best-effort rollback. Use reversePayout-style credit back to available.
        try {
          await reversePayout({
            profileId: entry.sellerProfileId,
            amount: refundAmount,
            referenceId: entry._id,
          });
        } catch (rollbackErr) {
          // If rollback also fails, log loudly — admin must fix manually.
          console.error(
            '[refund] CRITICAL: wallet debit not reversed after Paystack failure',
            { entryId: entry._id, refundAmount, paystackErr: err.message, rollbackErr: rollbackErr.message }
          );
        }
      }
      throw new AppError(`Paystack refund failed: ${err.message}`, 502);
    }
  }

  // 3. Update escrow record.
  entry.refundedAmount = (entry.refundedAmount || 0) + refundAmount;
  entry.status = fullRefund ? 'refunded' : 'partially_refunded';
  entry.refundedAt = new Date();
  entry.refundReason = reason || entry.refundReason;
  await entry.save();

  // 4. Notify both parties.
  const [buyer, seller] = await Promise.all([
    Profile.findById(entry.buyerProfileId).select('userId'),
    Profile.findById(entry.sellerProfileId).select('userId fullName'),
  ]);
  if (buyer?.userId) {
    await Notification.create({
      userId: buyer.userId,
      title: fullRefund ? 'Order refunded' : 'Partial refund issued',
      body: `₦${(refundAmount / 100).toLocaleString('en-NG')} has been refunded to your card.${
        reason ? ` Reason: ${reason}` : ''
      }`,
      type: 'order',
      data: { escrowEntryId: entry._id, amount: refundAmount, reason },
    });
  }
  if (seller?.userId) {
    await Notification.create({
      userId: seller.userId,
      title: 'Funds refunded to buyer',
      body: `₦${(refundAmount / 100).toLocaleString('en-NG')} was refunded${
        entry.status === 'released' ? ' from your wallet' : ''
      }.${reason ? ` Reason: ${reason}` : ''}`,
      type: 'order',
      data: { escrowEntryId: entry._id, amount: refundAmount },
    });
  }

  return { refundAmount, entry };
};
