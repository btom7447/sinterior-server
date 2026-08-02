/**
 * Move the hardcoded catalogue into the database, once.
 *
 * The fifteen categories and their subcategories have lived in
 * src/config/catalogue.js since the shop was built. Categories are now records
 * an admin can edit, so this copies the existing list across rather than asking
 * anybody to retype it — and the static file stays as the fallback for a
 * database that has not been seeded.
 *
 * Idempotent: run it as often as you like. Existing rows are matched by name and
 * left alone apart from gaining any subcategory they were missing, so it will
 * never overwrite artwork or a rename an admin has already made.
 *
 * Usage: node src/scripts/seedCategories.mjs [--env .env.production]
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

const envFlag = process.argv.indexOf('--env');
const envFile = envFlag > -1 ? process.argv[envFlag + 1] : '.env.local';

// override, because importing any model pulls in config/env.js first and dotenv
// will not replace a variable that is already set — which is how a seed script
// once wrote to the development database while reporting production.
dotenv.config({ path: envFile, override: true });

const { default: Category } = await import('../models/Category.js');
const { SUBCATEGORIES } = await import('../config/catalogue.js');

await mongoose.connect(process.env.MONGO_URI);
console.log(`connected to ${mongoose.connection.name}`);

const names = Object.keys(SUBCATEGORIES);
let created = 0;
let touched = 0;

for (const [index, name] of names.entries()) {
  const existing = await Category.findOne({ name });

  if (!existing) {
    await Category.create({
      name,
      subcategories: SUBCATEGORIES[name].map((sub) => ({ name: sub })),
      // The order they were written in, which already reads as a builder's
      // order — cement and aggregates first, furniture last.
      order: index,
    });
    created += 1;
    continue;
  }

  // Add only what is missing. An admin who has removed a subcategory deliberately
  // should not find it back after the next deploy runs this.
  const have = new Set(existing.subcategories.map((sub) => sub.name));
  const missing = SUBCATEGORIES[name].filter((sub) => !have.has(sub));
  if (missing.length) {
    existing.subcategories.push(...missing.map((sub) => ({ name: sub })));
    await existing.save();
    touched += 1;
  }
}

console.log(`categories created: ${created}, updated: ${touched}`);
for (const row of await Category.find().sort({ order: 1 }).select('name image order subcategories').lean()) {
  console.log(
    `  ${String(row.order ?? '').padStart(2)} ${row.name.padEnd(24)} ` +
      `${row.subcategories.length} subs  ${row.image ? 'has artwork' : 'no artwork'}`
  );
}

await mongoose.disconnect();
