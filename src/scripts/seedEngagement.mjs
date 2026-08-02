/**
 * Reviews, likes and comments from the people already on the platform.
 *
 * A catalogue where every listing shows "No reviews yet" and a feed where every
 * pin has zero saves is a shop that has never sold anything, and it reads that
 * way to the first real visitor. Ratings are also the only signal the shop can
 * sort by, so an unrated catalogue makes the "top rated" sort meaningless.
 *
 * Reviewers are the real client and artisan accounts on the database. Nobody is
 * invented — a fake reviewer profile would show up in follower lists, chat
 * search and the admin user table as a person who does not exist.
 *
 * Deliberately uneven: about two listings in three get reviews, ratings skew
 * high but not uniformly, and some pins have far more engagement than others.
 * Even coverage is the giveaway that a database was seeded rather than used.
 *
 * Usage: node src/scripts/seedEngagement.mjs --env .env.production [--commit]
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

const args = process.argv.slice(2);
const envFlag = args.indexOf('--env');
dotenv.config({ path: envFlag > -1 ? args[envFlag + 1] : '.env.local', override: true });
const commit = args.includes('--commit');

const { default: Product } = await import('../models/Product.js');
const { default: Profile } = await import('../models/Profile.js');
const { default: Pin } = await import('../models/Pin.js');
const { default: PinLike } = await import('../models/PinLike.js');
const { default: PinComment } = await import('../models/PinComment.js');
const { default: ProductReview } = await import('../models/ProductReview.js');
const { recomputeProductRating } = await import('../controllers/productReview.controller.js');

/** Deterministic pseudo-random, so a re-run produces the same shop. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const PRODUCT_REVIEWS = {
  5: [
    'Exactly what was described. Delivered the day after I paid and the driver called ahead.',
    'Second time ordering this. Same quality as the first, which is more than I can say for the market.',
    'Quality is genuine — I compared it side by side with what I bought at Alaba and there is no contest.',
    'Arrived well packed, nothing broken, and the quantity was correct without me having to count twice.',
    'My mason was impressed, and he complains about everything.',
    'Bought for a site in Uyo, delivered without any drama. Will use them again.',
  ],
  4: [
    'Good quality. Delivery took two days longer than I expected but the supplier kept me updated.',
    'Happy with it overall. One piece had a chip on the edge but it was on a cut anyway.',
    'Does the job well. Slightly more expensive than the market but the convenience is worth it.',
    'Solid product. Would have given five stars if the packaging had been better.',
    'Works as described. The finish is very slightly different from the photo but not enough to matter.',
  ],
  3: [
    'Average. It is what it says it is, no more and no less.',
    'Fine for the price, but check what you are getting before you accept delivery.',
    'Took a while to arrive. The product itself is acceptable.',
  ],
  2: ['Not quite what I expected from the description. Usable but I would look elsewhere next time.'],
};

const PIN_COMMENTS = [
  'This is clean work. How long did the whole thing take?',
  'Please what is the cost estimate for something like this in a 3-bedroom?',
  'The finishing on this is serious. Well done.',
  'I have been looking for exactly this. Do you work in Port Harcourt?',
  'Thank you for explaining the preparation part, most people skip that.',
  'Beautiful. Saving this one for when we start ours.',
  'Does this hold up in the rainy season?',
  'My own guy did something similar and it started peeling after a year. Yours looks much better done.',
  'Sent you a message. Interested in getting a quote.',
  'This is the level of detail I want for my sitting room.',
  'How much material did this take roughly?',
  'Following. Your work is consistent.',
];

await mongoose.connect(process.env.MONGO_URI);
console.log(`\n  database : ${mongoose.connection.name}`);
console.log(`  mode     : ${commit ? 'WRITING' : 'dry run'}\n`);

// ── Who is doing the engaging ────────────────────────────────────────────────
/*
 * Clients and artisans, never the supplier who owns the listing.
 *
 * A supplier reviewing their own product is the kind of thing that is obvious
 * the moment anyone looks, and the server refuses self-orders for the same
 * reason.
 */
const people = await Profile.find({ role: { $in: ['client', 'artisan'] } })
  .select('_id fullName role')
  .lean();

if (people.length < 4) throw new Error(`Only ${people.length} usable profiles — refusing to seed engagement from a handful.`);
console.log(`  reviewers available : ${people.length}`);
people.forEach((p) => console.log(`      ${p.fullName} [${p.role}]`));

