/**
 * Give every listing the variants it would really have.
 *
 * A shop where nothing has options is a shop nobody believes: tiles come in
 * sizes, paint comes in colours, doors come in two handings, and a cement
 * merchant sells a bag or a pallet. It is also the half of the pricing and
 * stock machinery that nothing was exercising — variant keys, per-SKU stock,
 * the arrayFilters decrement, the quick-pick sheet on the shop grid.
 *
 * Two rules, both from docs/DECISIONS.md and both load-bearing:
 *
 *   - Variant prices are ABSOLUTE, never deltas. A "+₦500 for the large one"
 *     compounds unpredictably against a bulk tier and neither party can work
 *     out the result.
 *   - Keys are canonical and sorted, computed by skuKeyFor. The key is what the
 *     stock decrement matches on, so it is generated here by the same function
 *     the server uses rather than assembled by hand.
 *
 * The product's own `price` is set to the cheapest variant, so the grid never
 * advertises a figure no buyer can actually pay.
 *
 * Usage: node src/scripts/seedVariants.mjs --env .env.production [--commit]
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

const args = process.argv.slice(2);
const envFlag = args.indexOf('--env');
dotenv.config({ path: envFlag > -1 ? args[envFlag + 1] : '.env.local', override: true });
const commit = args.includes('--commit');

const { default: Product } = await import('../models/Product.js');
const { skuKeyFor } = await import('../config/pricing.js');

/**
 * How each category varies, and what the variation costs.
 *
 * `mult` is a multiplier on the listing's base price, applied to produce an
 * absolute price per row. Values are ordered cheapest first so the base price
 * lands on the first one.
 */
const AXES = {
  Cement: [{ name: 'Quantity', values: [['Single bag', 1], ['10 bags', 9.6], ['20 bags (pallet)', 18.8]] }],
  Aggregates: [{ name: 'Load size', values: [['1 ton', 1], ['5 tons', 4.85], ['10 tons', 9.5], ['20 tons', 18.4]] }],
  'Steel & Iron': [{ name: 'Quantity', values: [['1 length', 1], ['10 lengths', 9.7], ['Full ton', 85]] }],
  'Tiles & Flooring': [
    { name: 'Coverage', values: [['1 box', 1], ['10 boxes', 9.6], ['Full pallet', 44]] },
    { name: 'Finish', values: [['Standard', 1], ['Premium grade', 1.22]] },
  ],
  Paints: [{ name: 'Colour', values: [['Brilliant White', 1], ['Magnolia', 1], ['Soft Grey', 1.06], ['Charcoal', 1.12], ['Custom mix', 1.24]] }],
  'Roofing & Ceiling': [{ name: 'Colour', values: [['Charcoal', 1], ['Terracotta', 1], ['Forest Green', 1.04], ['Ocean Blue', 1.04]] }],
  Walls: [{ name: 'Quantity', values: [['Single', 1], ['50 pieces', 48], ['100 pieces', 94]] }],
  Panels: [
    { name: 'Finish', values: [['Natural Oak', 1], ['Walnut', 1.03], ['Charcoal', 1], ['White', 0.97]] },
    { name: 'Length', values: [['2.9 m', 1], ['1.5 m (half)', 0.55]] },
  ],
  Doors: [
    { name: 'Width', values: [['800 mm', 0.94], ['900 mm', 1], ['1000 mm', 1.09]] },
    { name: 'Handing', values: [['Left hung', 1], ['Right hung', 1]] },
  ],
  Wallpaper: [{ name: 'Quantity', values: [['1 roll', 1], ['5 rolls', 4.85], ['10 rolls', 9.4]] }],
  'Lightings & Electrical': [{ name: 'Colour temperature', values: [['Warm White 3000K', 1], ['Neutral 4000K', 1], ['Daylight 6500K', 1], ['Tuneable', 1.28]] }],
  Plumbing: [{ name: 'Finish', values: [['Chrome', 1], ['Brushed Nickel', 1.14], ['Matt Black', 1.19]] }],
  'Smart Home': [{ name: 'Pack', values: [['Single unit', 1], ['2-pack', 1.9], ['4-pack', 3.6]] }],
  'Wood & Timber': [{ name: 'Quantity', values: [['1 piece', 1], ['10 pieces', 9.6], ['50 pieces', 46]] }],
  Furniture: [
    { name: 'Colour', values: [['Oatmeal', 1], ['Charcoal', 1], ['Forest Green', 1.05], ['Rust', 1.05]] },
    { name: 'Delivery', values: [['Flat packed', 1], ['Assembled on site', 1.08]] },
  ],
};

