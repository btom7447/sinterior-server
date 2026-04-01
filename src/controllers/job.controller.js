import { body } from 'express-validator';
import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/AppError.js';
import Job from '../models/Job.js';
import Profile from '../models/Profile.js';
import Notification from '../models/Notification.js';
import { getPagination, buildPaginationMeta } from '../utils/paginate.js';
import validate from '../middleware/validate.js';

export const validateJob = [
  body('artisanId').isMongoId().withMessage('Valid artisan ID required'),
  body('title').trim().notEmpty().isLength({ max: 200 }),
  body('description').optional().trim().isLength({ max: 2000 }),
  body('budget').optional().isFloat({ min: 0 }),
  body('location').optional().trim().isLength({ max: 200 }),
  validate,
];

export const createJob = asyncHandler(async (req, res) => {
  const clientProfile = await Profile.findOne({ userId: req.user.id });
  if (!clientProfile) throw new AppError('Profile not found.', 404);

  const { artisanId, title, description, budget, location, startDate, endDate } = req.body;

  // Verify artisan exists
  const artisanProfile = await Profile.findById(artisanId).select('userId fullName');
  if (!artisanProfile) throw new AppError('Artisan not found.', 404);

  const job = await Job.create({
    clientId: clientProfile._id,
    artisanId,
    title,
    description,
    budget,
    location,
    startDate,
    endDate,
  });

  // Notify the artisan
  await Notification.create({
    userId: artisanProfile.userId,
    title: 'New Job Request',
    body: `${clientProfile.fullName} sent you a job request: "${title}".`,
    type: 'job',
    data: { jobId: job._id },
  });

  res.status(201).json({ success: true, data: { job }, message: 'Job created.' });
});

export const getMyJobs = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) throw new AppError('Profile not found.', 404);

  const { page, limit, skip } = getPagination(req.query);
  const role = req.user.role;
  const filter = role === 'artisan' ? { artisanId: profile._id } : { clientId: profile._id };

  if (req.query.status) filter.status = req.query.status;

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

export const getJob = asyncHandler(async (req, res) => {
  const job = await Job.findById(req.params.id)
    .populate('clientId', 'fullName avatarUrl city phone')
    .populate('artisanId', 'fullName avatarUrl city phone');
  if (!job) throw new AppError('Job not found.', 404);
  res.status(200).json({ success: true, data: { job }, message: 'Job retrieved.' });
});

const VALID_TRANSITIONS = {
  pending: ['accepted', 'cancelled'],
  accepted: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
};

export const updateJobStatus = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) throw new AppError('Profile not found.', 404);

  const { status } = req.body;
  const job = await Job.findById(req.params.id)
    .populate('clientId', 'userId fullName')
    .populate('artisanId', 'userId fullName');
  if (!job) throw new AppError('Job not found.', 404);

  // Authorization: only the client or artisan on this job
  const isClient = job.clientId._id.toString() === profile._id.toString();
  const isArtisan = job.artisanId._id.toString() === profile._id.toString();
  if (!isClient && !isArtisan) {
    throw new AppError('You are not authorised to update this job.', 403);
  }

  // Artisans accept/progress/complete; clients can cancel
  if (isClient && !['cancelled'].includes(status)) {
    throw new AppError('Clients can only cancel jobs.', 403);
  }

  const allowed = VALID_TRANSITIONS[job.status];
  if (!allowed || !allowed.includes(status)) {
    throw new AppError(`Cannot transition from ${job.status} to ${status}.`, 400);
  }

  job.status = status;
  await job.save();

  // Notify the other party
  const notifyUser = isArtisan ? job.clientId : job.artisanId;
  await Notification.create({
    userId: notifyUser.userId,
    title: 'Job Status Updated',
    body: `Job "${job.title}" has been updated to "${status}" by ${isArtisan ? job.artisanId.fullName : job.clientId.fullName}.`,
    type: 'job',
    data: { jobId: job._id, status },
  });

  res.status(200).json({ success: true, data: { job }, message: `Job ${status}.` });
});
