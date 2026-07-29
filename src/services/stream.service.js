/**
 * Cloudflare Stream.
 *
 * Video never passes through this server. Stream issues a one-time upload URL,
 * the phone sends the file straight to Cloudflare, and we only ever handle the
 * resulting id. A 60MB upload travelling through Railway would be slow, would
 * count against the dyno, and would achieve nothing.
 *
 * Stream is used rather than R2 because it transcodes. R2 would store whatever
 * the phone encoded and serve every byte of it to every viewer; Stream produces
 * an adaptive ladder, so someone on a weak connection in Lagos gets a smaller
 * rendition automatically instead of a stalled 1080p file. On this app that is
 * the whole point.
 *
 * Poster frames come free: Stream generates a thumbnail per video, which is
 * what lets the feed keep its no-autoplay rule without a black rectangle.
 */
import AppError from '../utils/AppError.js';
import config from './../config/env.js';

const API = 'https://api.cloudflare.com/client/v4';

/** Guardrails from DECISIONS 2026-07-27, enforced at the point of ingest. */
export const MAX_VIDEO_SECONDS = 60;

export const streamConfigured = () =>
  !!config.CLOUDFLARE_ACCOUNT_ID && !!config.CLOUDFLARE_API_TOKEN;

const call = async (path, options = {}) => {
  if (!streamConfigured()) {
    throw new AppError('Video uploads are not configured on this server.', 503);
  }

  const res = await fetch(`${API}/accounts/${config.CLOUDFLARE_ACCOUNT_ID}/stream${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    // Cloudflare returns an array of {code, message}; surface the first one so
    // a misconfigured token says so instead of "something went wrong".
    const detail = body?.errors?.[0]?.message || `Cloudflare responded ${res.status}`;
    throw new AppError(`Video service error: ${detail}`, res.status === 401 ? 500 : 502);
  }
  return body.result;
};

/**
 * A one-time URL the phone can upload to directly.
 *
 * `maxDurationSeconds` is enforced by Cloudflare at ingest, so a client that
 * ignores its own cap still cannot post a ten-minute video.
 */
export async function createDirectUpload({ creator }) {
  const result = await call('/direct_upload', {
    method: 'POST',
    body: JSON.stringify({
      maxDurationSeconds: MAX_VIDEO_SECONDS,
      requireSignedURLs: false,
      // Ties the video to the profile that made it, so orphans are traceable
      // when an upload is abandoned before its pin is created.
      creator,
      expiry: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    }),
  });

  return { uid: result.uid, uploadUrl: result.uploadURL };
}

/**
 * What Stream currently knows about a video.
 *
 * Transcoding takes time proportional to length, so the client polls this
 * rather than blocking an upload request for a minute.
 */
export async function getVideo(uid) {
  const v = await call(`/${encodeURIComponent(uid)}`);

  return {
    uid: v.uid,
    ready: v.status?.state === 'ready',
    state: v.status?.state ?? 'unknown',
    // Percentage during processing, so the app can show progress rather than a
    // spinner that looks identical to a hang.
    progress: v.status?.pctComplete ? Number(v.status.pctComplete) : 0,
    duration: v.duration ?? null,
    // HLS, which expo-video plays natively on both platforms.
    playbackUrl: v.playback?.hls ?? null,
    posterUrl: v.thumbnail ?? null,
    errorReason: v.status?.errorReasonText || null,
  };
}

/** Remove a video, used when a pin is deleted or an upload is abandoned. */
export async function deleteVideo(uid) {
  if (!uid || !streamConfigured()) return;
  try {
    await call(`/${encodeURIComponent(uid)}`, { method: 'DELETE' });
  } catch {
    // A failed cleanup is not worth failing the caller's request over; it costs
    // storage, not correctness.
  }
}
