/**
 * Mark a user's email as verified.
 *
 * Usage:
 *   node --env-file=.env.local src/scripts/verifyEmail.js <email>
 *
 * Defaults to the first arg, or EMAIL env var, or a hard-coded fallback.
 */
import mongoose from 'mongoose';
import config from '../config/env.js';
import User from '../models/User.js';

const email = process.argv[2] || process.env.EMAIL || 'adoramjohntom1234@gmail.com';

async function run() {
  if (!email) {
    console.error('[verify] No email provided.');
    process.exit(1);
  }

  await mongoose.connect(config.MONGO_URI);
  console.log(`[verify] Connected to MongoDB (${config.NODE_ENV || 'dev'})`);

  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    console.error(`[verify] User "${email}" not found.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  if (user.isEmailVerified) {
    console.log(`[verify] User "${email}" is already verified — nothing to do.`);
    await mongoose.disconnect();
    return;
  }

  user.isEmailVerified = true;
  user.emailVerificationToken = undefined;
  user.emailVerificationExpires = undefined;
  await user.save({ validateBeforeSave: false });

  console.log(`[verify] ✓ Marked ${email} as verified.`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('[verify] Error:', err);
  process.exit(1);
});
