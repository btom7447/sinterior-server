/**
 * backfillDefaultBoards.js — give existing accounts the board new ones get.
 *
 * Default boards are created at registration now, which does nothing for anyone
 * who signed up before that. Without this they meet an empty picker at the
 * moment they first try to keep something, which is the worst possible time.
 *
 * Only accounts with no boards at all are touched. Somebody who already made
 * their own does not need one named for them, and the whole point is to avoid
 * an empty state rather than to impose a naming convention.
 *
 * Idempotent: re-running after everyone has a board changes nothing.
 *
 * Usage:
 *   node --env-file=.env.local src/scripts/backfillDefaultBoards.js --dry-run
 *   node --env-file=.env.production src/scripts/backfillDefaultBoards.js --yes
 */
import mongoose from 'mongoose';
import { connectGuarded } from './_guard.js';
import Board from '../models/Board.js';
import Profile from '../models/Profile.js';
import { defaultBoardName } from '../config/boards.js';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  await connectGuarded({ dryRun });

  const profiles = await Profile.find({ isDeleted: { $ne: true } })
    .select('_id role fullName')
    .lean();

  // One query for every owner that already has something, rather than one
  // query per profile.
  const owners = await Board.distinct('owner');
  const has = new Set(owners.map((id) => id.toString()));

  const needing = profiles.filter((p) => !has.has(p._id.toString()));
  const byName = new Map();

  for (const profile of needing) {
    const name = defaultBoardName(profile.role);
    byName.set(name, (byName.get(name) ?? 0) + 1);
    if (dryRun) continue;

    try {
      await Board.create({ owner: profile._id, name });
    } catch (err) {
      // A duplicate means they made one with that exact name in between, which
      // is the outcome we wanted anyway.
      if (err.code !== 11000) {
        console.warn(`  could not create for ${profile.fullName || profile._id}: ${err.message}`);
      }
    }
  }

  console.log(`${profiles.length} profiles, ${has.size} already had a board`);
  console.log(`${needing.length} ${dryRun ? 'would get' : 'given'} a default board`);
  for (const [name, n] of byName) console.log(`  ${String(n).padStart(4)}  ${name}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
