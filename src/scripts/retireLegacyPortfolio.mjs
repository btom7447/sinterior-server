/**
 * Retire the embedded portfolio array, without losing what is in it.
 *
 * `ArtisanProfile.portfolio` predates pins. A one-time backfill copied most of
 * it across, and both clients now read pins — so the array is unreachable: the
 * public profile no longer renders it and the dashboard tab that wrote to it
 * has been removed. Left as it is, it is fifteen photographs in a field nobody
 * looks at, and the next person to find it has to work out whether it matters.
 *
 * Anything already mirrored in a pin is simply dropped. Anything NOT mirrored
 * is a photograph that exists only here — the backfill missed it, or the pin it
 * made was later deleted — and becomes a pin before the array is cleared. The
 * captions on those are real job descriptions ("Revamp of senator Ijeke's
 * office"), which is exactly the content this platform is for.
 *
 * Migrated pins are created as drafts. They have a caption but no title, no
 * room and no budget, and publishing them straight into the feed would put
 * untitled work in front of people on the author's behalf. The author decides.
 *
 * Usage: node src/scripts/retireLegacyPortfolio.mjs --env .env.production [--commit]
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

const args = process.argv.slice(2);
const envFlag = args.indexOf('--env');
dotenv.config({ path: envFlag > -1 ? args[envFlag + 1] : '.env.local', override: true });
const commit = args.includes('--commit');

const { default: ArtisanProfile } = await import('../models/ArtisanProfile.js');
const { default: Profile } = await import('../models/Profile.js');
const { default: Pin } = await import('../models/Pin.js');
const { tradeForSkillCategory } = await import('../config/taxonomy.js');

await mongoose.connect(process.env.MONGO_URI);
console.log(`\n  database : ${mongoose.connection.name}`);
console.log(`  mode     : ${commit ? 'WRITING' : 'dry run'}\n`);

let migrated = 0;
let dropped = 0;
const plan = [];

for (const artisan of await ArtisanProfile.find().select('profileId portfolio skillCategory').lean()) {
  const rows = artisan.portfolio ?? [];
  if (!rows.length) continue;

  const profile = await Profile.findById(artisan.profileId).select('fullName').lean();
  const pins = await Pin.find({ author: artisan.profileId }).select('mediaUrl media').lean();

  // Every image URL this author already has a pin for, flat fields and album
  // both — a backfilled pin may carry either.
  const known = new Set(
    pins.flatMap((p) => [p.mediaUrl, ...(p.media ?? []).map((m) => m.url)]).filter(Boolean)
  );

  const orphans = rows.filter((row) => row.url && !known.has(row.url));
  dropped += rows.length - orphans.length;

  console.log(
    `  ${(profile?.fullName ?? '?').padEnd(15)} ${rows.length} rows — ` +
      `${rows.length - orphans.length} already pinned, ${orphans.length} to migrate`
  );

  for (const row of orphans) {
    console.log(`      migrating: ${JSON.stringify(row.caption ?? '(no caption)')}`);
    plan.push({
      author: artisan.profileId,
      sourceType: 'native',
      mediaType: 'image',
      mediaUrl: row.url,
      media: [{ type: 'image', url: row.url, aspectRatio: 1 }],
      aspectRatio: 1,
      // The caption doubles as the title: it is the only description there is,
      // and a pin with no title at all cannot be published later without one.
      title: (row.caption ?? '').slice(0, 200) || 'Untitled work',
      caption: row.caption ?? undefined,
      taxonomy: { trade: tradeForSkillCategory(artisan.skillCategory), room: null },
      status: 'draft',
    });
    migrated += 1;
  }
}

console.log(`\n  to migrate : ${migrated} pins (as drafts)`);
console.log(`  to drop    : ${dropped} rows already mirrored`);

if (!commit) {
  console.log('\n  dry run — nothing written. Add --commit.\n');
  await mongoose.disconnect();
  process.exit(0);
}

for (const pin of plan) await Pin.create(pin);

// Only now, once every orphan is safely a pin.
const cleared = await ArtisanProfile.updateMany(
  { 'portfolio.0': { $exists: true } },
  { $set: { portfolio: [] } }
);

console.log(`\n  created ${migrated} draft pins`);
console.log(`  cleared the portfolio array on ${cleared.modifiedCount} profiles\n`);

await mongoose.disconnect();
