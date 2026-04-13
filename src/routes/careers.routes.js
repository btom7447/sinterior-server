import { Router } from 'express';
import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/AppError.js';
import CareerListing from '../models/CareerListing.js';
import { getPagination, buildPaginationMeta } from '../utils/paginate.js';

const router = Router();

// GET /api/v1/careers — public list of open career listings
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = getPagination(req.query);
    const filter = { status: 'open' };

    const [careers, total] = await Promise.all([
      CareerListing.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      CareerListing.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: { careers },
      pagination: buildPaginationMeta(total, page, limit),
    });
  })
);

// GET /api/v1/careers/:id — single listing
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const career = await CareerListing.findOne({ _id: req.params.id, status: 'open' });
    if (!career) throw new AppError('Career listing not found.', 404);
    res.json({ success: true, data: { career } });
  })
);

export default router;
