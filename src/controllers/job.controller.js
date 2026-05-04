import { body } from 'express-validator';
import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/AppError.js';
import Job from '../models/Job.js';
import Appointment from '../models/Appointment.js';
import Profile from '../models/Profile.js';
import User from '../models/User.js';
import ArtisanProfile from '../models/ArtisanProfile.js';
import Notification from '../models/Notification.js';
import EscrowEntry from '../models/EscrowEntry.js';
import { getPagination, buildPaginationMeta } from '../utils/paginate.js';
import validate from '../middleware/validate.js';
import { emitNotification } from '../utils/emitNotification.js';
import { sendEmailSafe } from '../utils/sendEmail.js';
import { releaseEscrow } from '../services/wallet.service.js';
import { jobCreatedArtisan, jobStatusChanged, appointmentBooked } from '../utils/emailTemplates.js';

// ── Validators ────────────────────────────────────────────────────────────────

export const validateJob = [
  body('artisanId').isMongoId().withMessage('Valid artisan ID required'),
  body('title').optional().trim().isLength({ max: 200 }),
  body('description').optional().trim().isLength({ max: 2000 }),
  body('bookingType').isIn(['urgent', 'scheduled']).withMessage('bookingType must be urgent or scheduled'),
  body('scheduledDate')
    .if(body('bookingType').equals('scheduled'))
    .notEmpty()
    .withMessage('scheduledDate is required when booking for later')
    .isISO8601(),
  body('location').optional().trim().isLength({ max: 200 }),
  body('state').optional().trim().isLength({ max: 50 }),
  body('city').optional().trim().isLength({ max: 80 }),
  validate,
];

const notifyParty = async ({ req, recipientUserId, title, body, type, data }) => {
  try {
    const n = await Notification.create({ userId: recipientUserId, title, body, type, data });
    emitNotification(req, n);
  } catch (err) {
    console.warn('[job notify] failed:', err.message);
  }
};

// ── POST /api/v1/jobs ─────────────────────────────────────────────────────────

export const createJob = asyncHandler(async (req, res) => {
  const clientProfile = await Profile.findOne({ userId: req.user.id });
  if (!clientProfile) throw new AppError('Profile not found.', 404);

  const {
    artisanId,
    title,
    description,
    bookingType,
    scheduledDate,
    location,
    state,
    city,
  } = req.body;

  if (artisanId.toString() === clientProfile._id.toString()) {
    throw new AppError('You cannot hire yourself.', 400);
  }

  const artisanProfile = await Profile.findById(artisanId).select('userId fullName isSuspended');
  if (!artisanProfile) throw new AppError('Artisan not found.', 404);
  if (artisanProfile.isSuspended) {
    throw new AppError('This artisan is currently unavailable for new hires.', 400);
  }
  if (clientProfile.isSuspended) {
    throw new AppError('Your account is suspended. Contact admin to reinstate.', 403);
  }

  const artisanSkillDoc = await ArtisanProfile.findOne({ profileId: artisanId }).select('skill').lean();
  const skillLabel = artisanSkillDoc?.skill || 'Work';

  const finalTitle =
    (title && title.trim()) ||
    `${skillLabel} request from ${clientProfile.fullName || 'client'}`;

  const job = await Job.create({
    clientId: clientProfile._id,
    artisanId,
    title: finalTitle,
    description,
    bookingType,
    scheduledDate: bookingType === 'scheduled' ? scheduledDate : undefined,
    appointmentDate: bookingType === 'scheduled' ? scheduledDate : undefined,
    location,
    state,
    city,
  });

  await notifyParty({
    req,
    recipientUserId: artisanProfile.userId,
    title: bookingType === 'urgent' ? 'New urgent job request' : 'New job booking',
    body: `${clientProfile.fullName} sent you a ${bookingType === 'urgent' ? 'urgent' : 'scheduled'} request: "${title}".`,
    type: 'job',
    data: { jobId: job._id },
  });

  const artisanUser = await User.findById(artisanProfile.userId).select('email');
  if (artisanUser?.email) {
    const { subject, html } = jobCreatedArtisan({ job, clientName: clientProfile.fullName });
    sendEmailSafe({ to: artisanUser.email, subject, html });
  }

  res.status(201).json({ success: true, data: { job }, message: 'Job created.' });
});

// ── GET /api/v1/jobs ──────────────────────────────────────────────────────────

export const getMyJobs = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) throw new AppError('Profile not found.', 404);

  const { page, limit, skip } = getPagination(req.query);
  const role = req.user.role;

  // ?as=artisan|client — explicitly choose the view. If omitted, default by role.
  const explicitAs = req.query.as;
  const view =
    explicitAs === 'artisan' || explicitAs === 'client'
      ? explicitAs
      : role === 'artisan'
      ? 'artisan'
      : 'client';

  const filter =
    view === 'artisan'
      ? { artisanId: profile._id }
      : { clientId: profile._id };

  const validStatuses = ['pending', 'accepted', 'in_progress', 'completed', 'cancelled'];
  if (req.query.status && validStatuses.includes(req.query.status)) {
    filter.status = req.query.status;
  }
  if (req.query.bookingType && ['urgent', 'scheduled'].includes(req.query.bookingType)) {
    filter.bookingType = req.query.bookingType;
  }

  const [jobs, total] = await Promise.all([
    Job.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('clientId', 'fullName avatarUrl city')
      .populate('artisanId', 'fullName avatarUrl city'),
    Job.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: { jobs },
    pagination: buildPaginationMeta(total, page, limit),
    message: 'Jobs retrieved.',
  });
});

