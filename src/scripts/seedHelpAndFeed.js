/**
 * Seed help articles + feed posts.
 *
 * Usage:
 *   node --env-file=.env.local src/scripts/seedHelpAndFeed.js
 */
import mongoose from 'mongoose';
import config from '../config/env.js';
import HelpArticle from '../models/HelpArticle.js';
import FeedPost from '../models/FeedPost.js';

const slugify = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const helpSeed = [
  // Getting Started
  {
    category: 'Getting Started',
    emoji: '🚀',
    order: 1,
    title: 'How to create a Sintherior account',
    excerpt: 'Step-by-step guide to signing up and choosing the right account type.',
    body: `# Getting started on Sintherior\n\nCreating an account takes about 2 minutes.\n\n## 1. Pick your role\nClick **Sign up** and choose:\n- **Client** — you want to hire artisans or buy materials\n- **Artisan** — you offer trades and want to find work\n- **Supplier** — you sell construction materials and equipment\n\n## 2. Verify your email\nWe send a confirmation link. Click it within 24 hours.\n\n## 3. Complete onboarding\nFill in your profile basics. Artisans and suppliers go through a longer onboarding (portfolio, certifications, location).\n\nYou're live the moment you finish onboarding.`,
  },
  {
    category: 'Getting Started',
    emoji: '🚀',
    order: 2,
    title: 'Choosing the right account type',
    excerpt: 'Client, artisan, or supplier — pick the one that matches what you do.',
    body: `## Which account type is for you?\n\n- **Client** — homeowners, project managers, anyone hiring artisans or buying materials\n- **Artisan** — electricians, plumbers, carpenters, painters, masons, etc.\n- **Supplier** — sellers of cement, tiles, paints, fixtures, tools, and other building materials\n\nYou can hold one role per account. If you do both (e.g. an artisan who also sells materials), use two separate accounts.`,
  },
  {
    category: 'Getting Started',
    emoji: '🚀',
    order: 3,
    title: 'Understanding the verification process',
    excerpt: 'Why verification matters and what we check.',
    body: `## Verification builds trust\n\nClients prefer verified artisans and suppliers. Verification means we've checked:\n- Government-issued ID\n- Business documents (CAC certificate, tax ID, or business licence) for sellers\n- Trade certifications where applicable\n- A working phone number\n\nVerified accounts display a shield badge. Unverified accounts can still operate but show an unverified shield.\n\nApply from your dashboard under **Verification**.`,
  },

  // For Clients
  {
    category: 'For Clients',
    emoji: '🏠',
    order: 1,
    title: 'How to find and hire an artisan',
    excerpt: 'Finding the right artisan and submitting a hire request.',
    body: `## Finding an artisan\n\n1. Go to **Artisans** and search by skill, category, or city.\n2. Use **Find nearby** to surface artisans within your radius.\n3. Open a profile to see portfolio, reviews, daily rate, and verification status.\n\n## Sending a hire request\n\nOn the profile page, choose:\n- **Hire urgently** — for jobs you need started right away\n- **Book for later** — pick a date; the artisan accepts and the booking shows under Appointments\n\nYou'll be charged the artisan's daily rate for every day the job stays in progress. Both of you confirm start and end before payment is finalised.`,
  },
  {
    category: 'For Clients',
    emoji: '🏠',
    order: 2,
    title: 'How to browse and purchase products',
    excerpt: 'Browsing the marketplace and placing an order.',
    body: `## Browsing\n\nOpen **Products** and filter by category, price, or supplier. Click a product to see specs, images, and supplier info.\n\n## Placing an order\n\n1. Add items to your cart\n2. Pick delivery address and payment method (card, transfer, or USSD)\n3. Confirm — the supplier is notified and starts fulfilling\n\nOrders go through pending → confirmed → shipped → delivered. You'll get an email at each step.`,
  },
  {
    category: 'For Clients',
    emoji: '🏠',
    order: 3,
    title: 'Tracking your orders and jobs',
    excerpt: 'Where to find status updates for orders and active jobs.',
    body: `Open **Dashboard → Orders** for product orders and **Dashboard → My Jobs** for hire requests. Each row shows current status, amount, and lets you message the other party.`,
  },
  {
    category: 'For Clients',
    emoji: '🏠',
    order: 4,
    title: 'Raising a dispute',
    excerpt: 'How to flag a problem with an order or a job.',
    body: `## When to raise a dispute\n\nUse the **Raise a Dispute** button on a job or order if:\n- Work doesn't match what was agreed\n- A delivery is missing or damaged\n- The other party isn't responding\n\nOur team reviews disputes within 48 hours and contacts both parties.`,
  },

  // For Artisans
  {
    category: 'For Artisans',
    emoji: '🔧',
    order: 1,
    title: 'Getting verified as an artisan',
    excerpt: 'Submitting documents to earn the verified badge.',
    body: `## Why get verified\n\nVerified artisans win 3× more jobs. Submit:\n- A government-issued ID\n- Trade certificate (if you have one)\n- A clear selfie holding the ID\n\nApply from **Dashboard → Verification**. Reviews take 1–3 business days.`,
  },
  {
    category: 'For Artisans',
    emoji: '🔧',
    order: 2,
    title: 'Setting your daily rate and availability',
    excerpt: 'How daily-rate billing works on Sintherior.',
    body: `## How payment works\n\nYou set a **daily rate**. When a client hires you, we lock in that rate.\n\nThe job is billed for every day it stays in progress — from when both of you confirm start until both of you confirm end. Daily rate × days = total amount the client pays.\n\n## Updating your rate\n\nOpen **Dashboard → Professional Profile → Overview & Pricing**. Changes only affect future hires, not jobs already in progress.`,
  },
  {
    category: 'For Artisans',
    emoji: '🔧',
    order: 3,
    title: 'Managing client requests',
    excerpt: 'Accepting, rejecting, and confirming start/end of jobs.',
    body: `## When a request comes in\n\nYou'll get an email and an in-app notification. Open the job and choose **Accept** or **Decline**.\n\n## During the job\n\n- Both of you tap **Confirm start** — the daily-billing clock starts\n- Chat with the client throughout for any details\n- When the job is done, both of you tap **Confirm completion** — the final amount is computed automatically`,
  },
  {
    category: 'For Artisans',
    emoji: '🔧',
    order: 4,
    title: 'Getting paid',
    excerpt: 'Payouts after a job is completed.',
    body: `Once both parties confirm completion, the client pays the platform. Funds clear into your account within 2 business days, minus the platform fee (set on your dashboard under Earnings).`,
  },

  // For Suppliers
  {
    category: 'For Suppliers',
    emoji: '📦',
    order: 1,
    title: 'Listing your products',
    excerpt: 'Adding new products and writing good listings.',
    body: `## Quick start\n\nOpen **Dashboard → Products → Add product**. Each listing needs:\n- A clear title\n- Multiple high-quality photos (recommend 3+)\n- Specs (dimensions, weight, material) — buyers filter on these\n- Stock count\n- Price\n\nUse all 10 photo slots — listings with full galleries get 60% more clicks.`,
  },
  {
    category: 'For Suppliers',
    emoji: '📦',
    order: 2,
    title: 'Managing inventory',
    excerpt: 'Stock levels and how out-of-stock products are surfaced.',
    body: `Set **stock = 0** to mark a product out of stock. Out-of-stock items still show on your storefront but can't be added to cart. Update stock counts via the bulk inventory editor or product-by-product.`,
  },
  {
    category: 'For Suppliers',
    emoji: '📦',
    order: 3,
    title: 'Processing orders',
    excerpt: 'Order workflow from confirmation to delivery.',
    body: `When an order comes in:\n1. **Confirm** — within 24 hours\n2. **Ship** — once dispatched, mark shipped (the buyer is notified)\n3. **Delivered** — the buyer or you mark delivered\n\nDelayed confirmations hurt your supplier rating.`,
  },

  // Payments & Billing
  {
    category: 'Payments & Billing',
    emoji: '💳',
    order: 1,
    title: 'Accepted payment methods',
    excerpt: 'Cards, bank transfers, and USSD.',
    body: `Sintherior accepts:\n- **Card** (Visa, Mastercard, Verve)\n- **Bank transfer** (instant via Paystack)\n- **USSD** (most Nigerian banks)\n\nAll payments process through Paystack. We never store your card details.`,
  },
  {
    category: 'Payments & Billing',
    emoji: '💳',
    order: 2,
    title: 'How payouts work for artisans',
    excerpt: 'When and how you get paid after a job.',
    body: `Funds clear into your linked bank account within 2 business days of a completed job. Platform fee is deducted automatically. View payout history under **Dashboard → Earnings**.`,
  },

  // Account & Security
  {
    category: 'Account & Security',
    emoji: '🔒',
    order: 1,
    title: 'Changing your password',
    excerpt: 'Updating your password from settings.',
    body: `Open **Dashboard → Settings → Security**, click **Change password**, enter your current password and the new one. We'll send a confirmation email.`,
  },
  {
    category: 'Account & Security',
    emoji: '🔒',
    order: 2,
    title: 'Reporting a suspicious account',
    excerpt: 'How to flag accounts that violate our policies.',
    body: `Click the **Report** option on any profile or use the **Report a problem** link in the footer. Include screenshots and a short explanation. Our trust & safety team responds within 24 hours.`,
  },
];

