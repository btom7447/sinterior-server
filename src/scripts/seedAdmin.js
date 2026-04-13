/**
 * Seed an admin user + profile.
 *
 * Usage:
 *   node --env-file=.env.local src/scripts/seedAdmin.js
 *
 * Or with dotenv already loaded via your npm script.
 *
 * Environment variables (or edit the defaults below):
 *   ADMIN_EMAIL     – defaults to admin@sintherior.com
 *   ADMIN_PASSWORD  – defaults to Admin@12345
 */
import mongoose from 'mongoose';
import config from '../config/env.js';
import User from '../models/User.js';
import Profile from '../models/Profile.js';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@sintherior.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@12345';

async function seed() {
  await mongoose.connect(config.MONGO_URI);
  console.log('[seed] Connected to MongoDB');

  const existing = await User.findOne({ email: ADMIN_EMAIL });
  if (existing) {
    console.log(`[seed] Admin user already exists (${ADMIN_EMAIL}). Skipping.`);
    await mongoose.disconnect();
    return;
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const [user] = await User.create(
      [
        {
          email: ADMIN_EMAIL,
          passwordHash: ADMIN_PASSWORD, // hashed by pre-save hook
          role: 'admin',
          isEmailVerified: true,
        },
      ],
      { session }
    );

    await Profile.create(
      [
        {
          userId: user._id,
          fullName: 'Super Admin',
          role: 'admin',
        },
      ],
      { session }
    );

    await session.commitTransaction();
    console.log(`[seed] Admin user created: ${ADMIN_EMAIL}`);
  } catch (err) {
    await session.abortTransaction();
    console.error('[seed] Failed to create admin:', err.message);
  } finally {
    session.endSession();
    await mongoose.disconnect();
  }
}

seed();
