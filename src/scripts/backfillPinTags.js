/**
 * backfillPinTags.js — read the tag vocabulary out of pins that predate it.
 *
 * Tags are derived from a pin's own title and caption (see config/vocabulary.js),
 * which means every pin written before that existed has an empty tags array and
 * is invisible to tag rails and tag search. This walks the collection once and
 * fills them in.
 *
 * Idempotent: derivation is a pure function of the pin's words, so re-running
 * produces the same tags. Safe to run after every vocabulary change, and that
 * is exactly when it should be run.
 *
 * Usage (dev):   node --env-file=.env.local src/scripts/backfillPinTags.js --dry-run
 * Usage (prod):  node --env-file=.env.production src/scripts/backfillPinTags.js
 */
import mongoose from 'mongoose';
import config from '../config/env.js';
import Pin from '../models/Pin.js';
import { deriveTags, sanitizeTags } from '../config/vocabulary.js';

const dryRun = process.argv.includes('--dry-run');

const same = (a = [], b = []) =>
  a.length === b.length && a.every((tag, i) => tag === b[i]);

async function main() {
  await mongoose.connect(config.MONGO_URI);
  console.log(`connected${dryRun ? ' (dry run)' : ''}`);

  const cursor = Pin.find({ status: { $ne: 'removed' } })
    .select('title caption taxonomy.tags')
    .cursor();

  let seen = 0;
  let changed = 0;
  const histogram = new Map();

  for await (const pin of cursor) {
    seen += 1;
    const next = sanitizeTags([...(pin.taxonomy?.tags ?? []), ...deriveTags(pin.title, pin.caption)]);
    for (const tag of next) histogram.set(tag, (histogram.get(tag) ?? 0) + 1);

    if (same(pin.taxonomy?.tags, next)) continue;
    changed += 1;
    if (!dryRun) {
      await Pin.updateOne({ _id: pin._id }, { $set: { 'taxonomy.tags': next } });
    }
  }

  console.log(`\n${seen} pins read, ${changed} ${dryRun ? 'would change' : 'updated'}`);
  const ranked = [...histogram.entries()].sort((a, b) => b[1] - a[1]);
  console.log('\ntag coverage:');
  for (const [tag, n] of ranked) console.log(`  ${String(n).padStart(5)}  ${tag}`);
  if (!ranked.length) console.log('  (nothing matched — check the vocabulary against real captions)');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
