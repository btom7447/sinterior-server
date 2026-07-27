/**
 * backfillPins.js — seed the feed from existing content. Idempotent: every
 * write is an upsert keyed on (sourceType, sourceRef, sourceIndex), so
 * re-running is always safe (it doubles as a full re-sync).
 *
 * Usage (dev):   node --env-file=.env.local src/scripts/backfillPins.js --dry-run
 * Usage (prod):  node --env-file=.env.production src/scripts/backfillPins.js
 *
 * Sources:
 *  1. ArtisanProfile.portfolio  → pins authored by the artisan's Profile
 *     (sourceType 'native', sourceRef = ArtisanProfile._id, sourceIndex = i —
 *     legacy portfolio items are index-keyed because the subdocs have no _id)
 *  2. Product (isActive)        → one pin each via pinSync.service
 *  3. Property (isActive)       → one pin each via pinSync.service
 *  4. FeedPost (published)      → admin pins, if an admin Profile exists
 */
import mongoose from 'mongoose';
import config from '../config/env.js';
import Pin from '../models/Pin.js';
import Profile from '../models/Profile.js';
import ArtisanProfile from '../models/ArtisanProfile.js';
import Product from '../models/Product.js';
import Property from '../models/Property.js';
import FeedPost from '../models/FeedPost.js';
import { syncProductPin, syncPropertyPin } from '../services/pinSync.service.js';
import { TRADES } from '../config/taxonomy.js';

const DRY_RUN = process.argv.includes('--dry-run');

function host(uri) {
  return (uri.match(/@([^/?]+)/) || uri.match(/\/\/([^/?]+)/) || [])[1] || '?';
}

async function run() {
  await mongoose.connect(config.MONGO_URI);
  console.log(
    `[backfillPins] Connected to ${host(config.MONGO_URI)} — db "${mongoose.connection.name}"${DRY_RUN ? ' (DRY RUN — no writes)' : ''}\n`
  );

  const counts = { portfolio: 0, products: 0, properties: 0, feedPosts: 0, skipped: 0 };

  // ── 1. Artisan portfolios ──────────────────────────────────────────────────
  const artisans = await ArtisanProfile.find({ 'portfolio.0': { $exists: true } })
    .select('profileId skillCategory portfolio')
    .lean();
  for (const a of artisans) {
    const trade = TRADES.includes(a.skillCategory) ? a.skillCategory : null;
    const author = await Profile.findById(a.profileId).select('fullName').lean();
    if (!author) {
      counts.skipped += a.portfolio.length;
      continue;
    }
    for (let i = 0; i < a.portfolio.length; i++) {
      const item = a.portfolio[i];
      if (!item?.url) continue;
      counts.portfolio++;
      if (DRY_RUN) continue;
      await Pin.findOneAndUpdate(
        { sourceType: 'native', sourceRef: a._id, sourceIndex: i },
        {
          $set: {
            author: a.profileId,
            mediaType: 'image',
            mediaUrl: item.url,
            title: item.caption?.slice(0, 200) || `Work by ${author.fullName}`,
            caption: item.caption || '',
            'taxonomy.trade': trade,
            status: 'active',
          },
        },
        { upsert: true, setDefaultsOnInsert: true }
      );
    }
  }

  // ── 2 & 3. Products / Properties (reuse the live sync primitives) ──────────
  const products = await Product.find({ isActive: true }).lean();
  for (const p of products) {
    counts.products++;
    if (!DRY_RUN) await syncProductPin(p);
  }
  const properties = await Property.find({ isActive: true }).lean();
  for (const p of properties) {
    counts.properties++;
    if (!DRY_RUN) await syncPropertyPin(p);
  }

  // ── 4. Admin feed posts ────────────────────────────────────────────────────
  const adminProfile = await Profile.findOne({ role: 'admin' }).select('_id').lean();
  if (adminProfile) {
    const posts = await FeedPost.find({ status: 'published' }).lean();
    for (const post of posts) {
      counts.feedPosts++;
      if (DRY_RUN) continue;
      await Pin.findOneAndUpdate(
        { sourceType: 'admin', sourceRef: post._id, sourceIndex: 0 },
        {
          $set: {
            author: adminProfile._id,
            mediaType: post.mediaType || 'image',
            mediaUrl: post.mediaUrl,
            posterUrl: post.posterUrl,
            title: post.title,
            caption: post.caption || '',
            'taxonomy.tags': post.tags || [],
            isFeatured: !!post.isFeatured,
            status: 'active',
          },
        },
        { upsert: true, setDefaultsOnInsert: true }
      );
    }
  } else {
    console.log('[backfillPins] No admin Profile found — skipping FeedPost backfill.');
  }

  const totalPins = await Pin.countDocuments({ status: 'active' });
  console.log('\n[backfillPins] Done:', counts);
  console.log(`[backfillPins] Active pins in DB: ${totalPins}${DRY_RUN ? ' (unchanged — dry run)' : ''}`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('[backfillPins] Error:', err);
  process.exit(1);
});
