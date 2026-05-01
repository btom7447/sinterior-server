import crypto from 'crypto';
import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/AppError.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { initializeTransaction, verifyTransaction } from '../utils/paystack.js';
import Order from '../models/Order.js';
import Job from '../models/Job.js';
import Profile from '../models/Profile.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import { emitNotification } from '../utils/emitNotification.js';
import { sendEmailSafe } from '../utils/sendEmail.js';
import { paymentReceiptOrder, paymentReceiptJob } from '../utils/emailTemplates.js';
import config from '../config/env.js';
import EscrowEntry from '../models/EscrowEntry.js';
import PayoutRequest from '../models/PayoutRequest.js';
import PlatformSetting from '../models/PlatformSetting.js';
import { creditEscrow, reversePayout } from '../services/wallet.service.js';

// Convert NGN amount (whole units stored on Order/Job) to kobo for the wallet ledger.
const toKobo = (ngn) => Math.round(ngn * 100);

// Idempotently create escrow entries for a paid entity. Splits orders by supplier.
// Per-(paystackReference, sellerProfileId) uniqueness is enforced at the model
// level — duplicate creates here race-safely throw E11000 which we swallow.
const createEscrowFor = async ({ type, entityId, paystackReference }) => {
  if (type === 'order') {
    const order = await Order.findById(entityId);
    if (!order) return [];

    // Group items by supplierId — one EscrowEntry per supplier on multi-supplier orders.
    const bySupplier = new Map();
    for (const item of order.items) {
      const sid = item.supplierId.toString();
      const lineTotal = item.priceAtOrder * item.quantity;
      bySupplier.set(sid, (bySupplier.get(sid) || 0) + lineTotal);
    }

    const entries = [];
    for (const [supplierId, ngnAmount] of bySupplier) {
      const amountKobo = toKobo(ngnAmount);
      let entry;
      try {
        entry = await EscrowEntry.create({
          entityType: 'order',
          entityId: order._id,
          buyerProfileId: order.buyerId,
          sellerProfileId: supplierId,
          amount: amountKobo,
          paystackReference,
        });
      } catch (err) {
        // Unique-index violation on (paystackReference, sellerProfileId) means
        // a concurrent verify+webhook already inserted it. Pick up the existing
        // doc and skip the credit (it was already applied).
        if (err.code === 11000) {
          entry = await EscrowEntry.findOne({ paystackReference, sellerProfileId: supplierId });
          if (entry) entries.push(entry);
          continue;
        }
        throw err;
      }
      await creditEscrow({
        sellerProfileId: supplierId,
        amount: amountKobo,
        referenceId: order._id,
        source: 'order',
        description: `Escrow held for order #${order._id.toString().slice(-8).toUpperCase()}`,
      });
      entries.push(entry);
    }

    // Track the first entry id on the order for backwards reference (multi-supplier
    // orders link via EscrowEntry.entityId — readers must walk EscrowEntry, not this).
    if (entries.length > 0 && !order.escrowEntryId) {
      order.escrowEntryId = entries[0]._id;
      await order.save();
    }
    return entries;
  }

  if (type === 'job') {
    const job = await Job.findById(entityId);
    if (!job) return [];
    const ngnAmount = job.totalAmount && job.totalAmount > 0 ? job.totalAmount : job.budget;
    if (!ngnAmount || ngnAmount <= 0) return [];

    const amountKobo = toKobo(ngnAmount);
    let entry;
    try {
      entry = await EscrowEntry.create({
        entityType: 'job',
        entityId: job._id,
        buyerProfileId: job.clientId,
        sellerProfileId: job.artisanId,
        amount: amountKobo,
        paystackReference,
      });
    } catch (err) {
      if (err.code === 11000) {
        // Already created by a racing verify+webhook. Don't double-credit.
        const existing = await EscrowEntry.findOne({ paystackReference, sellerProfileId: job.artisanId });
        return existing ? [existing] : [];
      }
      throw err;
    }
    await creditEscrow({
      sellerProfileId: job.artisanId,
      amount: amountKobo,
      referenceId: job._id,
      source: 'job',
      description: `Escrow held for job "${job.title}"`,
    });

    // Wire the auto-accept deadline so the cron can fire it. Read live config so
    // admin's PlatformSetting changes take effect immediately.
    const cfg = await PlatformSetting.getPaymentConfig();
    const days = cfg.workAcceptanceDays || 7;
    job.escrowEntryId = entry._id;
    job.workAutoAcceptAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    await job.save();
    return [entry];
  }

  return [];
};

