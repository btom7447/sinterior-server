/**
 * coverageStates: one string → a list of states.
 *
 * The field was `String` with a plural name, and the web dashboard offered it
 * as a free-text box. So a supplier who delivers to three states wrote
 * "Lagos, Ogun, Oyo" into a field the app then handed to resolveState() as if
 * it were one place — which returned null, which made the delivery screen's
 * quick-fill say "set where you are based first" to somebody who already had.
 *
 * The schema is now [String]. This converts what is stored to match, splitting
 * on the separators people used and canonicalising each fragment (so "abuja"
 * and "FCT" both land on "FCT Abuja", and a state written twice appears once).
 *
 * Anything unrecognisable — "South West", "Nationwide" — is KEPT verbatim as a
 * single entry rather than dropped, and listed at the end. A supplier who wrote
 * it told us something; losing it silently is worse than carrying a value the
 * picker cannot highlight. Those are the rows worth a human's attention.
 *
 * Idempotent: a document already holding an array is re-parsed to the same
 * array and reported as unchanged, so running it twice is safe.
 *
 * Usage: node src/scripts/migrateCoverageStates.mjs --env .env.production [--commit]
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { parseCoverage, allRecognised } from '../config/nigeria.js';

const args = process.argv.slice(2);
const envFlag = args.indexOf('--env');
dotenv.config({ path: envFlag > -1 ? args[envFlag + 1] : '.env.local', override: true });
const commit = args.includes('--commit');

const { default: SupplierProfile } = await import('../models/SupplierProfile.js');

await mongoose.connect(process.env.MONGO_URI);
console.log(`\n  database : ${mongoose.connection.name}`);
console.log(`  mode     : ${commit ? 'WRITING' : 'dry run'}\n`);

/*
 * Read through the driver, not through Mongoose.
 *
 * The schema now says [String] while the documents still hold a String, and
 * hydrating a mismatched path is exactly the case this script exists to remove.
 * The raw collection gives back what is actually stored.
 */
const raw = mongoose.connection.db.collection('supplierprofiles');
const docs = await raw
  .find({ coverageStates: { $exists: true, $ne: null } })
  .project({ coverageStates: 1, businessName: 1 })
  .toArray();

let changed = 0;
let already = 0;
const needsReview = [];

for (const doc of docs) {
  const before = doc.coverageStates;
  const after = parseCoverage(before);

  const wasArray = Array.isArray(before);
  const same =
    wasArray && before.length === after.length && before.every((v, i) => v === after[i]);

  if (same) {
    already += 1;
  } else {
    changed += 1;
    const name = doc.businessName || String(doc._id);
    console.log(`  ${name}`);
    console.log(`    ${JSON.stringify(before)}  ->  ${JSON.stringify(after)}`);
    if (commit) {
      await raw.updateOne({ _id: doc._id }, { $set: { coverageStates: after } });
    }
  }

  if (!allRecognised(after)) {
    needsReview.push({
      name: doc.businessName || String(doc._id),
      kept: after.filter((entry) => !allRecognised([entry])),
    });
  }
}

console.log(`\n  scanned   : ${docs.length}`);
console.log(`  converted : ${changed}${commit ? '' : ' (dry run — nothing written)'}`);
console.log(`  unchanged : ${already}`);

if (needsReview.length) {
  console.log(`\n  kept verbatim, not a state we recognise (${needsReview.length}):`);
  for (const row of needsReview) {
    console.log(`    ${row.name}: ${row.kept.map((k) => `"${k}"`).join(', ')}`);
  }
  console.log('\n  These suppliers should re-pick their states in the app.');
}

if (!commit) console.log('\n  Re-run with --commit to write.\n');

await mongoose.disconnect();
