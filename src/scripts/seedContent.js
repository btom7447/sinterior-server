/**
 * Seed blog posts and career listings for demo/initial content.
 *
 * Usage:
 *   node --env-file=.env.local src/scripts/seedContent.js
 */
import mongoose from 'mongoose';
import config from '../config/env.js';
import BlogPost from '../models/BlogPost.js';
import CareerListing from '../models/CareerListing.js';
import User from '../models/User.js';
import Profile from '../models/Profile.js';

const blogSeed = [
  {
    title: 'How to Hire Verified Artisans in Nigeria Without Getting Burned',
    slug: 'how-to-hire-verified-artisans-nigeria',
    excerpt:
      "We break down what to look for when hiring a builder, plumber, or electrician — and how Sintherior's verification process protects you.",
    body: `Hiring artisans in Nigeria has long been a game of trust. Too often, homeowners are left with unfinished work, inflated bills, or workmanship that simply doesn't match the quote.

At Sintherior, we built our verification process to flip that experience on its head.

## What verification actually means

When an artisan is marked as "verified" on Sintherior, it means:

- **Identity confirmed** — We've matched their CAC certificate or business license to a valid government ID.
- **Portfolio reviewed** — Our team has manually inspected their portfolio for consistency and quality.
- **Client-reviewed** — Only after completing jobs on the platform do verified artisans accumulate their first reviews.

## How to spot a great artisan

1. Look for the blue verification badge on their profile.
2. Read the last 5–10 reviews (not just the top ones).
3. Check their pricing — unusually low prices often signal cut corners.
4. Ask for a breakdown of materials vs. labour in the quote.

## Use the platform, not private deals

It's tempting to take conversations off-platform to "save money." Don't. Every transaction processed through Sintherior is covered by our dispute resolution, which means if something goes wrong, we can step in.

Happy building.`,
    coverImage: 'https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=1200&q=80',
    tags: ['guides', 'artisans', 'hiring'],
    status: 'published',
  },
  {
    title: 'Construction Materials Price Guide — Q1 2026',
    slug: 'construction-materials-price-guide-2026',
    excerpt:
      'Updated pricing for cement, iron rods, roofing sheets, and tiles across major Nigerian cities.',
    body: `Prices for core construction materials have shifted meaningfully since late 2025. Here's our snapshot for Q1 2026 across Lagos, Abuja, and Port Harcourt.

## Cement

- Dangote 50kg: ₦8,900 – ₦9,500 (Lagos), ₦9,200 – ₦9,800 (Abuja)
- BUA 50kg: ₦8,500 – ₦9,100 (Lagos)
- Lafarge 50kg: ₦8,700 – ₦9,300 (Lagos)

## Iron rods

- 12mm: ₦8,500/length
- 16mm: ₦14,800/length
- 20mm: ₦23,000/length

## Tiles (per box, approx. 1.44m²)

- Standard porcelain: ₦5,500 – ₦9,000
- Premium Spanish imports: ₦14,000 – ₦32,000

## Planning tip

Always buy cement within 2 weeks of use — stockpiling beyond that risks quality degradation in humid climates.`,
    coverImage: 'https://images.unsplash.com/photo-1587293852726-70cdb56c2866?w=1200&q=80',
    tags: ['market', 'materials', 'pricing'],
    status: 'published',
  },
  {
    title: '5 Ways to Make Your Artisan Profile Stand Out',
    slug: 'artisan-profile-tips',
    excerpt:
      'Simple changes to your Sintherior profile that lead to more client inquiries and higher rates.',
    body: `Your Sintherior profile is your storefront. Here's how top-earning artisans set theirs up.

## 1. Professional profile photo

Skip the selfies. A clean head-and-shoulders shot in work attire builds trust instantly.

## 2. Detailed portfolio (10+ images minimum)

Show before/after pairs, progress shots, and finished details. Clients want to see your hand.

## 3. Complete every field

Profiles missing pricing, hours, or service radius get filtered out of search results. Fill everything.

## 4. Specific skill descriptions

Instead of "Plumber", write "Commercial and residential plumbing — new builds, repairs, and fixture installation."

## 5. Respond fast

Our data shows artisans who respond within 1 hour win 3x more jobs than those who take a full day.`,
    coverImage: 'https://images.unsplash.com/photo-1621905251189-08b45d6a269e?w=1200&q=80',
    tags: ['tips', 'artisans'],
    status: 'published',
  },
  {
    title: "Inside Sintherior's Supplier Verification Process",
    slug: 'supplier-verification-process',
    excerpt:
      'A behind-the-scenes look at how we vet every supplier before they can list products on the platform.',
    body: `Every product you see on Sintherior comes from a supplier we've personally vetted. Here's how the process works.

## Step 1 — Business registration

We require a valid CAC certificate and tax ID. No exceptions. This filters out fly-by-night sellers immediately.

## Step 2 — Physical address verification

Our operations team confirms either a warehouse address or a verified storefront location.

## Step 3 — Product quality sampling

For categories like tiles, cement, and steel, we request samples and perform basic quality checks.

## Step 4 — Ongoing monitoring

Once verified, suppliers are monitored for:
- Buyer complaint rate
- Shipping reliability
- Price consistency with market

Fall below our thresholds and verification can be revoked.`,
    coverImage: 'https://images.unsplash.com/photo-1587293852726-70cdb56c2866?w=1200&q=80',
    tags: ['platform', 'verification'],
    status: 'published',
  },
];

