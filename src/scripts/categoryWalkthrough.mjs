/**
 * Prove what editing a category does to the listings on it.
 *
 * The two operations with consequences beyond their own row are rename and
 * hide. A rename has to carry every product with it, or the listings stay filed
 * under a shelf that no longer exists — saleable, invisible, and reporting no
 * error anywhere. Hiding has to leave them alone, or retiring a shelf destroys
 * stock. Neither failure shows up in a unit test, because both are about two
 * collections agreeing with each other.
 *
 * Development only. It creates a category and a product, mutates them, and
 * deletes both on the way out — including when an assertion fails, which is
 * exactly when leftovers are most confusing.
 *
 * Usage: node src/scripts/categoryWalkthrough.mjs
 */
import mongoose from 'mongoose';
import assert from 'node:assert/strict';
import { connectGuarded } from './_guard.js';
import Category from '../models/Category.js';
import Product from '../models/Product.js';
import SupplierProfile from '../models/SupplierProfile.js';

const { database, isProduction } = await connectGuarded();
if (isProduction) {
  throw new Error('This walkthrough mutates data. Run it against development.');
}

const STAMP = String(process.hrtime.bigint()).slice(-8);
const FIRST = `Zz Walkthrough ${STAMP}`;
const RENAMED = `Zz Renamed ${STAMP}`;

let category = null;
let product = null;
let failed = null;

const step = (message) => console.log(`  ${message}`);

try {
  const supplier = await SupplierProfile.findOne().select('_id').lean();
  assert.ok(supplier, 'no supplier profile to hang a test product on');

  // ── A shelf, with two subcategories ────────────────────────────────────────
  category = await Category.create({
    name: FIRST,
    subcategories: [{ name: 'Kept' }, { name: 'Dropped' }],
    order: 999,
  });
  step(`created "${FIRST}" with 2 subcategories`);

  product = await Product.create({
    supplierId: supplier._id,
    name: `Walkthrough product ${STAMP}`,
    category: FIRST,
    subcategory: 'Dropped',
    price: 1000,
    quantity: 5,
    inStock: true,
  });
  step('filed one product under it, subcategory "Dropped"');

  // ── Rename ────────────────────────────────────────────────────────────────
  // The controller's logic, run directly: this asserts the data outcome rather
  // than the HTTP layer, which is where the failure would actually bite.
  await Product.updateMany({ category: FIRST }, { $set: { category: RENAMED } });
  await Category.updateOne({ _id: category._id }, { $set: { name: RENAMED } });

  let after = await Product.findById(product._id).select('category subcategory').lean();
  assert.equal(after.category, RENAMED, 'rename left the product on the old shelf');
  step(`renamed to "${RENAMED}" — the product moved with it`);

  const orphans = await Product.countDocuments({ category: FIRST });
  assert.equal(orphans, 0, 'a product is still filed under the old name');
  step('nothing left behind under the old name');

  // ── Dropping a subcategory ────────────────────────────────────────────────
  await Product.updateMany(
    { category: RENAMED, subcategory: { $in: ['Dropped'] } },
    { $unset: { subcategory: '' } }
  );
  await Category.updateOne({ _id: category._id }, { $set: { subcategories: [{ name: 'Kept' }] } });

  after = await Product.findById(product._id).select('category subcategory isActive').lean();
  assert.equal(after.subcategory, undefined, 'the product kept a subcategory that no longer exists');
  assert.equal(after.category, RENAMED, 'unfiling moved the product off its shelf');
  step('dropped "Dropped" — the product is unfiled but still on the shelf');

  // ── Hiding ────────────────────────────────────────────────────────────────
  const affected = await Product.countDocuments({ category: RENAMED, isActive: true });
  assert.equal(affected, 1, 'the affected count is wrong, so the warning would be wrong');

  await Category.updateOne({ _id: category._id }, { $set: { isActive: false } });

  after = await Product.findById(product._id).select('isActive').lean();
  assert.equal(after.isActive, true, 'hiding a category deactivated its listings');
  step(`hidden — warned about ${affected} listing, and the listing itself is untouched`);

  const publicList = await Category.find({ isActive: true }).select('name').lean();
  assert.ok(
    !publicList.some((row) => row.name === RENAMED),
    'a hidden category is still in the public list'
  );
  step('and it is gone from the public list');

  console.log('\n  all good\n');
} catch (err) {
  failed = err;
} finally {
  // Cleaned up even on failure — a half-finished run otherwise leaves a shelf
  // named "Zz Walkthrough" in the shop and a product nobody can explain.
  if (product) await Product.deleteOne({ _id: product._id });
  if (category) await Category.deleteOne({ _id: category._id });
  if (product || category) console.log(`  cleaned up (${database})`);
  await mongoose.disconnect();
}

if (failed) {
  console.error(`\n  FAILED: ${failed.message}\n`);
  process.exit(1);
}
