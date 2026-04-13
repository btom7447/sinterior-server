import { Router } from 'express';
import { body } from 'express-validator';
import { protect, restrictTo } from '../middleware/auth.js';
import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/AppError.js';
import validate from '../middleware/validate.js';
import VerificationRequest from '../models/VerificationRequest.js';
import Profile from '../models/Profile.js';
import { uploadSingle, resizeImage } from '../middleware/upload.js';

const router = Router();
router.use(protect);

// POST /api/v1/verification/upload — upload a verification document
router.post(
  '/upload',
  restrictTo('artisan', 'supplier'),
  uploadSingle('file'),
  resizeImage(1600, 0, 90),
  asyncHandler(async (req, res) => {
    if (!req.file?.url) throw new AppError('File upload failed.', 400);
    res.status(201).json({ success: true, data: { fileUrl: req.file.url } });
  })
);

// GET /api/v1/verification/my — get current user's verification requests
router.get(
  '/my',
  restrictTo('artisan', 'supplier'),
  asyncHandler(async (req, res) => {
    const profile = await Profile.findOne({ userId: req.user.id });
    if (!profile) throw new AppError('Profile not found.', 404);

    const verifications = await VerificationRequest.find({ sellerId: profile._id })
      .sort({ createdAt: -1 })
      .lean();

    res.json({ success: true, data: { verifications } });
  })
);

// POST /api/v1/verification — submit a verification request
const validateRequest = [
  body('businessName').trim().notEmpty().isLength({ max: 200 }).withMessage('Business name required'),
  body('documentType')
    .isIn(['cac_certificate', 'business_license', 'tax_id', 'utility_bill', 'national_id', 'other'])
    .withMessage('Valid document type required'),
  body('documentUrl').trim().notEmpty().withMessage('Document URL required'),
  validate,
];

router.post(
  '/',
  restrictTo('artisan', 'supplier'),
  validateRequest,
  asyncHandler(async (req, res) => {
    const profile = await Profile.findOne({ userId: req.user.id });
    if (!profile) throw new AppError('Profile not found.', 404);

    // Check for existing pending request
    const existing = await VerificationRequest.findOne({
      sellerId: profile._id,
      status: 'pending',
    });
    if (existing) {
      throw new AppError('You already have a pending verification request.', 400);
    }

    const { businessName, documentType, documentUrl } = req.body;
    const verification = await VerificationRequest.create({
      sellerId: profile._id,
      businessName,
      documentType,
      documentUrl,
    });

    res.status(201).json({
      success: true,
      data: { verification },
      message: 'Verification request submitted. We will review it shortly.',
    });
  })
);

export default router;
