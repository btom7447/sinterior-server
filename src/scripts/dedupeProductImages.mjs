/**
 * One photograph per slide.
 *
 * The catalogue seed wrote the category artwork three times into every
 * listing's `images`, so the gallery would have something to page through. It
 * gave every gallery three identical slides, and every list keyed by image URL
 * a duplicate key — React warns about those because the second child silently
 * replaces the first.
 *
 * Duplicates are collapsed, order kept. A listing is left with however many
 * genuinely different photographs it has, which for the seeded ones is one.
 *
 * Usage: node src/scripts/dedupeProductImages.mjs --env .env.production [--commit]
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

const args = process.argv.slice(2);
const envFlag = args.indexOf('--env');
dotenv.config({ path: envFlag > -1 ? args[envFlag + 1] : '.env.local', override: true });
const commit = args.includes('--commit');

const { default: Product } = await import('../models/Product.js');

await mongoose.connect(process.env.MONGO_URI);
console.log(`\n  database : ${mongoose.connection.name}`);
console.log(`  mode     : ${commit ? 'WRITING' : 'dry run'}\n`);

const products = await Product.find({ 'images.1': { $exists: true } }).select('images name');

let affected = 0;
let slidesRemoved = 0;

for (const product of products) {
  const unique = [...new Set(product.images)];
  if (unique.length === product.images.length) continue;

  slidesRemoved += product.images.length - unique.length;
  affected += 1;

  if (commit) {
    product.images = unique;
    await product.save();
  }
}

console.log(`  listings with repeated images : ${affected}`);
console.log(`  duplicate slides ${commit ? 'removed' : 'to remove'}     : ${slidesRemoved}`);

if (!commit) console.log('\n  dry run — nothing written. Add --commit.\n');

await mongoose.disconnect();
