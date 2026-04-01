import { body } from 'express-validator';
import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/AppError.js';
import Project from '../models/Project.js';
import Profile from '../models/Profile.js';
import { getPagination, buildPaginationMeta } from '../utils/paginate.js';
import validate from '../middleware/validate.js';

export const validateProject = [
  body('title').trim().notEmpty().isLength({ max: 200 }),
  body('description').optional().trim().isLength({ max: 3000 }),
  body('budget').optional().isFloat({ min: 0 }),
  body('location').optional().trim().isLength({ max: 200 }),
  validate,
];

export const createProject = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) throw new AppError('Profile not found.', 404);

  const { title, description, budget, location, startDate, endDate } = req.body;
  const project = await Project.create({
    clientId: profile._id,
    title,
    description,
    budget,
    location,
    startDate,
    endDate,
  });
  res.status(201).json({ success: true, data: { project }, message: 'Project created.' });
});

export const getMyProjects = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) throw new AppError('Profile not found.', 404);

  const { page, limit, skip } = getPagination(req.query);
  const filter = { clientId: profile._id };

  if (req.query.status) filter.status = req.query.status;

  const [projects, total] = await Promise.all([
    Project.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('artisans', 'fullName avatarUrl city'),
    Project.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    data: { projects },
    pagination: buildPaginationMeta(total, page, limit),
    message: 'Projects retrieved.',
  });
});

export const getProject = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) throw new AppError('Profile not found.', 404);

  const project = await Project.findById(req.params.id)
    .populate('artisans', 'fullName avatarUrl city phone');
  if (!project) throw new AppError('Project not found.', 404);
  if (project.clientId.toString() !== profile._id.toString()) {
    throw new AppError('Not authorized.', 403);
  }
  res.status(200).json({ success: true, data: { project }, message: 'Project retrieved.' });
});

export const updateProject = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) throw new AppError('Profile not found.', 404);

  const project = await Project.findById(req.params.id);
  if (!project) throw new AppError('Project not found.', 404);
  if (project.clientId.toString() !== profile._id.toString()) {
    throw new AppError('Not authorized.', 403);
  }

  const allowed = ['title', 'description', 'budget', 'location', 'status', 'startDate', 'endDate'];
  allowed.forEach((key) => {
    if (req.body[key] !== undefined) project[key] = req.body[key];
  });

  await project.save();
  res.status(200).json({ success: true, data: { project }, message: 'Project updated.' });
});

export const deleteProject = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) throw new AppError('Profile not found.', 404);

  const project = await Project.findById(req.params.id);
  if (!project) throw new AppError('Project not found.', 404);
  if (project.clientId.toString() !== profile._id.toString()) {
    throw new AppError('Not authorized.', 403);
  }
  await project.deleteOne();
  res.status(200).json({ success: true, data: null, message: 'Project deleted.' });
});