const products = await Product.find().select('_id name supplierId').lean();
const pins = await Pin.find().select('_id author sourceType title').lean();

// ── Product reviews ──────────────────────────────────────────────────────────
const random = rng(20260803);
const reviewRows = [];

for (const product of products) {
  // Roughly two in three. An entirely reviewed catalogue is as obviously seeded
  // as an entirely unreviewed one.
  if (random() > 0.68) continue;

  // Never the supplier who sells it.
  const eligible = people.filter((p) => String(p._id) !== String(product.supplierId));
  const count = 1 + Math.floor(random() * Math.min(4, eligible.length));

  const picked = new Set();
  for (let i = 0; i < count; i += 1) {
    const person = eligible[Math.floor(random() * eligible.length)];
    if (picked.has(String(person._id))) continue;
    picked.add(String(person._id));

    // Skewed high, the way marketplace ratings actually are, without being all 5s.
    const roll = random();
    const rating = roll > 0.62 ? 5 : roll > 0.3 ? 4 : roll > 0.12 ? 3 : 2;
    const pool = PRODUCT_REVIEWS[rating];

    reviewRows.push({
      productId: product._id,
      reviewerId: person._id,
      rating,
      comment: pool[Math.floor(random() * pool.length)],
    });
  }
}

// ── Pin likes and comments ───────────────────────────────────────────────────
const likeRows = [];
const commentRows = [];
const commentCounts = new Map();

for (const pin of pins) {
  const eligible = people.filter((p) => String(p._id) !== String(pin.author));

  // Native pins are somebody's own work and attract more than a product photo.
  const ceiling = pin.sourceType === 'native' ? eligible.length : Math.ceil(eligible.length / 2);
  const likes = Math.floor(random() * (ceiling + 1));

  const shuffled = [...eligible].sort(() => random() - 0.5);
  for (const person of shuffled.slice(0, likes)) {
    likeRows.push({ pinId: pin._id, owner: person._id });
  }

  // Comments only on native work, and only on some of it.
  if (pin.sourceType !== 'native' || random() > 0.7) continue;
  const n = 1 + Math.floor(random() * 3);
  for (let i = 0; i < n && i < shuffled.length; i += 1) {
    commentRows.push({
      pinId: pin._id,
      author: shuffled[i]._id,
      body: PIN_COMMENTS[Math.floor(random() * PIN_COMMENTS.length)],
      status: 'active',
    });
    commentCounts.set(String(pin._id), (commentCounts.get(String(pin._id)) ?? 0) + 1);
  }
}

const reviewedProducts = new Set(reviewRows.map((r) => String(r.productId)));
console.log(`\n  product reviews : ${reviewRows.length} across ${reviewedProducts.size}/${products.length} listings`);
console.log(`  pin likes       : ${likeRows.length}`);
console.log(`  pin comments    : ${commentRows.length} across ${commentCounts.size} pins`);

if (!commit) {
  console.log('\n  dry run — nothing written. Add --commit.\n');
  await mongoose.disconnect();
  process.exit(0);
}

// insertMany with ordered:false so one duplicate key — the same person reviewing
// the same product twice — drops that row instead of the whole batch.
const inserted = await ProductReview.insertMany(reviewRows, { ordered: false }).catch((err) => {
  console.log(`  (${err.writeErrors?.length ?? 0} duplicate reviews skipped)`);
  return err.insertedDocs ?? [];
});
console.log(`  wrote ${inserted.length} product reviews`);

await PinLike.insertMany(likeRows, { ordered: false }).catch(() => {});
await PinComment.insertMany(commentRows, { ordered: false }).catch(() => {});

/*
 * Counters have to be recomputed, not incremented.
 *
 * Nothing here went through the controllers that maintain them, so the pin's
 * own like and comment counts would stay at zero while the rows exist — the
 * feed would show engagement of zero on a pin with fourteen likes under it.
 */
for (const pin of pins) {
  const likes = await PinLike.countDocuments({ pinId: pin._id });
  const comments = await PinComment.countDocuments({ pinId: pin._id, status: 'active' });
  await Pin.updateOne({ _id: pin._id }, { $set: { 'counters.likes': likes, 'counters.comments': comments } });
}
console.log('  pin counters recomputed');

for (const id of reviewedProducts) await recomputeProductRating(id);
console.log(`  ratings recomputed for ${reviewedProducts.size} listings`);

await mongoose.disconnect();
console.log('');
