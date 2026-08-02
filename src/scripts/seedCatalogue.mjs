/**
 * Seed the shop: twenty listings in every category, each written up properly.
 *
 * Descriptions are composed, not pasted. Each item carries its own facts — the
 * grade, the size, the brand, what it is for — and the two paragraphs are built
 * from those plus the category's own buying advice. Two bags of cement that
 * differ only in grade therefore read differently, which matters because the
 * grade is the entire reason somebody picks one over the other.
 *
 * Paragraph one is what the thing is. Paragraph two is what somebody who has
 * bought it before would tell you, which is the part a catalogue almost never
 * has and the part that actually helps.
 *
 * Images are placeholders: the category's own artwork, repeated. The real
 * photographs are a supplier's job and this makes the gap obvious rather than
 * hiding it behind a stock photo of somebody else's warehouse.
 *
 * Usage:
 *   node src/scripts/seedCatalogue.mjs --env .env.production [--commit]
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

const args = process.argv.slice(2);
const envFlag = args.indexOf('--env');
dotenv.config({ path: envFlag > -1 ? args[envFlag + 1] : '.env.local', override: true });
const commit = args.includes('--commit');

const { default: Product } = await import('../models/Product.js');
const { default: Profile } = await import('../models/Profile.js');
const { default: Category } = await import('../models/Category.js');
const { PART_A } = await import('./data/catalogue-a.mjs');
const { PART_B } = await import('./data/catalogue-b.mjs');
const { PART_C } = await import('./data/catalogue-c.mjs');
const { PART_D } = await import('./data/catalogue-d.mjs');

const CATALOGUE = { ...PART_A, ...PART_B, ...PART_C, ...PART_D };

await mongoose.connect(process.env.MONGO_URI);
console.log(`\n  database : ${mongoose.connection.name}`);
console.log(`  mode     : ${commit ? 'WRITING' : 'dry run'}\n`);

// ── Who sells what ───────────────────────────────────────────────────────────
/*
 * Two suppliers, not one.
 *
 * A single-supplier shop cannot exercise the parts of checkout that matter most
 * — the per-supplier grouping, two delivery quotes, two lead times — so every
 * fourth listing goes to the second supplier. It is also simply what a
 * marketplace looks like.
 */
const suppliers = await Profile.find({ role: 'supplier' }).select('_id fullName').lean();
const primary = suppliers.find((s) => String(s._id) === '6a6d4572de8d07c764156bd5');
const secondary = suppliers.find((s) => String(s._id) === '69d8ea183ba0b06f6ee60bc8');

if (!primary || !secondary) {
  throw new Error('Expected both seeded supplier profiles. Refusing to guess who owns 300 listings.');
}

const artwork = new Map(
  (await Category.find().select('name image').lean()).map((c) => [c.name, c.image])
);

// ── Composition ──────────────────────────────────────────────────────────────

/**
 * "Grade 42.5R, bag weight 50 kg, type Ordinary Portland." — the facts, plainly.
 *
 * Commas throughout rather than a trailing "and": these are a spec list, not a
 * list of things being done, and "50 kg and type Ordinary Portland" reads as
 * though the last item were the punchline of a sentence it is not part of.
 */
function specSentence(specs) {
  const parts = Object.entries(specs ?? {}).map(
    ([key, value]) => `${key.replace(/_/g, ' ').toLowerCase()} ${value}`
  );
  if (!parts.length) return '';
  const line = parts.join(', ');
  return `${line[0].toUpperCase()}${line.slice(1)}.`;
}

/** What it costs to have it, said plainly, and only where there is something to say. */
function closingSentence(item, category) {
  const bits = [];
  if (item.fulfilment === 'preorder') {
    bits.push(
      `This one is brought in to order — reckon on ${item.preorderWeeksMin}-${item.preorderWeeksMax} weeks from the day it is paid for, so it is not a same-week purchase.`
    );
  }
  if (item.warrantyMonths >= 12) {
    const years = Math.round(item.warrantyMonths / 12);
    bits.push(`Covered by a ${years}-year warranty against manufacturing defects.`);
  }
  if (item.weightKg >= 40) {
    bits.push(
      `At ${item.weightKg} kg it is a two-person lift — make sure there is somebody at the delivery end.`
    );
  }
  bits.push(`Sold by the ${item.unit ?? category.unit}.`);
  return bits.join(' ');
}

