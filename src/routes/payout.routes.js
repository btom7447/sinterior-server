import { Router } from 'express';
import { body, param } from 'express-validator';
import { protect, restrictTo } from '../middleware/auth.js';
import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/AppError.js';
import validate from '../middleware/validate.js';
import PayoutRequest from '../models/PayoutRequest.js';
import BankAccount from '../models/BankAccount.js';
import Wallet from '../models/Wallet.js';
import Profile from '../models/Profile.js';
import PlatformSetting from '../models/PlatformSetting.js';
import { debitPayout } from '../services/wallet.service.js';

const router = Router();
router.use(protect, restrictTo('artisan', 'supplier'));

// POST /api/v1/payouts — request a payout
router.post(
  '/',
  [
    body('amount').isFloat({ min: 0 }).withMessage('amount in kobo required'),
    body('bankAccountId').isMongoId(),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const profile = await Profile.findOne({ userId: req.user.id });
    if (!profile) throw new AppError('Profile not found.', 404);

    const wallet = await Wallet.findOrCreate(profile._id);
    const cfg = await PlatformSetting.getPaymentConfig();

    // Cumulative gates — return the most informative reason first.
    // Note: availableBalance check is advisory here; the atomic debit below
    // is the real guard against TOCTOU under concurrent requests.
    if (cfg.globalPayoutsPaused) {
      throw new AppError('Payouts are temporarily paused on the platform. Try again shortly.', 400);
    }
    if (wallet.withdrawalsPaused) {
      throw new AppError(wallet.pauseReason || 'Your payouts are paused. Contact admin.', 400);
    }
    if (wallet.availableBalance < 0) {
      throw new AppError('Your wallet is in the red. Clear the negative balance before requesting a payout.', 400);
    }

    const minPayout = wallet.customMinPayoutKobo ?? cfg.minPayoutKobo;
    const amount = Math.floor(Number(req.body.amount));
    if (!Number.isFinite(amount) || amount < 1) {
      throw new AppError('Invalid payout amount.', 400);
    }
    if (amount < minPayout) {
      throw new AppError(`Minimum payout is ₦${(minPayout / 100).toLocaleString('en-NG')}.`, 400);
    }

    const account = await BankAccount.findOne({
      _id: req.body.bankAccountId,
      profileId: profile._id,
    });
    if (!account) throw new AppError('Bank account not found.', 404);

    // Atomic debit — only succeeds if availableBalance still covers amount and
    // payouts aren't paused. Concurrent requests can't both pass.
    try {
      await debitPayout({ profileId: profile._id, amount, referenceId: null });
    } catch (err) {
      if (err.code === 'INSUFFICIENT_BALANCE') {
        throw new AppError('Insufficient available balance.', 400);
      }
      throw err;
    }

    // Schedule the cooldown — admin can override to release earlier.
    const cooldownHours = wallet.customPayoutReviewHours ?? cfg.payoutReviewHours;
    const scheduledFor = new Date(Date.now() + cooldownHours * 60 * 60 * 1000);

    const payout = await PayoutRequest.create({
      profileId: profile._id,
      bankAccountId: account._id,
      amount,
      status: 'pending',
      scheduledFor,
    });

    res.status(201).json({
      success: true,
      data: { payout },
      message: `Payout queued. Funds will be sent to your bank in ~${cooldownHours}h.`,
    });
  })
);

// GET /api/v1/payouts/me
router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const profile = await Profile.findOne({ userId: req.user.id });
    if (!profile) throw new AppError('Profile not found.', 404);
    const payouts = await PayoutRequest.find({ profileId: profile._id })
      .sort({ createdAt: -1 })
      .populate('bankAccountId', 'accountNumber bankName accountName')
      .lean();
    res.json({ success: true, data: { payouts } });
  })
);

// GET /api/v1/payouts/:id
router.get(
  '/:id',
  [param('id').isMongoId()],
  validate,
  asyncHandler(async (req, res) => {
    const profile = await Profile.findOne({ userId: req.user.id });
    if (!profile) throw new AppError('Profile not found.', 404);
    const payout = await PayoutRequest.findOne({
      _id: req.params.id,
      profileId: profile._id,
    }).populate('bankAccountId', 'accountNumber bankName accountName');
    if (!payout) throw new AppError('Payout not found.', 404);
    res.json({ success: true, data: { payout } });
  })
);

export default router;
