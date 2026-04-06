import config from '../config/env.js';

/**
 * Convert a relative upload path (e.g. `/uploads/abc.webp`) to an absolute URL.
 * Already-absolute URLs and falsy values are returned as-is.
 */
export const resolveUploadUrl = (path) => {
  if (!path) return path;
  if (path.startsWith('http')) return path;
  return `${config.SERVER_URL}${path}`;
};

/**
 * Resolve every string in an images array.
 */
export const resolveImageUrls = (images) => {
  if (!Array.isArray(images)) return images;
  return images.map(resolveUploadUrl);
};

/**
 * Known fields that hold upload paths.
 */
const URL_FIELDS = new Set(['avatarUrl', 'fileUrl']);
const IMAGE_ARRAY_FIELDS = new Set(['images']);

/**
 * Recursively resolve all upload-path fields in a plain object (from .lean() or aggregation).
 * Mutates in place for performance and returns the same reference.
 * Uses a WeakSet to avoid infinite recursion on circular references (e.g. Mongoose docs).
 */
export const resolveUploads = (obj, _seen) => {
  if (!obj || typeof obj !== 'object') return obj;

  const seen = _seen || new WeakSet();
  if (seen.has(obj)) return obj;
  seen.add(obj);

  if (Array.isArray(obj)) {
    obj.forEach((item) => resolveUploads(item, seen));
    return obj;
  }
  for (const key of Object.keys(obj)) {
    if (URL_FIELDS.has(key) && typeof obj[key] === 'string') {
      obj[key] = resolveUploadUrl(obj[key]);
    } else if (IMAGE_ARRAY_FIELDS.has(key) && Array.isArray(obj[key])) {
      obj[key] = resolveImageUrls(obj[key]);
    } else if (key === 'portfolio' && Array.isArray(obj[key])) {
      obj[key].forEach((item) => {
        if (item.url) item.url = resolveUploadUrl(item.url);
      });
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      resolveUploads(obj[key], seen);
    }
  }
  return obj;
};
