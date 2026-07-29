/**
 * backfillPinMetadata.js — give the legacy portfolio pins the metadata their
 * authors already declared.
 *
 * When artisan portfolios were backfilled into pins, only the image came
 * across. The trade was left null and the title was written as a placeholder
 * ("Work by Abbot Ken"), even though the artisan's own profile says exactly
 * what they do. The result is a feed where almost nothing can be filtered,
 * ranked or put on a rail.
 *
 * Nothing here is invented. Every value is copied or derived from what the
 * artisan themselves entered:
 *
 *   trade  ← ArtisanProfile.skillCategory, mapped to a trade id
 *   title  ← ArtisanProfile.skill, but only over a recognised placeholder
 *   tags   ← the vocabulary read out of the resulting title and caption
 *
 * Rooms are deliberately untouched: nothing in the data says which room a photo
 * shows, and a guess there would be a lie rather than a copy.
 *
 * Idempotent, and safe to re-run after a vocabulary or mapping change.
 *
 * Usage:
 *   node --env-file=.env.local src/scripts/backfillPinMetadata.js --dry-run
 *   node --env-file=.env.local src/scripts/backfillPinMetadata.js
 *   node --env-file=.env.local src/scripts/backfillPinMetadata.js --skip-titles
 */
import mongoose from 'mongoose';
import { connectGuarded } from './_guard.js';
import Pin from '../models/Pin.js';
import ArtisanProfile from '../models/ArtisanProfile.js';
import { tradeForSkillCategory } from '../config/taxonomy.js';
import { deriveTags, sanitizeTags } from '../config/vocabulary.js';

const dryRun = process.argv.includes('--dry-run');
const skipTitles = process.argv.includes('--skip-titles');

/**
 * Titles the original backfill generated rather than a person wrote. Only these
 * are replaced; anything an artisan typed themselves is left exactly alone.
 */
const PLACEHOLDER = [/^work by\s+/i, /^portfolio( item)?\s*\d*$/i, /^untitled/i];
const isPlaceholder = (title = '') => PLACEHOLDER.some((re) => re.test(title.trim()));

/** "Electrical Wiring Installation" reads better as a card title in sentence case. */
const asTitle = (skill) => {
  const clean = skill.trim().replace(/\s+/g, ' ');
  return clean.charAt(0).toUpperCase() + clean.slice(1);
};

async function main() {
  await connectGuarded({ dryRun });

  // One lookup: profileId -> what that artisan says they do.
  const artisans = await ArtisanProfile.find()
    .select('profileId skill skillCategory')
    .lean();
  const byProfile = new Map(
    artisans.filter((a) => a.profileId).map((a) => [a.profileId.toString(), a])
  );
  console.log(`${byProfile.size} artisan profiles to draw from\n`);

  const pins = await Pin.find({ status: 'active', sourceType: 'native' })
    .select('title caption author taxonomy')
    .lean();

  let tradeSet = 0;
  let titleSet = 0;
  let tagsSet = 0;
  const unmapped = new Set();

  for (const pin of pins) {
    const artisan = byProfile.get(pin.author?.toString());
    if (!artisan) continue;

    const update = {};

    // ── trade ────────────────────────────────────────────────────────────────
    if (!pin.taxonomy?.trade) {
      const trade = tradeForSkillCategory(artisan.skillCategory);
      if (trade) {
        update['taxonomy.trade'] = trade;
        tradeSet += 1;
      } else if (artisan.skillCategory) {
        unmapped.add(artisan.skillCategory);
      }
    }

    // ── title ────────────────────────────────────────────────────────────────
    let title = pin.title;
    if (!skipTitles && artisan.skill && isPlaceholder(pin.title)) {
      title = asTitle(artisan.skill);
      update.title = title;
      titleSet += 1;
    }

    // ── tags, read from whatever the title now says ──────────────────────────
    const tags = sanitizeTags([...(pin.taxonomy?.tags ?? []), ...deriveTags(title, pin.caption)]);
    if (tags.length !== (pin.taxonomy?.tags?.length ?? 0)) {
      update['taxonomy.tags'] = tags;
      tagsSet += 1;
    }

    if (!Object.keys(update).length) continue;
    if (!dryRun) await Pin.updateOne({ _id: pin._id }, { $set: update });
  }

  console.log(`${pins.length} native pins examined`);
  console.log(`  trade  ${dryRun ? 'would be' : ''} set on ${tradeSet}`);
  console.log(`  title  ${dryRun ? 'would be' : ''} set on ${titleSet}${skipTitles ? ' (skipped)' : ''}`);
  console.log(`  tags   ${dryRun ? 'would be' : ''} set on ${tagsSet}`);

  if (unmapped.size) {
    console.log('\nskillCategory values with no trade mapping (add to taxonomy.js):');
    unmapped.forEach((v) => console.log(`  ${JSON.stringify(v)}`));
  }

  const withTrade = await Pin.countDocuments({ status: 'active', 'taxonomy.trade': { $ne: null } });
  const total = await Pin.countDocuments({ status: 'active' });
  console.log(`\npins with a trade after this run: ${dryRun ? '(unchanged) ' : ''}${withTrade}/${total}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