/**
 * POST /api/v1/payments/initialize
 * Body: { type: "order" | "job", entityId: string }
 * Initializes a Paystack transaction for the given order or job.
 */
export const initialize = asyncHandler(async (req, res) => {
  const { type, entityId } = req.body;

  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) throw new AppError('Profile not found.', 404);

  const user = await User.findById(req.user.id).select('email');
  if (!user) throw new AppError('User not found.', 404);

  let amount;
  let reference;

  if (type === 'order') {
    const order = await Order.findById(entityId);
    if (!order) throw new AppError('Order not found.', 404);
    if (order.buyerId.toString() !== profile._id.toString()) {
      throw new AppError('Not authorised.', 403);
    }
    if (order.paymentStatus === 'paid') {
      throw new AppError('Order is already paid.', 400);
    }
    amount = order.totalAmount;
    reference = `order_${entityId}_${Date.now()}`;
  } else if (type === 'job') {
    const job = await Job.findById(entityId);
    if (!job) throw new AppError('Job not found.', 404);
    if (job.clientId.toString() !== profile._id.toString()) {
      throw new AppError('Not authorised.', 403);
    }
    if (!['accepted', 'in_progress', 'completed'].includes(job.status)) {
      throw new AppError('Job must be accepted before payment.', 400);
    }
    if (job.paymentStatus === 'paid') {
      throw new AppError('Job is already paid.', 400);
    }
    amount = job.totalAmount && job.totalAmount > 0 ? job.totalAmount : job.budget;
    if (!amount || amount <= 0) {
      throw new AppError('Job has no payable amount.', 400);
    }
    reference = `job_${entityId}_${Date.now()}`;
  } else {
    throw new AppError('type must be "order" or "job".', 400);
  }

  const callbackUrl = `${config.CLIENT_APP_URL}/payment/verify?reference=${reference}`;

  const paystack = await initializeTransaction({
    email: user.email,
    amount,
    reference,
    metadata: { type, entityId, userId: req.user.id },
    callback_url: callbackUrl,
  });

  sendSuccess(res, {
    authorization_url: paystack.authorization_url,
    reference: paystack.reference,
  }, 'Payment initialized.');
});

/**
 * GET /api/v1/payments/verify?reference=xxx
 * Verifies a Paystack transaction and updates the order/job payment status.
 */
