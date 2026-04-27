import { Router } from 'express';
import { protect, restrictTo } from '../middleware/auth.js';
import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/AppError.js';
import Wallet from '../models/Wallet.js';
import WalletTransaction from '../models/WalletTransaction.js';
import EscrowEntry from '../models/EscrowEntry.js';
import Profile from '../models/Profile.js';
import PlatformSetting from '../models/PlatformSetting.js';
import { getPagination, buildPaginationMeta } from '../utils/paginate.js';

const router = Router();
router.use(protect, restrictTo('artisan', 'supplier'));

// GET /api/v1/wallet/me — three-bucket balance + status flags
router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const profile = await Profile.findOne({ userId: req.user.id });
    if (!profile) throw new AppError('Profile not found.', 404);

    const wallet = await Wallet.findOrCreate(profile._id);
    const cfg = await PlatformSetting.getPaymentConfig();
    const minPayout = wallet.customMinPayoutKobo ?? cfg.minPayoutKobo;
    const isNegative = wallet.availableBalance < 0;

    res.json({
      success: true,
      data: {
        wallet: {
          _id: wallet._id,
          pendingBalance: wallet.pendingBalance,
          holdingBalance: wallet.holdingBalance,
          availableBalance: wallet.availableBalance,
          feesOwed: wallet.feesOwed,
          totalEarned: wallet.totalEarned,
          totalPaidOut: wallet.totalPaidOut,
          totalFeesPaid: wallet.totalFeesPaid,
          totalRefunded: wallet.totalRefunded,
          currency: wallet.currency,
          // Status flags
          withdrawalsPaused: wallet.withdrawalsPaused || cfg.globalPayoutsPaused || isNegative,
          pauseReason: wallet.pauseReason,
          isNegative,
          feeMode: wallet.feeMode,
          minPayout,
          holdHours: wallet.customHoldHours ?? cfg.holdHours,
          payoutReviewHours: wallet.customPayoutReviewHours ?? cfg.payoutReviewHours,
        },
      },
    });
  })
);

// GET /api/v1/wallet/me/transactions — paginated ledger
router.get(
  '/me/transactions',
  asyncHandler(async (req, res) => {
    const profile = await Profile.findOne({ userId: req.user.id });
    if (!profile) throw new AppError('Profile not found.', 404);
    const wallet = await Wallet.findOrCreate(profile._id);

    const { page, limit, skip } = getPagination(req.query);
    const filter = { walletId: wallet._id };
    if (req.query.bucket) filter.bucket = req.query.bucket;
    if (req.query.type) filter.type = req.query.type;

    const [transactions, total] = await Promise.all([
      WalletTransaction.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      WalletTransaction.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: { transactions },
      pagination: buildPaginationMeta(total, page, limit),
    });
  })
);

// GET /api/v1/wallet/me/escrow — currently-held entries
router.get(
  '/me/escrow',
  asyncHandler(async (req, res) => {
    const profile = await Profile.findOne({ userId: req.user.id });
    if (!profile) throw new AppError('Profile not found.', 404);

    const entries = await EscrowEntry.find({
      sellerProfileId: profile._id,
      status: 'held',
    })
      .sort({ heldAt: -1 })
      .lean();

    res.json({ success: true, data: { entries } });
  })
);

export default router;
