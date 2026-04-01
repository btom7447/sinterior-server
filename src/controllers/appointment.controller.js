import { body } from 'express-validator';
import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/AppError.js';
import Appointment from '../models/Appointment.js';
import Profile from '../models/Profile.js';
import { getPagination, buildPaginationMeta } from '../utils/paginate.js';
import validate from '../middleware/validate.js';

export const validateAppointment = [
  body('artisanId').isMongoId().withMessage('Valid artisan ID required'),
  body('title').trim().notEmpty().isLength({ max: 200 }),
  body('date').isISO8601().withMessage('Valid date required'),
  body('time').optional().trim().isLength({ max: 10 }),
  body('location').optional().trim().isLength({ max: 200 }),
  body('description').optional().trim().isLength({ max: 1000 }),
  validate,
];

export const createAppointment = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) throw new AppError('Profile not found.', 404);

  const { artisanId, title, description, date, time, location, jobId } = req.body;
  const appointment = await Appointment.create({
    clientId: profile._id,
    artisanId,
    title,
    description,
    date,
    time,
    location,
    jobId,
  });
  res.status(201).json({ success: true, data: { appointment }, message: 'Appointment scheduled.' });
});

export const getMyAppointments = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) throw new AppError('Profile not found.', 404);

  const { page, limit, skip } = getPagination(req.query);
  const role = req.user.role;
  const filter = role === 'artisan' ? { artisanId: profile._id } : { clientId: profile._id };

  if (req.query.status) filter.status = req.query.status;
  if (req.query.upcoming === 'true') {
    filter.date = { $gte: new Date() };
    filter.status = 'scheduled';
  }

  const [appointments, total] = await Promise.all([
    Appointment.find(filter)
      .sort({ date: 1 })
      .skip(skip)
      .limit(limit)
      .populate('clientId', 'fullName avatarUrl city')
      .populate('artisanId', 'fullName avatarUrl city'),
    Appointment.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: { appointments },
    pagination: buildPaginationMeta(total, page, limit),
    message: 'Appointments retrieved.',
  });
});

export const updateAppointmentStatus = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) throw new AppError('Profile not found.', 404);

  const { status } = req.body;
  const appointment = await Appointment.findById(req.params.id)
    .populate('clientId', 'userId')
    .populate('artisanId', 'userId');
  if (!appointment) throw new AppError('Appointment not found.', 404);

  // Only client or artisan on this appointment
  const isClient = appointment.clientId._id.toString() === profile._id.toString();
  const isArtisan = appointment.artisanId._id.toString() === profile._id.toString();
  if (!isClient && !isArtisan) {
    throw new AppError('You are not authorised to update this appointment.', 403);
  }

  appointment.status = status;
  await appointment.save();

  res.status(200).json({ success: true, data: { appointment }, message: `Appointment ${status}.` });
});