// ── GET /api/v1/jobs/active ───────────────────────────────────────────────────
// Returns every in-progress job the caller is part of (as client OR as artisan),
// with a precomputed daysRunning + accumulated cost so the UI can render a
// running counter without doing date math on the client.
export const getActiveJobs = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) throw new AppError('Profile not found.', 404);

  const jobs = await Job.find({
    status: 'in_progress',
    $or: [{ clientId: profile._id }, { artisanId: profile._id }],
  })
    .sort({ startedAt: -1 })
    .populate('clientId', 'fullName avatarUrl')
    .populate('artisanId', 'fullName avatarUrl')
    .lean();

  const now = Date.now();
  const enriched = jobs.map((j) => {
    const startedMs = j.startedAt ? new Date(j.startedAt).getTime() : now;
    const elapsedMs = Math.max(0, now - startedMs);
    const daysRunning = Math.max(1, Math.ceil(elapsedMs / (1000 * 60 * 60 * 24)));
    const role = j.artisanId._id.toString() === profile._id.toString() ? 'artisan' : 'client';
    return {
      _id: j._id,
      title: j.title,
      bookingType: j.bookingType,
      role,
      counterparty: role === 'artisan' ? j.clientId : j.artisanId,
      startedAt: j.startedAt,
      daysRunning,
      // totalAmount is locked from accepted quote
      costSoFar: j.totalAmount || 0,
    };
  });

  const totalCostSoFar = enriched.reduce((sum, j) => sum + j.costSoFar, 0);
  res.json({
    success: true,
    data: { jobs: enriched, total: enriched.length, totalCostSoFar },
  });
});

// ── GET /api/v1/jobs/:id ──────────────────────────────────────────────────────

export const getJob = asyncHandler(async (req, res) => {
  const job = await Job.findById(req.params.id)
    .populate('clientId', 'fullName avatarUrl city phone userId')
    .populate('artisanId', 'fullName avatarUrl city phone userId');
  if (!job) throw new AppError('Job not found.', 404);
  res.status(200).json({ success: true, data: { job }, message: 'Job retrieved.' });
});

// ── Action endpoints ─────────────────────────────────────────────────────────
// Each action is a deliberate, scoped state transition rather than the old
// generic PATCH /:id/status route. This makes intent obvious in the UI and
// authorisation simpler.

const loadJobAndAuth = async (req, expectedRole) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) throw new AppError('Profile not found.', 404);

  const job = await Job.findById(req.params.id)
    .populate('clientId', 'userId fullName')
    .populate('artisanId', 'userId fullName');
  if (!job) throw new AppError('Job not found.', 404);

  const isClient = job.clientId._id.toString() === profile._id.toString();
  const isArtisan = job.artisanId._id.toString() === profile._id.toString();
  if (!isClient && !isArtisan) {
    throw new AppError('You are not part of this job.', 403);
  }
  if (expectedRole === 'artisan' && !isArtisan) {
    throw new AppError('Only the artisan can take this action.', 403);
  }
  if (expectedRole === 'client' && !isClient) {
    throw new AppError('Only the client can take this action.', 403);
  }
  return { job, profile, isClient, isArtisan };
};

// acceptJob removed — artisan quotes directly from pending status.
// Client accepting the quote is the approval. Artisan can only decline or send quote.

// PATCH /api/v1/jobs/:id/title — artisan updates the job title
export const updateJobTitle = asyncHandler(async (req, res) => {
  const { job } = await loadJobAndAuth(req, 'artisan');
  if (!['pending', 'quote_pending', 'accepted', 'in_progress'].includes(job.status)) {
    throw new AppError('Cannot update title on a completed or cancelled job.', 400);
  }
  const title = (req.body?.title || '').trim();
  if (!title) throw new AppError('Title is required.', 400);
  if (title.length > 200) throw new AppError('Title must be 200 characters or fewer.', 400);
  job.title = title;
  await job.save();
  res.json({ success: true, data: { job }, message: 'Title updated.' });
});

