/**
 * seedVideoPin.js — put a real video pin in the feed so playback can be looked
 * at on a device rather than reasoned about.
 *
 * Goes through the same path the app does: ask Stream for a one-time upload
 * URL, send the file, wait for transcoding, then create the pin from the
 * playback and poster addresses Cloudflare reports back. If this script works,
 * the app's path works, because it is the same three calls.
 *
 * Idempotent on (author, title): re-running replaces the pin and uploads a
 * fresh video, so the old one is deleted first to avoid paying to store it.
 *
 * Usage:
 *   node --env-file=.env.local src/scripts/seedVideoPin.js --dry-run
 *   node --env-file=.env.local src/scripts/seedVideoPin.js
 *   node --env-file=.env.production src/scripts/seedVideoPin.js --yes
 *   node --env-file=.env.local src/scripts/seedVideoPin.js --undo
 */
import mongoose from 'mongoose';
import { connectGuarded } from './_guard.js';
import Pin from '../models/Pin.js';
import Profile from '../models/Profile.js';
import { deriveTags, sanitizeTags } from '../config/vocabulary.js';
import { createDirectUpload, deleteVideo, getVideo, streamConfigured } from '../services/stream.service.js';

const dryRun = process.argv.includes('--dry-run');
const undo = process.argv.includes('--undo');

const TITLE = 'Terrazzo floor pour, start to finish';
const CAPTION =
  'Poured and polished terrazzo across a Lekki living room. Screed base, brass ' +
  'dividers, three grinding passes. Modern finish, two days of work.';

/** Public sample, kept short so a re-run costs a few seconds of stored minutes. */
const SAMPLE =
  'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** The uid is recoverable from a Stream playback URL, which is all the pin stores. */
const uidFromUrl = (url = '') => url.match(/cloudflarestream\.com\/([^/]+)\//)?.[1] ?? null;

async function main() {
  await connectGuarded({ dryRun: dryRun || undo });

  if (!streamConfigured()) {
    throw new Error(
      'Cloudflare Stream is not configured. Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.'
    );
  }

  const author =
    (await Profile.findOne({ role: 'artisan' }).select('_id fullName role').lean()) ??
    (await Profile.findOne({ role: { $in: ['supplier', 'admin'] } }).select('_id fullName role').lean());
  if (!author) throw new Error('No artisan, supplier or admin profile to attribute this to.');
  console.log(`author: ${author.fullName} (${author.role})`);

  const existing = await Pin.findOne({ author: author._id, title: TITLE }).lean();

  if (undo) {
    if (existing) {
      const uid = uidFromUrl(existing.media?.[0]?.url ?? existing.mediaUrl);
      if (uid && !dryRun) await deleteVideo(uid);
      if (!dryRun) await Pin.deleteOne({ _id: existing._id });
    }
    console.log(existing ? `${dryRun ? 'would remove' : 'removed'} the seeded video pin` : 'nothing to remove');
    await mongoose.disconnect();
    return;
  }

  if (dryRun) {
    console.log(`would upload ${SAMPLE}`);
    console.log(`would create "${TITLE}"`);
    console.log(`tags: ${sanitizeTags(deriveTags(TITLE, CAPTION)).join(', ')}`);
    await mongoose.disconnect();
    return;
  }

  // Replacing: drop the previous video first so it stops costing stored minutes.
  if (existing) {
    const oldUid = uidFromUrl(existing.media?.[0]?.url ?? existing.mediaUrl);
    if (oldUid) {
      await deleteVideo(oldUid);
      console.log('removed the previous video from Stream');
    }
  }

  console.log('requesting an upload URL...');
  const { uid, uploadUrl } = await createDirectUpload({ creator: author._id.toString() });

  console.log('fetching the sample...');
  const file = await fetch(SAMPLE).then((r) => r.arrayBuffer());
  console.log(`  ${(file.byteLength / 1024).toFixed(0)} KB`);

  console.log('uploading to Cloudflare...');
  const form = new FormData();
  form.append('file', new Blob([file], { type: 'video/mp4' }), 'sample.mp4');
  const up = await fetch(uploadUrl, { method: 'POST', body: form });
  if (!up.ok) throw new Error(`Upload failed (${up.status})`);

  console.log('waiting for transcode...');
  let video;
  for (let i = 0; i < 60; i += 1) {
    video = await getVideo(uid);
    if (video.ready) break;
    if (video.state === 'error') throw new Error(video.errorReason || 'Transcode failed.');
    process.stdout.write(`  ${video.state} ${video.progress}%\r`);
    await wait(3000);
  }
  if (!video?.ready) throw new Error('Timed out waiting for transcoding.');
  console.log(`  ready — ${video.duration}s                    `);

  const tags = sanitizeTags(deriveTags(TITLE, CAPTION));
  const media = [
    {
      type: 'video',
      url: video.playbackUrl,
      posterUrl: video.posterUrl,
      // 16:9, matching the sample. Real posts carry the phone's own ratio.
      aspectRatio: 1.78,
    },
  ];

  const pin = await Pin.findOneAndUpdate(
    { author: author._id, title: TITLE },
    {
      $set: {
        author: author._id,
        sourceType: 'native',
        mediaType: 'video',
        mediaUrl: media[0].url,
        posterUrl: media[0].posterUrl,
        aspectRatio: media[0].aspectRatio,
        media,
        title: TITLE,
        caption: CAPTION,
        taxonomy: { trade: 'flooring', room: 'living-room', budgetBand: '500k-2m', tags },
        status: 'active',
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  console.log(`\nseeded video pin ${pin._id}`);
  console.log(`  playback : ${video.playbackUrl}`);
  console.log(`  poster   : ${video.posterUrl}`);
  console.log(`  tags     : ${tags.join(', ')}`);
  console.log(`  undo with --undo`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