/** Never fewer than two rows, never more than five. */
const MIN = 2;
const MAX = 5;

await mongoose.connect(process.env.MONGO_URI);
console.log(`\n  database : ${mongoose.connection.name}`);
console.log(`  mode     : ${commit ? 'WRITING' : 'dry run'}\n`);

const products = await Product.find().select('_id name category price quantity sku images').lean();
console.log(`  products : ${products.length}`);

let updated = 0;
const spread = new Map();
let sample = null;

for (const [index, product] of products.entries()) {
  const axes = AXES[product.category];
  if (!axes) {
    console.log(`  no axes for category "${product.category}" — skipped ${product.name}`);
    continue;
  }

  /*
   * Combinations, capped.
   *
   * A door with three widths and two handings is six rows, which is more choice
   * than a shopper wants in a sheet and more stock lines than a supplier will
   * keep honest. Rotating the start position by product index means the five
   * kept are not the same five on every listing.
   */
  let combos = [{}];
  for (const axis of axes) {
    const next = [];
    for (const combo of combos) {
      for (const [value] of axis.values) next.push({ ...combo, [axis.name]: value });
    }
    combos = next;
  }

  const wanted = MIN + ((index + product.name.length) % (MAX - MIN + 1));
  const start = index % combos.length;
  const chosen = [...combos.slice(start), ...combos.slice(0, start)].slice(
    0,
    Math.min(wanted, combos.length)
  );

  const multFor = (combo) =>
    axes.reduce((acc, axis) => {
      const hit = axis.values.find(([value]) => value === combo[axis.name]);
      return acc * (hit ? hit[1] : 1);
    }, 1);

  // Cheapest first, so the listing's headline price is one a buyer can pay.
  const rows = chosen
    .map((options) => ({ options, price: Math.round((product.price * multFor(options)) / 50) * 50 }))
    .sort((a, b) => a.price - b.price)
    .map((row, i) => ({
      key: skuKeyFor(row.options),
      options: row.options,
      price: row.price,
      quantity: 12 + ((index * 5 + i * 13) % 90),
      sku: `${product.sku ?? 'SKU'}-${String.fromCharCode(65 + i)}`,
      image: product.images?.[0],
    }));

  // Only the axes actually used by the rows we kept — offering a value that
  // maps to no purchasable row is a picker that dead-ends.
  const usedOptions = axes
    .map((axis) => ({
      name: axis.name,
      values: [...new Set(rows.map((r) => r.options[axis.name]))].filter(Boolean),
    }))
    .filter((axis) => axis.values.length > 0);

  spread.set(rows.length, (spread.get(rows.length) ?? 0) + 1);
  if (!sample) sample = { product, rows, usedOptions };

  if (commit) {
    await Product.updateOne(
      { _id: product._id },
      {
        $set: {
          variantOptions: usedOptions,
          skus: rows,
          // The headline price follows the cheapest row, and total stock is the
          // sum of the rows rather than a number sitting beside them disagreeing.
          price: rows[0].price,
          quantity: rows.reduce((sum, r) => sum + r.quantity, 0),
          inStock: true,
        },
      }
    );
  }
  updated += 1;
}

console.log(`\n  variant-row spread:`);
for (const [count, n] of [...spread.entries()].sort()) console.log(`      ${count} variants : ${n} products`);

console.log(`\n  --- sample: ${sample.product.name} ---`);
console.log(`  axes: ${sample.usedOptions.map((a) => `${a.name} (${a.values.join(', ')})`).join('  |  ')}`);
for (const row of sample.rows) {
  console.log(`      ${row.key.padEnd(46)} N${String(row.price).padEnd(9)} qty ${row.quantity}`);
}

console.log(`\n  ${commit ? 'updated' : 'would update'} ${updated} products`);
if (!commit) console.log('  dry run — nothing written. Add --commit.\n');
await mongoose.disconnect();