// POST /api/v1/jobs/:id/reject — artisan declines a pending request
export const rejectJob = asyncHandler(async (req, res) => {
  const { job } = await loadJobAndAuth(req, 'artisan');
  if (job.status !== 'pending') {
    throw new AppError(`Cannot reject a job in status "${job.status}".`, 400);
  }

  const reason = (req.body?.reason || '').trim();
  if (!reason) {
    throw new AppError('A reason is required when declining a request.', 400);
  }

  job.status = 'cancelled';
  job.cancellationReason = reason;
  job.cancelledBy = 'artisan';
  await job.save();

  await notifyParty({
    req,
    recipientUserId: job.clientId.userId,
    title: 'Artisan declined your request',
    body: `${job.artisanId.fullName} can't take "${job.title}" right now. Reason: ${reason}`,
    type: 'job',
    data: { jobId: job._id, status: 'cancelled', reason },
  });

  res.json({ success: true, data: { job }, message: 'Job declined.' });
});

// POST /api/v1/jobs/:id/cancel — either party cancels a pending/accepted job.
// A reason is required so the other party knows what happened.
export const cancelJob = asyncHandler(async (req, res) => {
  const { job, isClient, isArtisan } = await loadJobAndAuth(req);
  if (!['pending', 'accepted'].includes(job.status)) {
    throw new AppError(`Cannot cancel a job in status "${job.status}".`, 400);
  }

  const reason = (req.body?.reason || '').trim();
  if (!reason) {
    throw new AppError('A reason is required when cancelling a job.', 400);
  }

  job.status = 'cancelled';
  job.cancellationReason = reason;
  job.cancelledBy = isClient ? 'client' : 'artisan';
  await job.save();

  const otherUserId = isClient ? job.artisanId.userId : job.clientId.userId;
  const actorName = isArtisan ? job.artisanId.fullName : job.clientId.fullName;
  await notifyParty({
    req,
    recipientUserId: otherUserId,
    title: 'Job cancelled',
    body: `${actorName} cancelled "${job.title}". Reason: ${reason}`,
    type: 'job',
    data: { jobId: job._id, status: 'cancelled', reason },
  });

  res.json({ success: true, data: { job }, message: 'Job cancelled.' });
});

// POST /api/v1/jobs/:id/approve-end — both parties confirm work is done.
// Works from 'accepted' (quote accepted) directly — no in_progress gate needed.
// totalAmount is already locked from the accepted quote — no recompute needed.
export const approveEnd = asyncHandler(async (req, res) => {
  const { job, isClient } = await loadJobAndAuth(req);
  if (!['accepted', 'in_progress'].includes(job.status)) {
    throw new AppError('Job must be accepted before completion can be confirmed.', 400);
  }
  if (job.paymentStatus !== 'paid') {
    throw new AppError('Payment must be completed before confirming job completion.', 400);
  }

  if (isClient) {
    if (job.clientEndApproved) {
      return res.json({ success: true, data: { job }, message: 'Already approved.' });
    }
    job.clientEndApproved = true;
  } else {
    if (job.artisanEndApproved) {
      return res.json({ success: true, data: { job }, message: 'Already approved.' });
    }
    job.artisanEndApproved = true;
  }

  let transitioned = false;
  if (job.clientEndApproved && job.artisanEndApproved) {
    job.status = 'completed';
    job.endedAt = new Date();
    transitioned = true;
  }

  await job.save();

  const otherUserId = isClient ? job.artisanId.userId : job.clientId.userId;
  if (transitioned) {
    // Auto-release escrow — both parties confirmed, platform releases immediately.
    // Atomic findOneAndUpdate prevents double-credit from racing requests.
    const entry = await EscrowEntry.findOneAndUpdate(
      { entityType: 'job', entityId: job._id, status: 'held' },
      { status: 'released', releasedAt: new Date() },
      { new: true }
    );
    if (entry) {
      const { feeAmount, netAmount } = await releaseEscrow({
        sellerProfileId: entry.sellerProfileId,
        amount: entry.amount,
        source: 'job',
        referenceId: job._id,
      });
      entry.feeAmount = feeAmount;
      entry.netAmount = netAmount;
      await entry.save();
    }

    const total = `₦${(job.totalAmount || 0).toLocaleString('en-NG')}`;
    // Notify both parties
    await notifyParty({
      req,
      recipientUserId: job.artisanId.userId,
      title: 'Job completed — payment released',
      body: `Both parties confirmed "${job.title}" is done. ${total} has been released to your wallet.`,
      type: 'job',
      data: { jobId: job._id, status: 'completed' },
    });
    await notifyParty({
      req,
      recipientUserId: job.clientId.userId,
      title: 'Job completed',
      body: `"${job.title}" is complete. ${total} has been released to the artisan.`,
      type: 'job',
      data: { jobId: job._id, status: 'completed' },
    });
  } else {
    await notifyParty({
      req,
      recipientUserId: otherUserId,
      title: 'Awaiting your confirmation',
      body: `${isClient ? job.clientId.fullName : job.artisanId.fullName} confirmed "${job.title}" is done. Please confirm to release payment.`,
      type: 'job',
      data: { jobId: job._id, awaiting: 'end' },
    });
  }

  res.json({
    success: true,
    data: { job },
    message: transitioned ? 'Job completed and payment released.' : 'Confirmed — waiting on the other party.',
  });
});
