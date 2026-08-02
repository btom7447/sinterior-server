/**
 * Ten pins each for the artisans whose test feed was cleared.
 *
 * Matched to the trade each artisan actually declared on their profile, because
 * a feed where the painter posts plumbing is a feed nobody believes — and the
 * trade tag is what the feed filters on, so a mismatch makes them unfindable by
 * the people looking for exactly what they do.
 *
 * Media is a placeholder drawn from the category artwork already on Cloudinary.
 * Real photographs and video are the next job; this makes the gap visible
 * instead of dressing it up with a stock image of somebody else's work.
 *
 * Usage: node src/scripts/seedArtisanPins.mjs --env .env.production [--commit]
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

const args = process.argv.slice(2);
const envFlag = args.indexOf('--env');
dotenv.config({ path: envFlag > -1 ? args[envFlag + 1] : '.env.local', override: true });
const commit = args.includes('--commit');

const { default: Pin } = await import('../models/Pin.js');
const { default: Profile } = await import('../models/Profile.js');
const { default: ArtisanProfile } = await import('../models/ArtisanProfile.js');
const { default: Category } = await import('../models/Category.js');
const { tradeForSkillCategory, bandForAmount } = await import('../config/taxonomy.js');
const { PINS_BY_TRADE } = await import('./data/pins.mjs');

await mongoose.connect(process.env.MONGO_URI);
console.log(`\n  database : ${mongoose.connection.name}`);
console.log(`  mode     : ${commit ? 'WRITING' : 'dry run'}\n`);

/** Whose feed is being filled. Everyone else's work is left alone. */
const TARGETS = ['Benjamin Tom', 'Adoram Tom'];

/** Placeholder art, picked to at least resemble the trade. */
const ART_FOR_TRADE = { painting: 'Paints', 'wall-decoration': 'Panels' };

const artwork = new Map(
  (await Category.find().select('name image').lean()).map((c) => [c.name, c.image])
);

const rows = [];

for (const name of TARGETS) {
  const profile = await Profile.findOne({ role: 'artisan', fullName: name }).select('_id fullName').lean();
  if (!profile) throw new Error(`No artisan profile named "${name}" — refusing to guess.`);

  const artisan = await ArtisanProfile.findOne({ profileId: profile._id }).select('skillCategory').lean();
  const trade = tradeForSkillCategory(artisan?.skillCategory);
  if (!trade) throw new Error(`${name} has no resolvable trade (skillCategory=${artisan?.skillCategory}).`);

  const entries = PINS_BY_TRADE[trade];
  if (!entries) throw new Error(`No pin copy written for trade "${trade}".`);

  const media = artwork.get(ART_FOR_TRADE[trade] ?? 'Paints');

  console.log(`  ${name.padEnd(14)} trade=${trade.padEnd(16)} pins=${entries.length}`);

  entries.forEach((entry) => {
    rows.push({
      author: profile._id,
      sourceType: 'native',
      mediaType: 'image',
      mediaUrl: media,
      // A portrait crop, which is the shape the masonry feed is built for — a
      // square placeholder would make every cell the same height and the grid
      // would stop looking like a feed at all.
      aspectRatio: 0.8,
      title: entry.title,
      caption: entry.caption,
      taxonomy: {
        trade,
        room: entry.room,
        budgetBand: bandForAmount(entry.budget),
      },
      // 'active', not 'published' — publishedAt is the timestamp, status is the
      // state, and the enum is draft/active/hidden/removed.
      status: 'active',
      publishedAt: new Date(),
    });
  });
}

console.log(`\n  pins to create : ${rows.length}`);
console.log(`\n  --- sample: ${rows[0].title} ---`);
console.log(rows[0].caption.split('\n').map((l) => `  ${l}`).join('\n'));

if (!commit) {
  console.log('\n  dry run — nothing written. Add --commit.\n');
  await mongoose.disconnect();
  process.exit(0);
}

for (const row of rows) await Pin.create(row);

console.log(`\n  created ${rows.length} pins`);
console.log(`  native pins now: ${await Pin.countDocuments({ sourceType: 'native' })}`);
console.log(`  total pins now : ${await Pin.countDocuments()}\n`);

await mongoose.disconnect();
