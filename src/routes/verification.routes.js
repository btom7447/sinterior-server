import { Router } from 'express';
import { body } from 'express-validator';
import { protect, restrictTo } from '../middleware/auth.js';
import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/AppError.js';
import validate from '../middleware/validate.js';
import VerificationRequest from '../models/VerificationRequest.js';
import Profile from '../models/Profile.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import { uploadSingle, resizeImage } from '../middleware/upload.js';
import { emitNotification } from '../utils/emitNotification.js';
import { sendEmailSafe } from '../utils/sendEmail.js';
import { verificationSubmitted } from '../utils/emailTemplates.js';

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

// POST /api/v1/verification — submit a verification request.
// Suppliers verify a business (multi-doc); artisans verify themselves.
const validateRequest = [
  body('businessName').trim().notEmpty().isLength({ max: 200 }).withMessage('Business name required'),
  body('kind').optional().isIn(['business', 'individual']).withMessage('Invalid kind'),
  body('documents').optional().isArray({ min: 1 }).withMessage('At least one document is required'),
  body('documents.*.type')
    .optional()
    .isIn(['cac_certificate', 'business_license', 'tax_id', 'utility_bill', 'national_id', 'other'])
    .withMessage('Invalid document type'),
  body('documents.*.url').optional().trim().notEmpty().withMessage('Each document needs a URL'),
  // Legacy single-doc fallback (kept so older clients don't break).
  body('documentType')
    .optional()
    .isIn(['cac_certificate', 'business_license', 'tax_id', 'utility_bill', 'national_id', 'other']),
  body('documentUrl').optional().trim().isString(),
  validate,
];

router.post(
  '/',
  restrictTo('artisan', 'supplier'),
  validateRequest,
  asyncHandler(async (req, res) => {
    const profile = await Profile.findOne({ userId: req.user.id });
    if (!profile) throw new AppError('Profile not found.', 404);

    // Block duplicate open requests.
    const existing = await VerificationRequest.findOne({
      sellerId: profile._id,
      status: 'pending',
    });
    if (existing) {
      throw new AppError('You already have a pending verification request.', 400);
    }

    const { businessName, kind, documents, documentType, documentUrl } = req.body;

    // Default kind from role: suppliers verify business, artisans verify self.
    const finalKind = kind || (profile.role === 'supplier' ? 'business' : 'individual');

    // Normalise documents — accept either the new array shape or the legacy
    // single-document fields. Suppliers must provide at least one document.
    let docs = Array.isArray(documents) ? documents : [];
    if (docs.length === 0 && documentType && documentUrl) {
      docs = [{ type: documentType, url: documentUrl }];
    }
    if (docs.length === 0) {
      throw new AppError('At least one document is required.', 400);
    }
    // Suppliers should have a CAC document at minimum.
    if (finalKind === 'business' && !docs.some((d) => d.type === 'cac_certificate')) {
      throw new AppError('A CAC certificate is required to verify a business.', 400);
    }

    const verification = await VerificationRequest.create({
      sellerId: profile._id,
      kind: finalKind,
      businessName,
      documents: docs,
      // Mirror first doc into legacy fields for back-compat queries.
      documentType: docs[0].type,
      documentUrl: docs[0].url,
    });

    // In-app notification + email to the requestor (best-effort, don't fail the request).
    try {
      const notif = await Notification.create({
        userId: req.user.id,
        title: 'Verification submitted',
        body: `Your ${finalKind === 'business' ? 'business' : 'identity'} verification for ${businessName} is under review.`,
        type: 'verification_submitted',
        data: { verificationId: verification._id },
      });
      emitNotification(req, notif);
    } catch (err) {
      console.warn('[verification] requestor notification failed:', err.message);
    }

    // Fan out to every admin so the dashboard reflects new pending work in real time.
    try {
      const admins = await User.find({ role: 'admin' }).select('_id');
      const requestorName = profile.fullName || 'A user';
      for (const admin of admins) {
        const adminNotif = await Notification.create({
          userId: admin._id,
          title: 'New verification request',
          body: `${requestorName} submitted a ${finalKind === 'business' ? 'business' : 'identity'} verification for ${businessName}.`,
          type: 'admin_verification_submitted',
          data: { verificationId: verification._id, sellerId: profile._id, kind: finalKind },
        });
        emitNotification(req, adminNotif);
      }
    } catch (err) {
      console.warn('[verification] admin fan-out failed:', err.message);
    }

    const user = await User.findById(req.user.id).select('email');
    if (user?.email) {
      sendEmailSafe({ to: user.email, ...verificationSubmitted({ businessName }) });
    }

    res.status(201).json({
      success: true,
      data: { verification },
      message: 'Verification request submitted. We will review it shortly.',
    });
  })
);

export default router;
