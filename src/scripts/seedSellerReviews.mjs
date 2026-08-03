/**
 * Ratings for the sellers themselves, not just their listings.
 *
 * Product reviews were seeded; the sellers were not, so every storefront and
 * every seller line on a product page read "No reviews yet". On a marketplace
 * of strangers that is the number people actually judge on — somebody deciding
 * whether to send money for a lorry of cement is judging the seller, not the
 * cement.
 *
 * Note the field name. `Review.artisanId` holds whichever profile is being
 * reviewed, artisan or supplier: the model predates suppliers being reviewable
 * and was never renamed. recomputeAggregates already routes the result to the
 * right detail collection by reading the profile's role, so a supplier review
 * lands on SupplierProfile.rating exactly as it should — the name is the only
 * thing misleading about it.
 *
 * Reviewers are real accounts, and never the seller reviewing themselves.
 *
 * Usage: node src/scripts/seedSellerReviews.mjs --env .env.production [--commit]
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

const args = process.argv.slice(2);
const envFlag = args.indexOf('--env');
dotenv.config({ path: envFlag > -1 ? args[envFlag + 1] : '.env.local', override: true });
const commit = args.includes('--commit');

const { default: Review } = await import('../models/Review.js');
const { default: Profile } = await import('../models/Profile.js');
const { default: SupplierProfile } = await import('../models/SupplierProfile.js');
const { default: ArtisanProfile } = await import('../models/ArtisanProfile.js');

/** Deterministic, so a re-run produces the same shop. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const COMMENTS = {
  5: [
    'Delivered exactly when they said they would. No stories.',
    'I have used them three times now. Consistent every time.',
    'Called ahead, driver was polite, everything accounted for. Rare.',
    'They picked up the phone every time I rang. That alone is worth it.',
    'Quality was as described and the price did not change at the last minute.',
  ],
  4: [
    'Good to deal with. Delivery was a day later than promised but they told me in advance.',
    'Solid supplier. Communication could be a little faster.',
    'No complaints about the goods. The paperwork took some chasing.',
  ],
  3: [
    'Order arrived complete but it took longer than I was told.',
    'Fine. Nothing went wrong, nothing stood out.',
  ],
};

await mongoose.connect(process.env.MONGO_URI);
console.log(`\n  database : ${mongoose.connection.name}`);
console.log(`  mode     : ${commit ? 'WRITING' : 'dry run'}\n`);

// Sellers are anyone who can be sold from: suppliers, and artisans who take
// jobs. Both are reviewed through the same collection.
const sellers = await Profile.find({ role: { $in: ['supplier', 'artisan'] } })
  .select('_id fullName role')
  .lean();
const reviewers = await Profile.find({ role: { $in: ['client', 'artisan'] } })
  .select('_id fullName')
  .lean();

const random = rng(20260803);
const rows = [];

for (const seller of sellers) {
  const eligible = reviewers.filter((r) => String(r._id) !== String(seller._id));
  // Two to five each: enough for an average to mean something, few enough that
  // it reads like a young marketplace rather than a fabricated one.
  const wanted = Math.min(eligible.length, 2 + Math.floor(random() * 4));

  const shuffled = [...eligible].sort(() => random() - 0.5).slice(0, wanted);
  for (const reviewer of shuffled) {
    const roll = random();
    const rating = roll > 0.55 ? 5 : roll > 0.22 ? 4 : 3;
    const pool = COMMENTS[rating];
    rows.push({
      // Whichever profile is being reviewed — see the note at the top.
      artisanId: seller._id,
      reviewerId: reviewer._id,
      rating,
      comment: pool[Math.floor(random() * pool.length)],
    });
  }
}

for (const seller of sellers) {
  const mine = rows.filter((r) => String(r.artisanId) === String(seller._id));
  const avg = mine.reduce((s, r) => s + r.rating, 0) / Math.max(1, mine.length);
  console.log(`  ${seller.fullName.padEnd(16)} [${seller.role}] ${mine.length} reviews, avg ${avg.toFixed(1)}`);
}
console.log(`\n  total : ${rows.length} seller reviews`);

if (!commit) {
  console.log('\n  dry run — nothing written. Add --commit.\n');
  await mongoose.disconnect();
  process.exit(0);
}

// ordered:false so a duplicate — the unique index is reviewer + seller — drops
// that row rather than the whole batch.
const inserted = await Review.insertMany(rows, { ordered: false }).catch((err) => {
  console.log(`  (${err.writeErrors?.length ?? 0} duplicates skipped)`);
  return err.insertedDocs ?? [];
});
console.log(`  wrote ${inserted.length} reviews`);

/*
 * Recompute rather than increment, and per seller.
 *
 * None of this went through the controller that maintains the aggregates, so
 * without it every storefront would still read "No reviews yet" while the rows
 * sat in the database — which is the exact failure this seed exists to fix.
 */
for (const seller of sellers) {
  const stats = await Review.aggregate([
    { $match: { artisanId: seller._id } },
    { $group: { _id: null, count: { $sum: 1 }, avg: { $avg: '$rating' } } },
  ]);
  const count = stats[0]?.count ?? 0;
  const avg = stats[0]?.avg ? Math.round(stats[0].avg * 10) / 10 : 0;

  const Model = seller.role === 'supplier' ? SupplierProfile : ArtisanProfile;
  await Model.updateOne(
    { profileId: seller._id },
    { $set: { rating: avg, reviewCount: count } },
    { upsert: true }
  );
}
console.log(`  aggregates recomputed for ${sellers.length} sellers\n`);

await mongoose.disconnect();
