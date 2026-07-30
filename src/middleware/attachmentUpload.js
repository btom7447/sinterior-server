/**
 * Uploading whatever somebody attached to a message.
 *
 * Deliberately separate from upload.js. That path exists to normalise
 * photographs — resize, re-encode to WebP, strip everything else — which is
 * exactly right for a pin and exactly wrong for a signed PDF. A quote that came
 * back as a picture of its first page would be worse than no attachment at all.
 *
 * So each file is routed by what it is: photographs are still compressed, video
 * is transcoded and given a poster frame, and documents are stored byte for byte
 * under their own name.
 */
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import {
  MAX_ANY_BYTES,
  MAX_BYTES,
  MAX_PER_MESSAGE,
  checkFile,
  extensionOf,
  kindOf,
  resourceOf,
} from '../config/attachments.js';
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';

/**
 * Multer's own limit has to be the largest of the per-kind limits, because the
 * filter runs before any bytes are counted. The real per-kind check happens
 * after parsing, where the size is actually known.
 */
const parser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ANY_BYTES, files: MAX_PER_MESSAGE },
  fileFilter(_req, file, cb) {
    // Type only here. Rejecting on type early saves reading the whole body of
    // something that was never going to be accepted.
    if (!kindOf(file.mimetype)) {
      const { reason } = checkFile({ mime: file.mimetype, name: file.originalname });
      return cb(new AppError(reason, 400), false);
    }
    cb(null, true);
  },
});

/**
 * Parse a multipart body's attachment field into buffers.
 *
 * Multer's own errors are rewritten here rather than in the global handler,
 * because the handler only knows the app-wide photo limit — it would tell
 * somebody their 70MB video was refused because "photos can be up to 5MB",
 * which is both wrong and unactionable.
 */
export const parseAttachments = (field = 'media') => {
  const parse = parser.array(field, MAX_PER_MESSAGE);

  return (req, res, next) =>
    parse(req, res, (err) => {
      if (!err) return next();

      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(
          new AppError(
            `That file is too large. Photos can be up to ${mb(MAX_BYTES.image)}, documents ${mb(MAX_BYTES.file)}, and videos ${mb(MAX_BYTES.video)}.`,
            413
          )
        );
      }
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        return next(
          new AppError(`Up to ${MAX_PER_MESSAGE} files can go on one message.`, 400)
        );
      }
      return next(err);
    });
};

const mb = (bytes) => `${Math.round(bytes / (1024 * 1024))}MB`;

/**
 * Send each parsed file to Cloudinary and hand back attachment records.
 *
 * Runs after parseAttachments. Every file gets an `.attachment` property, which
 * is the shape the Message model stores and the app renders.
 */
export const uploadAttachments = asyncHandler(async (req, _res, next) => {
  const files = req.files ?? [];
  if (!files.length) return next();

  // The per-kind size check, now that the sizes are known. Rejected up front
  // rather than after uploading the acceptable half of a batch, so a refusal
  // does not leave orphans in the account.
  for (const file of files) {
    const verdict = checkFile({
      mime: file.mimetype,
      size: file.size,
      name: file.originalname,
    });
    if (!verdict.ok) throw new AppError(verdict.reason, 413);
  }

  req.attachments = await Promise.all(files.map(toAttachment));
  next();
});

async function toAttachment(file) {
  const kind = kindOf(file.mimetype);
  const result = await send(file, kind);

  return {
    url: result.secure_url,
    publicId: result.public_id,
    resourceType: resourceOf(file.mimetype),
    kind,
    mime: file.mimetype,
    name: filename(file),
    size: file.size ?? result.bytes ?? 0,
    // Dimensions let the app reserve the right space before the bytes arrive,
    // which is the difference between a grid that settles and one that jumps.
    width: result.width ?? null,
    height: result.height ?? null,
    durationMs: result.duration ? Math.round(result.duration * 1000) : null,
    // A still to show while a video is not playing. Cloudinary will render one
    // from the same asset, so this is a URL rather than a second upload.
    thumbnailUrl: kind === 'video' ? posterFor(result) : null,
  };
}

function send(file, kind) {
  const options = {
    folder: `sinterior/chat/${kind === 'file' ? 'documents' : kind}`,
    resource_type: resourceOf(file.mimetype),
  };

  if (kind === 'image') {
    // Same treatment as everywhere else in the app: bounded, re-encoded, and
    // small enough to open on a metered connection.
    options.format = 'webp';
    options.transformation = [{ width: 1600, height: 1600, crop: 'limit', quality: 82 }];
  }

  if (kind === 'file') {
    // Raw assets keep the name they arrived with, because the name is most of
    // what tells somebody whether to open "BOQ-final.xlsx".
    options.use_filename = true;
    options.unique_filename = true;
  }

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) reject(new AppError(error.message || 'That attachment did not upload.', 500));
      else resolve(result);
    });
    stream.end(file.buffer);
  });
}

/**
 * A JPEG of the first frame, derived from the video's own public id.
 *
 * Built by hand rather than requested, because asking Cloudinary to generate and
 * store a thumbnail is a second round trip on the send path — and the send path
 * is what somebody is waiting on with their thumb on the screen.
 */
function posterFor(result) {
  if (!result?.secure_url || !result?.public_id) return null;
  return result.secure_url.replace(/\.[^./]+$/, '.jpg');
}

/**
 * The name to show. Multer gives us whatever the client sent, which for a photo
 * straight off a camera roll is often nothing useful.
 */
function filename(file) {
  const given = String(file.originalname ?? '').trim();
  if (given && given !== 'blob') return given.slice(0, 200);

  const ext = extensionOf(file.mimetype) ?? 'bin';
  return `attachment.${ext}`;
}