const careersSeed = [
  {
    title: 'Senior Frontend Engineer',
    department: 'Engineering',
    location: 'Lagos, Nigeria',
    type: 'full-time',
    description: `Build and maintain high-quality React/Next.js features that serve thousands of construction professionals daily.

You'll own end-to-end features across our client, artisan, and supplier experiences — from database schema through to shipped UI. We're looking for someone who cares deeply about performance, accessibility, and developer experience.`,
    requirements: `- 5+ years of frontend experience, 3+ with React
- Deep knowledge of Next.js (App Router) and TypeScript
- Strong CSS and design sensibility
- Experience with marketplace or multi-sided product surfaces is a plus
- Track record of shipping features end-to-end`,
    status: 'open',
  },
  {
    title: 'Product Designer',
    department: 'Design',
    location: 'Lagos, Nigeria (Hybrid)',
    type: 'full-time',
    description: `Own the end-to-end design of new product areas, from user research through polished shipped UI.

You'll work directly with engineering, customer success, and leadership to identify problems, prototype solutions, and validate with real users across our three-sided marketplace.`,
    requirements: `- 4+ years designing consumer or marketplace products
- Strong portfolio showing shipped work, not just mockups
- Comfort with Figma and rapid prototyping
- Experience running user research sessions
- Bonus: visual identity or brand design experience`,
    status: 'open',
  },
  {
    title: 'Artisan Onboarding Specialist',
    department: 'Operations',
    location: 'Multiple Cities',
    type: 'full-time',
    description: `Visit and verify artisans across Nigeria, helping them set up profiles and get their first clients on Sintherior.

This is a field-heavy role that involves significant travel across Lagos, Abuja, Port Harcourt, and Ibadan. You'll be the face of Sintherior for the artisan community.`,
    requirements: `- 2+ years in field operations, sales, or community building
- Comfortable with travel and in-person meetings
- Fluent in English and at least one Nigerian language
- Valid driver's license
- Strong written communication for profile writing assistance`,
    status: 'open',
  },
  {
    title: 'Backend Engineer',
    department: 'Engineering',
    location: 'Remote (Nigeria)',
    type: 'full-time',
    description: `Design and implement scalable APIs and data pipelines powering the Sintherior marketplace.

You'll work across order processing, payments, search, notifications, and real-time chat — touching the full stack of our Node.js + MongoDB infrastructure.`,
    requirements: `- 4+ years of backend engineering experience
- Strong Node.js (Express preferred) and MongoDB
- Experience with real-time systems (Socket.IO or similar)
- Understanding of payment integrations (Paystack a plus)
- Strong attention to security and correctness`,
    status: 'open',
  },
  {
    title: 'Customer Success Associate',
    department: 'Support',
    location: 'Lagos, Nigeria',
    type: 'full-time',
    description: `Help clients, artisans, and suppliers get the most value from the platform through proactive support.

You'll handle inbound inquiries across email, WhatsApp, and in-app chat, resolve disputes, and flag product issues for the engineering team.`,
    requirements: `- 1-3 years in customer support or account management
- Excellent written English
- Calm under pressure, especially when handling disputes
- Comfortable with CRM tools and ticketing systems
- Nigerian market knowledge required`,
    status: 'open',
  },
];

async function seed() {
  await mongoose.connect(config.MONGO_URI);
  console.log('[seed] Connected to MongoDB');

  // Find admin user to author blog posts
  const adminUser = await User.findOne({ role: 'admin' });
  if (!adminUser) {
    console.log('[seed] No admin user found. Run seedAdmin.js first.');
    await mongoose.disconnect();
    return;
  }
  const adminProfile = await Profile.findOne({ userId: adminUser._id });
  if (!adminProfile) {
    console.log('[seed] No admin profile found.');
    await mongoose.disconnect();
    return;
  }

  // Blog posts
  for (const post of blogSeed) {
    const existing = await BlogPost.findOne({ slug: post.slug });
    if (existing) {
      console.log(`[seed] Blog post "${post.slug}" already exists — skipping.`);
      continue;
    }
    await BlogPost.create({
      ...post,
      author: adminProfile._id,
      publishedAt: post.status === 'published' ? new Date() : undefined,
    });
    console.log(`[seed] Created blog post: ${post.slug}`);
  }

  // Career listings
  for (const listing of careersSeed) {
    const existing = await CareerListing.findOne({ title: listing.title });
    if (existing) {
      console.log(`[seed] Career listing "${listing.title}" already exists — skipping.`);
      continue;
    }
    await CareerListing.create(listing);
    console.log(`[seed] Created career listing: ${listing.title}`);
  }

  console.log('[seed] Done.');
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('[seed] Error:', err);
  process.exit(1);
});
