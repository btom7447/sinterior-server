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
import config from '../config/env.js';

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
    if (!job.budget || job.budget <= 0) {
      throw new AppError('Job has no budget set.', 400);
    }
    amount = job.budget;
    reference = `job_${entityId}_${Date.now()}`;
  } else {
    throw new AppError('type must be "order" or "job".', 400);
  }

  const callbackUrl = `${config.CLIENT_URL}/payment/verify?reference=${reference}`;

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

  if (type === 'order') {
    const order = await Order.findByIdAndUpdate(
      entityId,
      { paymentStatus: 'paid', paymentMethod: 'Card Payment' },
      { new: true }
    );
    if (order) {
      // Notify supplier(s)
      const supplierIds = [...new Set(order.items.map((i) => i.supplierId.toString()))];
      for (const sid of supplierIds) {
        const supplierProfile = await Profile.findById(sid).select('userId');
        if (supplierProfile) {
          const n = await Notification.create({
            userId: supplierProfile.userId,
            title: 'Payment Received',
            body: `Payment of ₦${order.totalAmount.toLocaleString()} received for order #${order._id.toString().slice(-8).toUpperCase()}.`,
            type: 'order',
            data: { orderId: order._id },
          });
          emitNotification(req, n);
        }
      }
    }
  } else if (type === 'job') {
    const job = await Job.findById(entityId)
      .populate('artisanId', 'userId fullName');
    if (job) {
      job.paymentStatus = 'paid';
      await job.save();
      // Notify artisan
      if (job.artisanId?.userId) {
        const n = await Notification.create({
          userId: job.artisanId.userId,
          title: 'Payment Received',
          body: `Payment of ₦${job.budget.toLocaleString()} received for job "${job.title}".`,
          type: 'job',
          data: { jobId: job._id },
        });
        emitNotification(req, n);
      }
    }
  }

  sendSuccess(res, { status: 'success', type, entityId }, 'Payment verified.');
});

/**
 * POST /api/v1/payments/webhook
 * Paystack webhook handler — verifies signature and processes events.
 */
export const webhook = asyncHandler(async (req, res) => {
  const hash = crypto
    .createHmac('sha512', config.PAYSTACK_SECRET_KEY)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (hash !== req.headers['x-paystack-signature']) {
    throw new AppError('Invalid webhook signature.', 400);
  }

  const { event, data } = req.body;

  if (event === 'charge.success') {
    const { type, entityId } = data.metadata || {};
    if (type === 'order') {
      await Order.findByIdAndUpdate(entityId, { paymentStatus: 'paid', paymentMethod: 'Card Payment' });
    } else if (type === 'job') {
      await Job.findByIdAndUpdate(entityId, { paymentStatus: 'paid' });
    }
  }

  // Paystack expects 200 response
  res.status(200).json({ received: true });
});
