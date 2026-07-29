/**
 * seedAlbumPin.js — put one multi-photo pin in the feed so album rendering can
 * actually be looked at rather than reasoned about.
 *
 * Media is borrowed from pins that already exist in whichever database this is
 * pointed at, so the seeded album uses real Sintherior uploads (and therefore
 * real Cloudinary URLs, which is what the sizing helpers expect). When the
 * database has no pins yet it falls back to a short list of public photographs,
 * which still exercises the non-Cloudinary pass-through path.
 *
 * Idempotent: keyed on (author, title), so re-running edits the same pin rather
 * than creating a second one. Reversible: --undo deletes it and rolls back the
 * board saves it never had.
 *
 * Usage:
 *   node --env-file=.env.local src/scripts/seedAlbumPin.js --dry-run
 *   node --env-file=.env.local src/scripts/seedAlbumPin.js
 *   node --env-file=.env.local src/scripts/seedAlbumPin.js --profile=<profileId>
 *   node --env-file=.env.local src/scripts/seedAlbumPin.js --undo
 */
import mongoose from 'mongoose';
import { connectGuarded } from './_guard.js';
import Pin from '../models/Pin.js';
import Profile from '../models/Profile.js';
import { deriveTags, sanitizeTags } from '../config/vocabulary.js';

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : null;
};
const dryRun = process.argv.includes('--dry-run');
const undo = process.argv.includes('--undo');

// Deliberately specific: the title and caption are what the tag vocabulary
// reads, so this doubles as a live test of the deriver.
const TITLE = 'Three-bedroom flat handover, Lekki';
const CAPTION =
  'Full finishing on a three-bedroom flat in Lekki. POP ceiling with cove lighting, ' +
  'porcelain tiles through the living areas, hardwood wardrobes, and a marble ' +
  'kitchen island. Modern finish throughout, eight weeks from start to handover.';

/** Shapes vary so the carousel is visibly a carousel and not five identical frames. */
const RATIOS = [0.75, 1.33, 0.66, 1.0, 0.8];

const FALLBACK = [
  'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1400',
  'https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?w=1400',
  'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=1400',
  'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?w=1400',
  'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?w=1400',
];

async function pickAuthor() {
  const wanted = arg('profile');
  if (wanted) {
    const profile = await Profile.findById(wanted).select('_id fullName role').lean();
    if (!profile) throw new Error(`No profile with id ${wanted}`);
    return profile;
  }
  const artisan = await Profile.findOne({ role: 'artisan' }).select('_id fullName role').lean();
  if (artisan) return artisan;

  // A supplier can post work too; only clients cannot.
  const maker = await Profile.findOne({ role: { $in: ['supplier', 'admin'] } })
    .select('_id fullName role')
    .lean();
  if (!maker) throw new Error('No artisan, supplier or admin profile to attribute this to.');
  return maker;
}

/** Real uploads from this database, preferring the author's own work. */
async function pickMedia(authorId) {
  const own = await Pin.find({ author: authorId, status: 'active', mediaType: 'image' })
    .select('mediaUrl')
    .limit(5)
    .lean();
  const rest =
    own.length >= 3
      ? []
      : await Pin.find({ status: 'active', mediaType: 'image' })
          .select('mediaUrl')
          .limit(5 - own.length)
          .lean();

  const urls = [...own, ...rest].map((p) => p.mediaUrl).filter(Boolean);
  const source = urls.length >= 3 ? urls : FALLBACK;
  return source.slice(0, 5).map((url, i) => ({
    type: 'image',
    url,
    aspectRatio: RATIOS[i % RATIOS.length],
  }));
}

async function main() {
  await connectGuarded({ dryRun });

  const author = await pickAuthor();
  console.log(`author: ${author.fullName} (${author.role}) ${author._id}`);

  if (undo) {
    const res = dryRun
      ? await Pin.countDocuments({ author: author._id, title: TITLE })
      : (await Pin.deleteOne({ author: author._id, title: TITLE })).deletedCount;
    console.log(`${dryRun ? 'would delete' : 'deleted'} ${res} pin(s)`);
    await mongoose.disconnect();
    return;
  }

  const media = await pickMedia(author._id);
  const borrowed = media[0].url.includes('unsplash') ? 'fallback photographs' : 'existing uploads';
  console.log(`media:  ${media.length} images from ${borrowed}`);

  const tags = sanitizeTags(deriveTags(TITLE, CAPTION));
  console.log(`tags:   ${tags.join(', ') || '(none derived)'}`);

  const doc = {
    author: author._id,
    sourceType: 'native',
    // The flat fields mirror media[0] — the contract every older reader relies on.
    mediaType: media[0].type,
    mediaUrl: media[0].url,
    aspectRatio: media[0].aspectRatio,
    media,
    title: TITLE,
    caption: CAPTION,
    taxonomy: { trade: 'painting', room: 'whole-home', budgetBand: '2m-10m', tags },
    status: 'active',
  };

  if (dryRun) {
    console.log('\nwould upsert:');
    console.log(JSON.stringify({ ...doc, author: String(doc.author) }, null, 2));
    await mongoose.disconnect();
    return;
  }

  const pin = await Pin.findOneAndUpdate(
    { author: author._id, title: TITLE },
    { $set: doc },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  console.log(`\nseeded pin ${pin._id}`);
  console.log(`  ${pin.media.length} frames, cover ratio ${pin.aspectRatio}`);
  console.log(`  undo with: node --env-file=<env> src/scripts/seedAlbumPin.js --undo`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
