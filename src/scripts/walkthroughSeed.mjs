/**
 * A supplier, a buyer and one product in the dev database, so the money path
 * can be walked end to end against Paystack's test keys.
 *
 * Deliberately not production: this run charges a card, holds escrow, releases
 * it and requests a payout. All of that should happen somewhere disposable.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from './src/models/User.js';
import Profile from './src/models/Profile.js';
import SupplierProfile from './src/models/SupplierProfile.js';
import Product from './src/models/Product.js';
import Wallet from './src/models/Wallet.js';

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
const buyer = await account({
  email: 'walkthrough-buyer@sintherior.test',
  role: 'client',
  fullName: 'Walkthrough Buyer',
});

// A cheap item: this charges a real test card, and a small amount keeps the
// numbers easy to read in the ledger.
const product = await Product.findOneAndUpdate(
  { supplierId: seller._id, name: 'Walkthrough test bag' },
  {
    $set: {
      supplierId: seller._id,
      name: 'Walkthrough test bag',
      category: 'Cement',
      price: 1000,
      unit: 'bag',
      quantity: 100,
      inStock: true,
      images: ['https://res.cloudinary.com/djhlvgk97/image/upload/v1776105546/sinterior/eethw9bb0nopmc0edolm.webp'],
      isActive: true,
    },
  },
  { upsert: true, new: true, setDefaultsOnInsert: true }
);

// Start the seller's wallet from zero so the deltas this run produces are
// unambiguous rather than buried in whatever was there before.
await Wallet.findOneAndUpdate(
  { profileId: seller._id },
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

console.log(`  product  ${product.name} at ₦${product.price}, ${product.quantity} in stock`);
console.log(`\nseller profile: ${seller._id}`);
console.log(`buyer profile:  ${buyer._id}`);
await mongoose.disconnect();