export const verify = asyncHandler(async (req, res) => {
  const { reference } = req.query;
  if (!reference) throw new AppError('reference query param is required.', 400);

  const txn = await verifyTransaction(reference);

  if (txn.status !== 'success') {
    return sendSuccess(res, { status: txn.status }, 'Payment not successful.');
  }

  const { type, entityId } = txn.metadata || {};

  // Defence-in-depth: verify the charged amount matches what the entity actually
  // costs. Paystack's amount is in kobo. If it doesn't match, do NOT mark paid —
  // surface as 400 so admin can investigate the discrepancy.
  if (type === 'order') {
    const orderForCheck = await Order.findById(entityId).select('totalAmount paymentStatus');
    if (!orderForCheck) throw new AppError('Order not found.', 404);
    const expectedKobo = toKobo(orderForCheck.totalAmount);
    if (Number(txn.amount) !== expectedKobo) {
      throw new AppError(
        `Paid amount (${txn.amount} kobo) does not match order total (${expectedKobo} kobo).`,
        400
      );
    }
  } else if (type === 'job') {
    const jobForCheck = await Job.findById(entityId).select('totalAmount budget paymentStatus');
    if (!jobForCheck) throw new AppError('Job not found.', 404);
    const expectedNgn = jobForCheck.totalAmount && jobForCheck.totalAmount > 0
      ? jobForCheck.totalAmount
      : jobForCheck.budget;
    const expectedKobo = toKobo(expectedNgn);
    if (Number(txn.amount) !== expectedKobo) {
      throw new AppError(
        `Paid amount (${txn.amount} kobo) does not match job total (${expectedKobo} kobo).`,
        400
      );
    }
  }

  if (type === 'order') {
    const order = await Order.findByIdAndUpdate(
      entityId,
      { paymentStatus: 'paid', paymentMethod: 'Card Payment' },
      { new: true }
    ).populate('buyerId', 'userId fullName');
    if (order) {
      // Create escrow entries (idempotent — uses paystackReference dedupe).
      await createEscrowFor({ type: 'order', entityId: order._id, paystackReference: reference });

      // Notify supplier(s) — money is held in escrow, not yet released.
      const supplierIds = [...new Set(order.items.map((i) => i.supplierId.toString()))];
      for (const sid of supplierIds) {
        const supplierProfile = await Profile.findById(sid).select('userId');
        if (supplierProfile) {
          const n = await Notification.create({
            userId: supplierProfile.userId,
            title: 'Payment received — held in escrow',
            body: `Payment received for order #${order._id.toString().slice(-8).toUpperCase()}. Funds release to your wallet once delivery is confirmed.`,
            type: 'order',
            data: { orderId: order._id },
          });
          emitNotification(req, n);
        }
      }

      if (order.buyerId?.userId) {
        const buyerUser = await User.findById(order.buyerId.userId).select('email');
        if (buyerUser?.email) {
          const { subject, html } = paymentReceiptOrder({ order });
          sendEmailSafe({ to: buyerUser.email, subject, html });
        }
      }
    }
  } else if (type === 'job') {
    const job = await Job.findById(entityId)
      .populate('artisanId', 'userId fullName')
      .populate('clientId', 'userId fullName');
    if (job) {
      job.paymentStatus = 'paid';
      await job.save();

      // Create escrow entry. Released only when client clicks "Accept work".
      await createEscrowFor({ type: 'job', entityId: job._id, paystackReference: reference });

      if (job.artisanId?.userId) {
        const n = await Notification.create({
          userId: job.artisanId.userId,
          title: 'Payment received — held in escrow',
          body: `Payment received for "${job.title}". Funds release once the client accepts the work.`,
          type: 'job',
          data: { jobId: job._id },
        });
        emitNotification(req, n);
      }

      if (job.clientId?.userId) {
        const clientUser = await User.findById(job.clientId.userId).select('email');
        if (clientUser?.email) {
          const { subject, html } = paymentReceiptJob({ job });
          sendEmailSafe({ to: clientUser.email, subject, html });
        }
      }
    }
  }

  sendSuccess(res, { status: 'success', type, entityId }, 'Payment verified.');
});

/**
 * POST /api/v1/payments/webhook
 * Paystack webhook handler — verifies signature on the raw body bytes, then
 * parses. The route uses express.raw so `req.body` is a Buffer here.
 */
