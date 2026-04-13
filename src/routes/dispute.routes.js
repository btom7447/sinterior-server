import { Router } from 'express';
import { body } from 'express-validator';
import { protect } from '../middleware/auth.js';
import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/AppError.js';
import validate from '../middleware/validate.js';
import Dispute from '../models/Dispute.js';
import Profile from '../models/Profile.js';
import Job from '../models/Job.js';
import Order from '../models/Order.js';

const router = Router();
router.use(protect);

// GET /api/v1/disputes/my — get current user's disputes
router.get(
  '/my',
  asyncHandler(async (req, res) => {
    const profile = await Profile.findOne({ userId: req.user.id });
    if (!profile) throw new AppError('Profile not found.', 404);

    const disputes = await Dispute.find({
      $or: [{ raisedBy: profile._id }, { against: profile._id }],
    })
      .sort({ createdAt: -1 })
      .populate('raisedBy', 'fullName avatarUrl')
      .populate('against', 'fullName avatarUrl')
      .lean();

    res.json({ success: true, data: { disputes } });
  })
);

// POST /api/v1/disputes — raise a dispute
const validateDispute = [
  body('type').isIn(['order', 'job']).withMessage('Type must be order or job'),
  body('reason').trim().notEmpty().isLength({ max: 2000 }).withMessage('Reason is required (max 2000 chars)'),
  body('orderId').optional().isMongoId(),
  body('jobId').optional().isMongoId(),
  validate,
];

router.post(
  '/',
  validateDispute,
  asyncHandler(async (req, res) => {
    const profile = await Profile.findOne({ userId: req.user.id });
    if (!profile) throw new AppError('Profile not found.', 404);

    const { type, reason, orderId, jobId } = req.body;
    let againstId;

    if (type === 'job') {
      if (!jobId) throw new AppError('jobId is required for job disputes.', 400);
      const job = await Job.findById(jobId);
      if (!job) throw new AppError('Job not found.', 404);

      const isClient = job.clientId.toString() === profile._id.toString();
      const isArtisan = job.artisanId.toString() === profile._id.toString();
      if (!isClient && !isArtisan) throw new AppError('You are not part of this job.', 403);

      againstId = isClient ? job.artisanId : job.clientId;
    } else {
      if (!orderId) throw new AppError('orderId is required for order disputes.', 400);
      const order = await Order.findById(orderId);
      if (!order) throw new AppError('Order not found.', 404);

      const isBuyer = order.buyerId.toString() === profile._id.toString();
      const isSeller = order.items.some(
        (item) => item.supplierId.toString() === profile._id.toString()
      );
      if (!isBuyer && !isSeller) throw new AppError('You are not part of this order.', 403);

      againstId = isBuyer ? order.items[0].supplierId : order.buyerId;
    }

    // Check for existing open dispute on same entity
    const existingFilter = { raisedBy: profile._id, status: { $in: ['open', 'under_review'] } };
    if (type === 'job') existingFilter.jobId = jobId;
    else existingFilter.orderId = orderId;

    const existing = await Dispute.findOne(existingFilter);
    if (existing) throw new AppError('You already have an open dispute for this.', 400);

    const dispute = await Dispute.create({
      type,
      reason,
      orderId: type === 'order' ? orderId : undefined,
      jobId: type === 'job' ? jobId : undefined,
      raisedBy: profile._id,
      against: againstId,
    });

    res.status(201).json({
      success: true,
      data: { dispute },
      message: 'Dispute submitted. Our team will review it.',
    });
  })
);

export default router;
