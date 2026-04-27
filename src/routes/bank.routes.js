import { Router } from 'express';
import { body } from 'express-validator';
import { protect, restrictTo } from '../middleware/auth.js';
import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/AppError.js';
import validate from '../middleware/validate.js';
import BankAccount from '../models/BankAccount.js';
import PayoutRequest from '../models/PayoutRequest.js';
import Profile from '../models/Profile.js';
import {
  listBanks as paystackListBanks,
  resolveAccount as paystackResolveAccount,
  createTransferRecipient,
} from '../utils/paystack.js';

const router = Router();

// In-memory bank list cache. Paystack rarely updates this — 24h is fine.
let banksCache = null;
let banksCachedAt = 0;
const BANKS_TTL_MS = 24 * 60 * 60 * 1000;

// GET /api/v1/banks — public list of NG banks
router.get(
  '/banks',
  protect,
  asyncHandler(async (_req, res) => {
    if (!banksCache || Date.now() - banksCachedAt > BANKS_TTL_MS) {
      banksCache = await paystackListBanks();
      banksCachedAt = Date.now();
    }
    // Return only the fields the UI needs.
    const banks = banksCache.map((b) => ({
      name: b.name,
      code: b.code,
      slug: b.slug,
    }));
    res.json({ success: true, data: { banks } });
  })
);

// GET /api/v1/banks/resolve?accountNumber=...&bankCode=...
router.get(
  '/banks/resolve',
  protect,
  asyncHandler(async (req, res) => {
    const { accountNumber, bankCode } = req.query;
    if (!accountNumber || !bankCode) {
      throw new AppError('accountNumber and bankCode are required.', 400);
    }
    const data = await paystackResolveAccount({ accountNumber, bankCode });
    res.json({
      success: true,
      data: {
        accountNumber: data.account_number,
        accountName: data.account_name,
      },
    });
  })
);

// POST /api/v1/bank-accounts — save (creates Paystack recipient)
router.post(
  '/bank-accounts',
  protect,
  restrictTo('artisan', 'supplier'),
  [
    body('accountNumber').isString().trim().isLength({ min: 8, max: 20 }),
    body('bankCode').isString().trim().notEmpty(),
    body('bankName').isString().trim().notEmpty(),
    body('isDefault').optional().isBoolean(),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const profile = await Profile.findOne({ userId: req.user.id });
    if (!profile) throw new AppError('Profile not found.', 404);

    const { accountNumber, bankCode, bankName, isDefault } = req.body;

    // Re-resolve the account name server-side so we can't be tricked by a
    // forged client-side `accountName`.
    const resolved = await paystackResolveAccount({ accountNumber, bankCode });

    // Soft KYC check — flag if the bank's account name doesn't share at least
    // one meaningful token with the profile name. Doesn't block (legitimate
    // mismatches happen: marriage, business names, etc.) but admin can review.
    const norm = (s) => (s || '')
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3);
    const profileTokens = new Set(norm(profile.fullName));
    const accountTokens = norm(resolved.account_name);
    const overlap = accountTokens.some((t) => profileTokens.has(t));
    const nameMismatch = profileTokens.size > 0 && !overlap;

    // Create the Paystack recipient — reusable handle for transfers.
    const recipient = await createTransferRecipient({
      name: resolved.account_name,
      accountNumber,
      bankCode,
    });

    // If isDefault is being set true, demote any existing default first.
    if (isDefault) {
      await BankAccount.updateMany(
        { profileId: profile._id, isDefault: true },
        { isDefault: false }
      );
    }

    let account;
    try {
      account = await BankAccount.create({
        profileId: profile._id,
        accountNumber,
        accountName: resolved.account_name,
        bankCode,
        bankName,
        paystackRecipientCode: recipient.recipient_code,
        isDefault: !!isDefault,
        nameMismatch,
      });
    } catch (err) {
      // E11000 — duplicate (profileId, accountNumber, bankCode) already exists.
      if (err.code === 11000) {
        throw new AppError('You have already saved this bank account.', 409);
      }
      throw err;
    }

    res.status(201).json({
      success: true,
      data: { account, nameMismatch },
      message: nameMismatch
        ? "Saved. The bank's account name didn't match your profile name — admin may follow up."
        : 'Saved.',
    });
  })
);

// GET /api/v1/bank-accounts/me — list own
router.get(
  '/bank-accounts/me',
  protect,
  restrictTo('artisan', 'supplier'),
  asyncHandler(async (req, res) => {
    const profile = await Profile.findOne({ userId: req.user.id });
    if (!profile) throw new AppError('Profile not found.', 404);
    const accounts = await BankAccount.find({ profileId: profile._id })
      .sort({ isDefault: -1, createdAt: -1 })
      .lean();
    res.json({ success: true, data: { accounts } });
  })
);

// DELETE /api/v1/bank-accounts/:id — block if pending payouts use it
router.delete(
  '/bank-accounts/:id',
  protect,
  restrictTo('artisan', 'supplier'),
  asyncHandler(async (req, res) => {
    const profile = await Profile.findOne({ userId: req.user.id });
    if (!profile) throw new AppError('Profile not found.', 404);

    const account = await BankAccount.findOne({ _id: req.params.id, profileId: profile._id });
    if (!account) throw new AppError('Bank account not found.', 404);

    const blocking = await PayoutRequest.countDocuments({
      bankAccountId: account._id,
      status: { $in: ['pending', 'processing'] },
    });
    if (blocking > 0) {
      throw new AppError('Cannot remove — there are pending or processing payouts on this account.', 400);
    }

    await account.deleteOne();
    res.json({ success: true, message: 'Bank account removed.' });
  })
);

export default router;