export const webhook = asyncHandler(async (req, res) => {
  // req.body is a Buffer because the route is mounted with express.raw.
  // Hash the exact bytes Paystack signed.
  const rawBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
  const hash = crypto
    .createHmac('sha512', config.PAYSTACK_SECRET_KEY)
    .update(rawBuffer)
    .digest('hex');

  if (hash !== req.headers['x-paystack-signature']) {
    throw new AppError('Invalid webhook signature.', 400);
  }

  let parsed;
  try {
    parsed = JSON.parse(rawBuffer.toString('utf8'));
  } catch {
    throw new AppError('Invalid webhook body.', 400);
  }
  const { event, data } = parsed;

  if (event === 'charge.success') {
    const { type, entityId } = data.metadata || {};
    const paystackReference = data.reference;

    // Verify amount matches before marking paid — same guard as /verify.
    if (type === 'order') {
      const order = await Order.findById(entityId).select('totalAmount');
      if (!order) {
        return res.status(200).json({ received: true, ignored: 'order not found' });
      }
      const expectedKobo = toKobo(order.totalAmount);
      if (Number(data.amount) !== expectedKobo) {
        console.warn(
          `[webhook charge.success] amount mismatch for order ${entityId}: paid ${data.amount}, expected ${expectedKobo}`
        );
        return res.status(200).json({ received: true, ignored: 'amount mismatch' });
      }
      await Order.findByIdAndUpdate(entityId, { paymentStatus: 'paid', paymentMethod: 'Card Payment' });
      // Idempotent — won't double-create if verify already ran.
      await createEscrowFor({ type: 'order', entityId, paystackReference });
    } else if (type === 'job') {
      const job = await Job.findById(entityId).select('totalAmount budget');
      if (!job) {
        return res.status(200).json({ received: true, ignored: 'job not found' });
      }
      const expectedNgn = job.totalAmount && job.totalAmount > 0 ? job.totalAmount : job.budget;
      const expectedKobo = toKobo(expectedNgn);
      if (Number(data.amount) !== expectedKobo) {
        console.warn(
          `[webhook charge.success] amount mismatch for job ${entityId}: paid ${data.amount}, expected ${expectedKobo}`
        );
        return res.status(200).json({ received: true, ignored: 'amount mismatch' });
      }
      await Job.findByIdAndUpdate(entityId, { paymentStatus: 'paid' });
      await createEscrowFor({ type: 'job', entityId, paystackReference });
    }
  }

  // ── Transfer events (payouts) ─────────────────────────────────────────────
  // The cooldown cron initiated a transfer; Paystack settles asynchronously
  // and tells us the outcome here. We dedupe by paystackTransferReference so
  // a re-fired webhook doesn't double-process.
  if (event === 'transfer.success') {
    const ref = data.reference;
    const payout = await PayoutRequest.findOne({ paystackTransferReference: ref });
    if (payout && payout.status !== 'completed') {
      payout.status = 'completed';
      payout.processedAt = new Date();
      await payout.save();

      // Notify seller
      const sellerProfile = await Profile.findById(payout.profileId).select('userId');
      if (sellerProfile?.userId) {
        const n = await Notification.create({
          userId: sellerProfile.userId,
          title: 'Payout completed',
          body: `₦${(payout.amount / 100).toLocaleString('en-NG')} has been sent to your bank account.`,
          type: 'payout',
          data: { payoutId: payout._id },
        });
        emitNotification(req, n);
      }
    }
  }

  if (event === 'transfer.failed' || event === 'transfer.reversed') {
    const ref = data.reference;
    const payout = await PayoutRequest.findOne({ paystackTransferReference: ref });
    if (payout && !['failed', 'cancelled'].includes(payout.status)) {
      payout.status = 'failed';
      payout.failureReason =
        data.reason || data.gateway_response || 'Transfer failed at Paystack';
      payout.processedAt = new Date();
      await payout.save();

      // Refund the wallet — the user can retry.
      await reversePayout({
        profileId: payout.profileId,
        amount: payout.amount,
        referenceId: payout._id,
      });

      const sellerProfile = await Profile.findById(payout.profileId).select('userId');
      if (sellerProfile?.userId) {
        const n = await Notification.create({
          userId: sellerProfile.userId,
          title: 'Payout failed',
          body: `Your payout of ₦${(payout.amount / 100).toLocaleString('en-NG')} couldn't be sent. Funds have been returned to your wallet — check the reason and retry.`,
          type: 'payout',
          data: { payoutId: payout._id, reason: payout.failureReason },
        });
        emitNotification(req, n);
      }
    }
  }

  // Paystack expects 200 response
  res.status(200).json({ received: true });
});
