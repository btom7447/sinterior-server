/**
 * backfillCommentFields.js — fill in the fields threaded comments added.
 *
 * Comments gained parent, mentions, likes and replyCount. Mongoose defaults
 * only apply to documents it creates, so every comment written before this
 * simply has no such fields — and a missing number is not zero.
 *
 * That difference is visible: `likes` sorts as null rather than as 0, so old
 * comments order unpredictably against new ones under "top comments", and the
 * app's optimistic like does `likes + 1` on undefined and renders NaN. The
 * cheapest fix is to make the old documents look like the new ones.
 *
 * Idempotent: $exists guards mean a second run touches nothing.
 *
 * Usage:
 *   node --env-file=.env.local src/scripts/backfillCommentFields.js --dry-run
 *   node --env-file=.env.production src/scripts/backfillCommentFields.js --yes
 */
import mongoose from 'mongoose';
import { connectGuarded } from './_guard.js';
import PinComment from '../models/PinComment.js';

const dryRun = process.argv.includes('--dry-run');

const DEFAULTS = {
  parent: null,
  mentions: [],
  likes: 0,
  replyCount: 0,
};

async function main() {
  await connectGuarded({ dryRun });

  const total = await PinComment.countDocuments();
  const missing = Object.keys(DEFAULTS).map((field) => ({ [field]: { $exists: false } }));
  const filter = { $or: missing };

  const stale = await PinComment.countDocuments(filter);
  console.log(`${total} comments, ${stale} missing at least one field`);

  for (const [field, value] of Object.entries(DEFAULTS)) {
    const n = await PinComment.countDocuments({ [field]: { $exists: false } });
    if (!n) {
      console.log(`  ${String(0).padStart(4)}  ${field}`);
      continue;
    }
    if (!dryRun) {
      await PinComment.updateMany({ [field]: { $exists: false } }, { $set: { [field]: value } });
    }
    console.log(`  ${String(n).padStart(4)}  ${field} ${dryRun ? 'would be set' : 'set'}`);
  }

  // replyCount cannot be inferred from a default: any comment written before
  // this that already has answers needs its real number, and that is only
  // knowable by counting.
  const parents = await PinComment.aggregate([
    { $match: { parent: { $ne: null }, status: 'active' } },
    { $group: { _id: '$parent', n: { $sum: 1 } } },
  ]);

  for (const { _id, n } of parents) {
    if (!dryRun) await PinComment.updateOne({ _id }, { $set: { replyCount: n } });
  }
  console.log(`${parents.length} threads ${dryRun ? 'would have' : 'had'} their reply count recounted`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
