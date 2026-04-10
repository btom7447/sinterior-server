import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import config from '../config/env.js';
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';

// ── Cloudinary configuration ─────────────────────────────────────────────────

cloudinary.config({
  cloud_name: config.CLOUDINARY_CLOUD_NAME,
  api_key: config.CLOUDINARY_API_KEY,
  api_secret: config.CLOUDINARY_API_SECRET,
});

// ── Multer — memory storage (parse multipart into buffers) ───────────────────

const storage = multer.memoryStorage();

const fileFilter = (_req, file, cb) => {
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  if (ALLOWED_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new AppError(
        `Invalid file type "${file.mimetype}". Only JPEG, PNG and WebP images are allowed.`,
        400
      ),
      false
    );
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: config.MAX_FILE_SIZE_MB * 1024 * 1024,
  },
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Upload a single buffer to Cloudinary and return the result.
 */
const uploadBuffer = (buffer, mimetype, options = {}) =>
  new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: options.folder || 'sinterior',
        resource_type: 'image',
        format: 'webp',
        transformation: [
          {
            width: options.width || undefined,
            height: options.height || undefined,
            crop: 'limit',
            quality: options.quality || 85,
          },
        ],
      },
      (error, result) => {
        if (error) reject(new AppError(error.message || 'Upload failed', 500));
        else resolve(result);
      }
    );
    stream.end(buffer);
  });

// ── Exported middleware ──────────────────────────────────────────────────────

/**
 * Middleware that accepts a single file from a named form field.
 */
export const uploadSingle = (fieldName) => upload.single(fieldName);

/**
 * Middleware that accepts multiple files from a named form field.
 */
export const uploadMultiple = (fieldName, max = 10) => upload.array(fieldName, max);

/**
 * Upload parsed file(s) to Cloudinary with image transforms.
 * Must be placed AFTER uploadSingle / uploadMultiple in the middleware chain.
 * After this middleware, each file object has a `.url` property with the
 * Cloudinary secure URL.
 *
 * @param {number} width   - Target width in pixels (0 to skip)
 * @param {number} height  - Target height in pixels (0 to skip)
 * @param {number} quality - Output quality 1-100 (default 85)
 */
export const resizeImage = (width, height, quality = 85) =>
  asyncHandler(async (req, _res, next) => {
    const files = req.files || (req.file ? [req.file] : []);

    if (files.length === 0) return next();

    await Promise.all(
      files.map(async (file) => {
        const result = await uploadBuffer(file.buffer, file.mimetype, {
          width: width || undefined,
          height: height || undefined,
          quality,
        });
        // Attach the Cloudinary URL so controllers can read it
        file.url = result.secure_url;
        file.publicId = result.public_id;
      })
    );

    next();
  });
