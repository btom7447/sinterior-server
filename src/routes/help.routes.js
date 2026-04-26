import { Router } from 'express';
import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/AppError.js';
import HelpArticle from '../models/HelpArticle.js';

const router = Router();

// GET /api/v1/help — public list of published articles, grouped by category client-side
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const filter = { status: 'published' };
    if (req.query.category) filter.category = req.query.category;

    const articles = await HelpArticle.find(filter)
      .sort({ category: 1, order: 1, createdAt: -1 })
      .select('-body') // omit body on the list endpoint to keep payload small
      .lean();

    res.json({ success: true, data: { articles } });
  })
);

// GET /api/v1/help/:slug — single article
router.get(
  '/:slug',
  asyncHandler(async (req, res) => {
    const article = await HelpArticle.findOne({
      slug: req.params.slug,
      status: 'published',
    }).lean();
    if (!article) throw new AppError('Article not found.', 404);
    res.json({ success: true, data: { article } });
  })
);

export default router;