function describe(item, category, index) {
  const one = [
    `${item.blurb}.`,
    specSentence(item.specs),
    category.use[index % category.use.length],
  ]
    .filter(Boolean)
    .join(' ');

  const two = [category.advice[index % category.advice.length], closingSentence(item, category)].join(
    ' '
  );

  return `${one}\n\n${two}`;
}

/** A stable code, so two listings never collide and a supplier can quote one. */
const skuFor = (categoryName, index) =>
  `${categoryName.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase()}-${String(index + 1).padStart(3, '0')}`;

// ── Build ────────────────────────────────────────────────────────────────────
const rows = [];
let n = 0;

for (const [categoryName, category] of Object.entries(CATALOGUE)) {
  const image = artwork.get(categoryName);

  category.items.forEach((item, index) => {
    // Every fourth listing to the second supplier.
    const owner = n % 4 === 3 ? secondary : primary;

    // A quarter carry a "was" price, which is what a real shop looks like —
    // never all of them, because a permanent sale is not a sale.
    const onOffer = n % 4 === 1;

    rows.push({
      supplierId: owner._id,
      name: item.name,
      description: describe(item, category, index),
      category: categoryName,
      subcategory: item.sub,
      brand: item.brand,
      price: item.price,
      compareAtPrice: onOffer ? Math.round((item.price * 1.18) / 100) * 100 : undefined,
      unit: item.unit ?? category.unit,
      quantity: 40 + ((n * 7) % 160),
      inStock: true,
      lowStockThreshold: 10,
      // Three of the same placeholder: the gallery expects more than one, and
      // pretending we have three real photographs would be worse than this.
      images: image ? [image, image, image] : [],
      specs: Object.fromEntries(Object.entries(item.specs ?? {}).map(([k, v]) => [k, [String(v)]])),
      sku: skuFor(categoryName, index),
      weightKg: item.weightKg,
      returnWindowDays: item.fulfilment === 'preorder' ? 0 : 7,
      warrantyMonths: item.warrantyMonths,
      // Free delivery over a threshold on the heavier categories, where it is
      // the offer that actually moves a decision.
      freeShippingOver: item.price >= 50000 ? 500000 : undefined,
      fulfilment: item.fulfilment ?? 'stocked',
      preorderWeeksMin: item.preorderWeeksMin,
      preorderWeeksMax: item.preorderWeeksMax,
      isActive: true,
    });
    n += 1;
  });
}

console.log(`  categories : ${Object.keys(CATALOGUE).length}`);
console.log(`  listings   : ${rows.length}`);
console.log(`  ${primary.fullName}: ${rows.filter((r) => String(r.supplierId) === String(primary._id)).length}`);
console.log(`  ${secondary.fullName}: ${rows.filter((r) => String(r.supplierId) === String(secondary._id)).length}`);
console.log(`  without artwork: ${rows.filter((r) => !r.images.length).length}`);

const sample = rows[0];
console.log(`\n  --- sample: ${sample.name} ---\n`);
console.log(sample.description.split('\n').map((l) => `  ${l}`).join('\n'));

if (!commit) {
  console.log('\n  dry run — nothing written. Add --commit.\n');
  await mongoose.disconnect();
  process.exit(0);
}

// One at a time rather than insertMany: each save fires the hook that creates
// the product's pin, and insertMany skips document middleware entirely — which
// is how you end up with a full shop and an empty feed.
let created = 0;
for (const row of rows) {
  await Product.create(row);
  created += 1;
  if (created % 50 === 0) console.log(`  ${created}/${rows.length}`);
}

console.log(`\n  created ${created} listings\n`);
await mongoose.disconnect();
