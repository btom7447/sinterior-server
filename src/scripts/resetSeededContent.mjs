/**
 * Clear the placeholder catalogue and feed, keeping two artisans' work.
 *
 * What this removes:
 *   - every Product (and the Pin each one derives) belonging to the seeded
 *     supplier accounts
 *   - every native Pin authored by an artisan NOT in KEEP
 *
 * What it never touches: Abbot Ken's and Kennedy sitam's pins, anybody's
 * boards, orders, reviews, wallets or profiles. Boards survive because a board
 * is a person's own shelf even when what was on it was seeded — emptying it is
 * a different decision from deleting the pins.
 *
 * Prints what it is about to do and needs --commit to do it, because it deletes
 * from production by design and a dry run is the only way to check the KEEP
 * list is spelled the way the database spells it.
 *
 * Usage:
 *   node src/scripts/resetSeededContent.mjs --env .env.production           (dry)
 *   node src/scripts/resetSeededContent.mjs --env .env.production --commit
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

const args = process.argv.slice(2);
const envFlag = args.indexOf('--env');
const envFile = envFlag > -1 ? args[envFlag + 1] : '.env.local';
const commit = args.includes('--commit');

dotenv.config({ path: envFile, override: true });

const { default: Profile } = await import('../models/Profile.js');
const { default: Pin } = await import('../models/Pin.js');
const { default: Product } = await import('../models/Product.js');
const { default: SavedProduct } = await import('../models/SavedProduct.js');

/**
 * Artisans whose feed work is real and stays.
 *
 * Matched on name AND role. "Kennedy Sitam" exists twice — once as a client and
 * once as the artisan who authored the pins — and matching on name alone found
 * three profiles for two names, which the count guard below caught.
 */
const KEEP = ['Abbot Ken', 'Kennedy sitam'];

await mongoose.connect(process.env.MONGO_URI);
console.log(`\n  database : ${mongoose.connection.name}`);
console.log(`  mode     : ${commit ? 'DELETING' : 'dry run'}\n`);

const profiles = await Profile.find().select('_id fullName role').lean();
const named = (id) => profiles.find((p) => String(p._id) === String(id));

// ── Native pins to remove ────────────────────────────────────────────────────
const keepIds = profiles
  .filter(
    (p) =>
      p.role === 'artisan' &&
      KEEP.some((k) => k.toLowerCase() === (p.fullName ?? '').toLowerCase())
  )
  .map((p) => p._id);

if (keepIds.length !== KEEP.length) {
  throw new Error(
    `Expected to find ${KEEP.length} profiles to keep, found ${keepIds.length}. ` +
      'Refusing to run — a name that does not match would delete the work it was meant to protect.'
  );
}

const doomedPins = await Pin.find({
  sourceType: 'native',
  author: { $nin: keepIds },
}).select('_id author title').lean();

// ── Products to remove ───────────────────────────────────────────────────────
// Everything, because the whole catalogue is being replaced. Their derived pins
// go with them via the model's own removePinsForSource hook when deleted one by
// one — deleteMany would skip it and leave orphan pins in the feed.
const doomedProducts = await Product.find().select('_id name supplierId').lean();

console.log(`  native pins to delete : ${doomedPins.length}`);
for (const [author, count] of tally(doomedPins.map((p) => named(p.author)?.fullName ?? '?'))) {
  console.log(`      ${author.padEnd(18)} ${count}`);
}

console.log(`\n  products to delete    : ${doomedProducts.length}`);
for (const [supplier, count] of tally(
  doomedProducts.map((p) => named(p.supplierId)?.fullName ?? '?')
)) {
  console.log(`      ${supplier.padEnd(18)} ${count}`);
}

const keptPins = await Pin.countDocuments({ sourceType: 'native', author: { $in: keepIds } });
console.log(`\n  native pins kept      : ${keptPins} (${KEEP.join(', ')})`);

if (!commit) {
  console.log('\n  dry run — nothing written. Add --commit to delete.\n');
  await mongoose.disconnect();
  process.exit(0);
}

// ── Delete ───────────────────────────────────────────────────────────────────
const pinResult = await Pin.deleteMany({ _id: { $in: doomedPins.map((p) => p._id) } });

// One at a time so each product's post-delete hook removes its derived pin.
// A deleteMany here is how the feed ends up full of pins pointing at products
// that no longer exist.
let removed = 0;
for (const row of doomedProducts) {
  const doc = await Product.findById(row._id);
  if (doc) {
    await doc.deleteOne();
    removed += 1;
  }
}

// Saved-product rows pointing at nothing would render as blanks in Saved.
const saved = await SavedProduct.deleteMany({
  productId: { $in: doomedProducts.map((p) => p._id) },
});

const strays = await Pin.deleteMany({
  sourceType: 'product',
  sourceRef: { $in: doomedProducts.map((p) => p._id) },
});

console.log(`\n  deleted: ${pinResult.deletedCount} native pins, ${removed} products, ` +
  `${strays.deletedCount} stray product pins, ${saved.deletedCount} saved rows`);
console.log(`  remaining pins: ${await Pin.countDocuments()}, products: ${await Product.countDocuments()}\n`);

await mongoose.disconnect();

function tally(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}
