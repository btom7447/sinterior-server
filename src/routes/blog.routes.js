import { Router } from 'express';
import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/AppError.js';
import BlogPost from '../models/BlogPost.js';
import { getPagination, buildPaginationMeta } from '../utils/paginate.js';

const router = Router();

// GET /api/v1/blog — public list of published posts
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = getPagination(req.query);

    const filter = { status: 'published' };
    if (req.query.tag) filter.tags = req.query.tag;

    const [posts, total] = await Promise.all([
      BlogPost.find(filter)
        .sort({ publishedAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('author', 'fullName avatarUrl')
        .select('-body')
        .lean(),
      BlogPost.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: { posts },
      pagination: buildPaginationMeta(total, page, limit),
    });
  })
);

// GET /api/v1/blog/:slug — single post by slug
router.get(
  '/:slug',
  asyncHandler(async (req, res) => {
    const post = await BlogPost.findOne({ slug: req.params.slug, status: 'published' }).populate(
      'author',
      'fullName avatarUrl'
    );
    if (!post) throw new AppError('Blog post not found.', 404);
    res.json({ success: true, data: { post } });
  })
);

export default router;
