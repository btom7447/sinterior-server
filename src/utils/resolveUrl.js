import config from '../config/env.js';

/**
 * Convert a relative upload path (e.g. `/uploads/abc.webp`) to an absolute URL.
 * Already-absolute URLs and falsy values are returned as-is.
 */
export const resolveUploadUrl = (path) => {
  if (!path) return path;
  // Pin.media holds objects, not strings, and this helper is reached through
  // the generic walker below — returning non-strings untouched keeps that safe.
  if (typeof path !== 'string') return path;
  if (path.startsWith('http')) return path;
  return `${config.SERVER_URL}${path}`;
};

/**
 * Resolve an images array. Entries are usually strings, but album entries are
 * `{ url, posterUrl }` objects, so both shapes are handled here.
 */
export const resolveImageUrls = (images) => {
  if (!Array.isArray(images)) return images;
  return images.map((item) => {
    if (typeof item === 'string' || !item) return resolveUploadUrl(item);
    return {
      ...item,
      url: resolveUploadUrl(item.url),
      posterUrl: item.posterUrl ? resolveUploadUrl(item.posterUrl) : item.posterUrl,
    };
  });
};

/** A pin's album with every URL made absolute. Safe on pins that have none. */
export const resolvePinAlbum = (media) => (Array.isArray(media) ? resolveImageUrls(media) : []);

/**
 * Known fields that hold upload paths.
 */
const URL_FIELDS = new Set(['avatarUrl', 'fileUrl', 'logoUrl']);
const IMAGE_ARRAY_FIELDS = new Set(['images', 'media']);

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
