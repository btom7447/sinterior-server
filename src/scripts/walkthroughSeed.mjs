/**
 * A supplier, a buyer and one product in the dev database, so the money path
 * can be walked end to end against Paystack's test keys.
 *
 * Deliberately not production: this run charges a card, holds escrow, releases
 * it and requests a payout. All of that should happen somewhere disposable.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User.js';
import Profile from '../models/Profile.js';
import SupplierProfile from '../models/SupplierProfile.js';
import Product from '../models/Product.js';
import Wallet from '../models/Wallet.js';

// .env.local is what the local server is running on: test Paystack, dev Mongo.
dotenv.config({ path: '.env.local', override: true });
await mongoose.connect(process.env.MONGO_URI);
if (mongoose.connection.name !== 'sinterior-dev') {
  throw new Error(`expected sinterior-dev, got "${mongoose.connection.name}"`);
}
console.log(`database: ${mongoose.connection.name}`);

const PASSWORD = 'Password@123';

async function account({ email, role, fullName }) {
  let user = await User.findOne({ email });
  if (!user) {
    user = new User({ email, passwordHash: PASSWORD, role, isEmailVerified: true });
    await user.save();
  } else {
    user.passwordHash = PASSWORD;
    user.role = role;
    await user.save();
  }

  let profile = await Profile.findOne({ userId: user._id });
  if (!profile) {
    profile = await Profile.create({ userId: user._id, fullName, role, state: 'Lagos' });
  } else {
    profile.role = role;
    await profile.save();
  }

  if (role === 'supplier') {
    await SupplierProfile.findOneAndUpdate(
      { profileId: profile._id },
      { $set: { businessName: 'Walkthrough Supplies', shippingRates: { Lagos: 0 } } },
      { upsert: true, setDefaultsOnInsert: true }
    );
  }
  console.log(`  ${role.padEnd(8)} ${email} · profile ${profile._id}`);
  return profile;
}

const seller = await account({
  email: 'walkthrough-seller@sintherior.test',
  role: 'supplier',
  fullName: 'Walkthrough Seller',
});
/*
 * A second seller, so an order can span two of them.
 *
 * The per-supplier escrow split has never had more than one entry to split
 * into, which means the loop that divides a payment between sellers has run
 * exactly once per order and always over a single element. That is the shape
 * where a bug hides.
 */
const seller2 = await account({
  email: 'walkthrough-seller2@sintherior.test',
  role: 'supplier',
  fullName: 'Walkthrough Seller Two',
});
const buyer = await account({
  email: 'walkthrough-buyer@sintherior.test',
  role: 'client',
  fullName: 'Walkthrough Buyer',
});
/** Refunds, force-releases and payout transfers are all admin-only. */
const admin = await account({
  email: 'walkthrough-admin@sintherior.test',
  role: 'admin',
  fullName: 'Walkthrough Admin',
});

// A cheap item: this charges a real test card, and a small amount keeps the
// numbers easy to read in the ledger.
const IMAGE =
  'https://res.cloudinary.com/djhlvgk97/image/upload/v1776105546/sinterior/eethw9bb0nopmc0edolm.webp';

const listing = (owner, name, price) =>
  Product.findOneAndUpdate(
    { supplierId: owner._id, name },
    {
      $set: {
        supplierId: owner._id,
        name,
        category: 'Cement',
        price,
        unit: 'bag',
        quantity: 100,
        inStock: true,
        images: [IMAGE],
        isActive: true,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

const product = await listing(seller, 'Walkthrough test bag', 1000);
// Priced differently so a split cannot pass by coincidence — two equal halves
// would look correct even if the loop divided the total evenly instead of by
// what each seller actually sold.
const product2 = await listing(seller2, 'Walkthrough test bag (two)', 2500);

// Start the seller's wallet from zero so the deltas this run produces are
// unambiguous rather than buried in whatever was there before.
for (const owner of [seller, seller2]) {
await Wallet.findOneAndUpdate(
  { profileId: owner._id },
  {
    $set: {
      pendingBalance: 0,
      holdingBalance: 0,
      availableBalance: 0,
      feesOwed: 0,
      totalEarned: 0,
      totalPaidOut: 0,
    },
  },
  { upsert: true, setDefaultsOnInsert: true }
);
}

console.log(`  product  ${product.name} at ₦${product.price}`);
console.log(`  product  ${product2.name} at ₦${product2.price}`);
console.log(`\nseller  profile: ${seller._id}`);
console.log(`seller2 profile: ${seller2._id}`);
console.log(`buyer   profile: ${buyer._id}`);
console.log(`admin   profile: ${admin._id}`);
await mongoose.disconnect();
