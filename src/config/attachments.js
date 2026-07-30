/**
 * What may be attached to a message, and how big.
 *
 * A construction marketplace runs on documents as much as photographs. A quote
 * is a PDF, a bill of quantities is a spreadsheet, and a site walkthrough is a
 * video. Restricting chat to JPEGs pushes all of that onto WhatsApp, and the
 * moment a job's paper trail lives outside the platform there is nothing to
 * appeal to when the work is disputed.
 *
 * Kept as data rather than branches so the client can be told the same rules it
 * is about to be judged by, and so the limits can be tested without an upload.
 */

/**
 * One entry per accepted type.
 *
 * `kind` is what the app draws: a photo tile, a video tile with a play badge, or
 * a document row. `resource` is what Cloudinary is told to store it as, which
 * has to be right — an mp4 sent as an image is rejected, and a PDF sent as an
 * image is silently converted to a picture of its first page.
 */
const TYPES = {
  // ── Photographs ────────────────────────────────────────────────────────────
  'image/jpeg': { kind: 'image', resource: 'image', ext: 'jpg' },
  'image/png': { kind: 'image', resource: 'image', ext: 'png' },
  'image/webp': { kind: 'image', resource: 'image', ext: 'webp' },
  // iPhones shoot HEIC by default. Refusing it means refusing the camera roll
  // of every iOS user who has never opened the setting.
  'image/heic': { kind: 'image', resource: 'image', ext: 'heic' },
  'image/heif': { kind: 'image', resource: 'image', ext: 'heif' },

  // ── Video ──────────────────────────────────────────────────────────────────
  'video/mp4': { kind: 'video', resource: 'video', ext: 'mp4' },
  'video/quicktime': { kind: 'video', resource: 'video', ext: 'mov' },
  'video/webm': { kind: 'video', resource: 'video', ext: 'webm' },
  'video/3gpp': { kind: 'video', resource: 'video', ext: '3gp' },

  // ── Documents ──────────────────────────────────────────────────────────────
  'application/pdf': { kind: 'file', resource: 'raw', ext: 'pdf' },
  'application/msword': { kind: 'file', resource: 'raw', ext: 'doc' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    kind: 'file',
    resource: 'raw',
    ext: 'docx',
  },
  'application/vnd.ms-excel': { kind: 'file', resource: 'raw', ext: 'xls' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    kind: 'file',
    resource: 'raw',
    ext: 'xlsx',
  },
  'text/csv': { kind: 'file', resource: 'raw', ext: 'csv' },
  'text/plain': { kind: 'file', resource: 'raw', ext: 'txt' },
};

/**
 * Per-kind ceilings, in bytes.
 *
 * Different by kind because the numbers people expect are different: nobody is
 * surprised that a 40MB video takes a moment, and everybody would be surprised
 * that a 40MB photograph was refused. On Nigerian mobile data the video cap is
 * also a kindness — a 200MB upload over a metered connection is money.
 */
export const MAX_BYTES = {
  image: 12 * 1024 * 1024,
  video: 64 * 1024 * 1024,
  file: 25 * 1024 * 1024,
};

/** The largest anything may be, which is what Multer is given. */
export const MAX_ANY_BYTES = Math.max(...Object.values(MAX_BYTES));

/** How many files may ride on one message. */
export const MAX_PER_MESSAGE = 10;

/** Every mime type the server will take, for the client to check against first. */
export const ALLOWED_MIMES = Object.keys(TYPES);

/** What kind of thing a mime type is, or null if it is not accepted at all. */
export function kindOf(mime) {
  return TYPES[normalise(mime)]?.kind ?? null;
}

/** How Cloudinary should store it. Null when the type is not accepted. */
export function resourceOf(mime) {
  return TYPES[normalise(mime)]?.resource ?? null;
}

/** The canonical extension, used when a client sends a file with no name. */
export function extensionOf(mime) {
  return TYPES[normalise(mime)]?.ext ?? null;
}

/**
 * Whether a file is acceptable, and why not when it isn't.
 *
 * The reason is written for the person rather than the log. "Only JPEG, PNG and
 * WebP images are allowed" told somebody attaching a quote nothing about what to
 * do next; naming their file and its actual limit does.
 */
export function checkFile({ mime, size, name }) {
  const kind = kindOf(mime);
  const label = name ? `"${name}"` : 'That file';

  if (!kind) {
    return {
      ok: false,
      reason: `${label} is not a type we can send. Photos, videos, PDFs, Word and Excel files are fine.`,
    };
  }

  const limit = MAX_BYTES[kind];
  if (typeof size === 'number' && size > limit) {
    return {
      ok: false,
      reason: `${label} is ${megabytes(size)} — ${kind === 'video' ? 'videos' : kind === 'image' ? 'photos' : 'documents'} can be up to ${megabytes(limit)}.`,
    };
  }

  return { ok: true, kind };
}

/**
 * What a conversation list should say when a message is only attachments.
 *
 * An empty preview line makes a thread look broken, and "Sent an image" is wrong
 * the moment somebody sends a spreadsheet. Named by kind, counted when mixed,
 * because the list is scanned rather than read.
 */
export function describeAttachments(attachments = []) {
  if (!attachments.length) return '';

  const counts = attachments.reduce((acc, a) => {
    const kind = a?.kind ?? 'file';
    acc[kind] = (acc[kind] ?? 0) + 1;
    return acc;
  }, {});

  const kinds = Object.keys(counts);
  if (kinds.length > 1) return `${attachments.length} attachments`;

  const [kind] = kinds;
  const n = counts[kind];
  const word = { image: 'Photo', video: 'Video', file: 'Document' }[kind] ?? 'File';
  return n === 1 ? word : `${n} ${word.toLowerCase()}s`;
}

/** One decimal place, and no trailing ".0" to read past. */
function megabytes(bytes) {
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10}MB`;
}

/**
 * Mime types arrive with parameters and casing that vary by client:
 * "TEXT/CSV; charset=utf-8" is the same type as "text/csv".
 */
function normalise(mime) {
  return String(mime ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
}