const feedSeed = [
  {
    title: 'Welcome to the Sintherior community',
    caption:
      'Discover talented artisans, premium suppliers, and inspiring projects from across Nigeria.',
    imageUrl:
      'https://images.unsplash.com/photo-1581094794329-c8112a89af12?w=1200&q=80',
    tags: ['platform', 'community'],
    isFeatured: true,
    status: 'published',
  },
  {
    title: 'How to choose the right artisan',
    caption:
      'Tips for vetting profiles, reading reviews, and getting an accurate quote before you hire.',
    imageUrl:
      'https://images.unsplash.com/photo-1503387762-592deb58ef4e?w=1200&q=80',
    linkUrl: '/help',
    tags: ['guides', 'clients'],
    isFeatured: false,
    status: 'published',
  },
  {
    title: 'Q1 2026 cement price update',
    caption:
      'Latest snapshot of Dangote, BUA and Lafarge prices across Lagos, Abuja and Port Harcourt.',
    imageUrl:
      'https://images.unsplash.com/photo-1587293852726-70cdb56c2866?w=1200&q=80',
    linkUrl: '/blog/construction-materials-price-guide-2026',
    tags: ['market', 'materials'],
    isFeatured: false,
    status: 'published',
  },
  {
    title: 'Shop premium tiles',
    caption: 'Spanish and Italian imports plus locally crafted designs from verified suppliers.',
    imageUrl:
      'https://images.unsplash.com/photo-1615529182904-14819c35db37?w=1200&q=80',
    linkUrl: '/products?category=Tiles',
    tags: ['marketplace', 'tiles'],
    isFeatured: false,
    status: 'published',
  },
  {
    title: 'Artisans, set up your professional profile',
    caption:
      'Add your daily rate, portfolio, and exact location to start showing up in nearby searches.',
    imageUrl:
      'https://images.unsplash.com/photo-1581092335397-9583eb92d232?w=1200&q=80',
    linkUrl: '/dashboard/artisan-profile',
    tags: ['artisans', 'tips'],
    isFeatured: false,
    status: 'published',
  },
];

async function seed() {
  await mongoose.connect(config.MONGO_URI);
  console.log('[seed] Connected to MongoDB');

  for (const article of helpSeed) {
    const slug = slugify(article.title);
    const existing = await HelpArticle.findOne({ slug });
    if (existing) {
      console.log(`[seed] Help article "${slug}" already exists — skipping.`);
      continue;
    }
    await HelpArticle.create({ ...article, slug, status: 'published' });
    console.log(`[seed] Created help article: ${slug}`);
  }

  for (const post of feedSeed) {
    const existing = await FeedPost.findOne({ title: post.title });
    if (existing) {
      console.log(`[seed] Feed post "${post.title}" already exists — skipping.`);
      continue;
    }
    await FeedPost.create({
      ...post,
      publishedAt: post.status === 'published' ? new Date() : undefined,
    });
    console.log(`[seed] Created feed post: ${post.title}`);
  }

  console.log('[seed] Done.');
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('[seed] Error:', err);
  process.exit(1);
});
