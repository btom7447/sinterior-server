import { Router } from 'express';
import asyncHandler from '../utils/asyncHandler.js';
import FeedPost from '../models/FeedPost.js';
import ArtisanProfile from '../models/ArtisanProfile.js';

const router = Router();

// GET /api/v1/feed — combined feed of admin-managed posts + artisan portfolio items.
// Returns a single normalised array sorted with featured admin posts first, then
// most-recently-updated portfolio items, then everything else by date.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 60, 200);
    const skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);

    const [adminPosts, artisans] = await Promise.all([
      FeedPost.find({ status: 'published' })
        .sort({ isFeatured: -1, publishedAt: -1 })
        .lean(),
      ArtisanProfile.find({ portfolio: { $exists: true, $not: { $size: 0 } } })
        .populate('profileId', 'fullName avatarUrl')
        .sort({ updatedAt: -1 })
        .lean(),
    ]);

    const adminItems = adminPosts.map((p) => ({
      kind: 'admin',
      id: `admin:${p._id}`,
      title: p.title,
      caption: p.caption || '',
      mediaType: p.mediaType || 'image',
      // Back-compat: pre-revamp rows store the URL under `imageUrl`.
      mediaUrl: p.mediaUrl || p.imageUrl,
      posterUrl: p.posterUrl || null,
      linkUrl: p.linkUrl || null,
      tags: p.tags || [],
      isFeatured: !!p.isFeatured,
      author: { name: 'Sintherior', avatarUrl: null, role: 'platform' },
      createdAt: p.publishedAt || p.createdAt,
    }));

    const portfolioItems = [];
    for (const a of artisans) {
      for (const item of a.portfolio || []) {
        if (!item?.url) continue;
        portfolioItems.push({
          kind: 'portfolio',
          id: `portfolio:${a._id}:${item.url}`,
          title: item.caption || a.skill || 'Artisan work',
          caption: item.caption || '',
          mediaType: 'image',
          mediaUrl: item.url,
          posterUrl: null,
          linkUrl: `/artisan/${a._id}`,
          tags: [a.skillCategory].filter(Boolean),
          isFeatured: false,
          author: {
            name: a.profileId?.fullName || 'Artisan',
            avatarUrl: a.profileId?.avatarUrl || null,
            role: a.skill || 'Artisan',
            isVerified: !!a.isVerified,
          },
          createdAt: a.updatedAt,
        });
      }
    }

    // Featured admin posts first, then everything else interleaved by date.
    const featured = adminItems.filter((i) => i.isFeatured);
    const rest = [...adminItems.filter((i) => !i.isFeatured), ...portfolioItems].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );

    const merged = [...featured, ...rest];
    const total = merged.length;
    const items = merged.slice(skip, skip + limit);

    res.json({ success: true, data: { items, total, hasMore: skip + items.length < total } });
  })
);

export default router;
