import multer from 'multer';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { v4 as uuid } from 'uuid';
import { fileURLToPath } from 'url';
import config from '../config/env.js';
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve the uploads directory relative to the project root
const UPLOAD_DIR = path.resolve(__dirname, '../../', config.UPLOAD_DIR);

// Ensure the uploads directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ── Multer storage ────────────────────────────────────────────────────────────

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    // Sanitise original name to remove spaces / special chars
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${uuid()}-${safeName}`);
  },
});

// ── File type filter ──────────────────────────────────────────────────────────

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

// ── Base multer instance ──────────────────────────────────────────────────────

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: config.MAX_FILE_SIZE_MB * 1024 * 1024,
  },
});

// ── Exported helpers ──────────────────────────────────────────────────────────

/**
 * Middleware that accepts a single file from a named form field.
 *
 * @param {string} fieldName - The multipart form field name
 * @returns {import('express').RequestHandler}
 */
export const uploadSingle = (fieldName) => upload.single(fieldName);

/**
 * Middleware that accepts multiple files from a named form field.
 *
 * @param {string} fieldName - The multipart form field name
 * @param {number} max       - Maximum number of files
 * @returns {import('express').RequestHandler}
 */
export const uploadMultiple = (fieldName, max = 10) => upload.array(fieldName, max);

/**
 * Sharp image-resizing middleware.
 * Must be placed AFTER uploadSingle / uploadMultiple in the middleware chain.
 * Resizes the uploaded file(s) in-place using sharp.
 *
 * @param {number} width   - Target width in pixels
 * @param {number} height  - Target height in pixels (pass 0 to preserve aspect ratio)
 * @param {number} quality - WebP/JPEG output quality 1-100 (default 85)
 * @returns {import('express').RequestHandler}
 */
export const resizeImage = (width, height, quality = 85) =>
  asyncHandler(async (req, _res, next) => {
    const files = req.files || (req.file ? [req.file] : []);

    if (files.length === 0) return next();

    await Promise.all(
      files.map(async (file) => {
        const outputPath = file.path; // overwrite in-place

        let pipeline = sharp(file.path).resize(
          width || undefined,
          height || undefined,
          { fit: 'cover', withoutEnlargement: true }
        );

        // Convert to WebP for smaller size, better quality
        pipeline = pipeline.webp({ quality });

        const buffer = await pipeline.toBuffer();
        fs.writeFileSync(outputPath, buffer);

        // Update mimetype so downstream code reflects the real type
        file.mimetype = 'image/webp';
      })
    );

    next();
  });
