import asyncHandler from '../utils/asyncHandler.js';
import AppError from '../utils/AppError.js';
import User from '../models/User.js';
import Profile from '../models/Profile.js';
import Product from '../models/Product.js';
import Order from '../models/Order.js';
import Job from '../models/Job.js';
import BlogPost from '../models/BlogPost.js';
import CareerListing from '../models/CareerListing.js';
import HelpArticle from '../models/HelpArticle.js';
import FeedPost from '../models/FeedPost.js';
import Dispute from '../models/Dispute.js';
import VerificationRequest from '../models/VerificationRequest.js';
import PlatformSetting from '../models/PlatformSetting.js';
import ArtisanProfile from '../models/ArtisanProfile.js';
import SupplierProfile from '../models/SupplierProfile.js';
import Notification from '../models/Notification.js';
import { getPagination, buildPaginationMeta } from '../utils/paginate.js';
import { emitNotification } from '../utils/emitNotification.js';
import { sendEmailSafe } from '../utils/sendEmail.js';
import { verificationApproved, verificationRejected } from '../utils/emailTemplates.js';

// ═══════════════════════════════════════════════════════════════════════════════
// STATS / ANALYTICS
// ═══════════════════════════════════════════════════════════════════════════════

export const getStats = asyncHandler(async (_req, res) => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    activeUsers,
    activeArtisans,
    activeSellers,
    activeOrders,
    productsInStock,
    activeJobs,
    pendingVerifications,
    openDisputes,
    newUsersThisMonth,
    revenueAgg,
  ] = await Promise.all([
    // Active = not banned (the only soft-delete signal we have on User).
    User.countDocuments({ isBanned: { $ne: true } }),
    // Profile is the source of truth for role; ArtisanProfile / SupplierProfile may not exist yet for newly signed up users.
    Profile.countDocuments({ role: 'artisan' }),
    Profile.countDocuments({ role: 'supplier' }),
    // Active orders = anything still in motion (not delivered, not cancelled).
    Order.countDocuments({ status: { $nin: ['delivered', 'cancelled'] } }),
    // We treat any product with stock > 0 OR no `stock` field set (legacy rows that pre-date stock tracking) as in-stock.
    Product.countDocuments({
      $or: [{ stock: { $gt: 0 } }, { stock: { $exists: false } }],
      isActive: { $ne: false },
    }),
    // Active jobs = anything not yet completed or cancelled.
    Job.countDocuments({ status: { $in: ['pending', 'accepted', 'in_progress'] } }),
    VerificationRequest.countDocuments({ status: 'pending' }),
    Dispute.countDocuments({ status: { $in: ['open', 'under_review'] } }),
    User.countDocuments({ createdAt: { $gte: startOfMonth } }),
    // Total revenue from non-cancelled orders.
    Order.aggregate([
      { $match: { status: { $ne: 'cancelled' } } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } },
    ]),
  ]);

  const totalRevenue = revenueAgg[0]?.total || 0;

  res.json({
    success: true,
    data: {
      stats: {
        activeUsers,
        activeArtisans,
        activeSellers,
        activeOrders,
        productsInStock,
        activeJobs,
        totalRevenue,
        pendingVerifications,
        openDisputes,
        newUsersThisMonth,
      },
    },
  });
});

// GET /api/v1/admin/page-stats?page=users|orders|products|jobs|verification|disputes
// Returns the metric strip for a specific admin sub-page so each page only
// fetches the numbers it needs.
export const getPageStats = asyncHandler(async (req, res) => {
  const { page } = req.query;
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  let stats = {};

  switch (page) {
    case 'users': {
      const [total, banned, newThisMonth, byRole] = await Promise.all([
        User.countDocuments(),
        User.countDocuments({ isBanned: true }),
        User.countDocuments({ createdAt: { $gte: startOfMonth } }),
        Profile.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
      ]);
      const roleMap = byRole.reduce((acc, r) => ({ ...acc, [r._id]: r.count }), {});
      stats = {
        total,
        banned,
        newThisMonth,
        clients: roleMap.client || 0,
        artisans: roleMap.artisan || 0,
        suppliers: roleMap.supplier || 0,
      };
      break;
    }
    case 'orders': {
      const [total, pending, shipped, delivered, cancelled, revenueAgg] = await Promise.all([
        Order.countDocuments(),
        Order.countDocuments({ status: 'pending' }),
        Order.countDocuments({ status: 'shipped' }),
        Order.countDocuments({ status: 'delivered' }),
        Order.countDocuments({ status: 'cancelled' }),
        Order.aggregate([
          { $match: { status: { $ne: 'cancelled' }, createdAt: { $gte: startOfMonth } } },
          { $group: { _id: null, total: { $sum: '$totalAmount' } } },
        ]),
      ]);
      stats = {
        total,
        pending,
        shipped,
        delivered,
        cancelled,
        revenueThisMonth: revenueAgg[0]?.total || 0,
      };
      break;
    }
    case 'products': {
      const [total, inStock, outOfStock, hidden, lowStock] = await Promise.all([
        Product.countDocuments(),
        Product.countDocuments({
          $or: [{ stock: { $gt: 0 } }, { stock: { $exists: false } }],
          isActive: { $ne: false },
        }),
        Product.countDocuments({ stock: { $lte: 0 } }),
        Product.countDocuments({ isActive: false }),
        Product.countDocuments({ stock: { $gt: 0, $lte: 5 } }),
      ]);
      stats = { total, inStock, outOfStock, hidden, lowStock };
      break;
    }
    case 'jobs': {
      const [total, pending, accepted, inProgress, completed, cancelled] = await Promise.all([
        Job.countDocuments(),
        Job.countDocuments({ status: 'pending' }),
        Job.countDocuments({ status: 'accepted' }),
        Job.countDocuments({ status: 'in_progress' }),
        Job.countDocuments({ status: 'completed' }),
        Job.countDocuments({ status: 'cancelled' }),
      ]);
      stats = { total, pending, accepted, inProgress, completed, cancelled };
      break;
    }
    case 'verification': {
      const [pending, approved, rejected] = await Promise.all([
        VerificationRequest.countDocuments({ status: 'pending' }),
        VerificationRequest.countDocuments({ status: 'approved' }),
        VerificationRequest.countDocuments({ status: 'rejected' }),
      ]);
      stats = { pending, approved, rejected, total: pending + approved + rejected };
      break;
    }
    case 'disputes': {
      const [open, underReview, resolved, dismissed] = await Promise.all([
        Dispute.countDocuments({ status: 'open' }),
        Dispute.countDocuments({ status: 'under_review' }),
        Dispute.countDocuments({ status: 'resolved' }),
        Dispute.countDocuments({ status: 'dismissed' }),
      ]);
      stats = {
        open,
        underReview,
        resolved,
        dismissed,
        total: open + underReview + resolved + dismissed,
      };
      break;
    }
    default:
      throw new AppError('Invalid page parameter.', 400);
  }

  res.json({ success: true, data: { stats } });
});

export const getAnalytics = asyncHandler(async (_req, res) => {
  const now = new Date();
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const [usersOverTime, ordersOverTime, topCategories, topArtisans, usersByRole, revThisMonth, revPrevMonth, ordersThisMonth, ordersPrevMonth] =
    await Promise.all([
      User.aggregate([
        { $match: { createdAt: { $gte: sixMonthsAgo } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
        { $project: { month: '$_id', count: 1, _id: 0 } },
      ]),
      Order.aggregate([
        { $match: { createdAt: { $gte: sixMonthsAgo } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
            count: { $sum: 1 },
            revenue: { $sum: '$totalAmount' },
          },
        },
        { $sort: { _id: 1 } },
        { $project: { month: '$_id', count: 1, revenue: 1, _id: 0 } },
      ]),
      Product.aggregate([
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
        { $project: { name: '$_id', count: 1, _id: 0 } },
      ]),
      Job.aggregate([
        { $match: { status: 'accepted' } },
        { $group: { _id: '$artisanId', jobs: { $sum: 1 } } },
        { $sort: { jobs: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: 'profiles',
            localField: '_id',
            foreignField: '_id',
            as: 'profile',
          },
        },
        { $unwind: '$profile' },
        { $project: { name: '$profile.fullName', jobs: 1, _id: 0 } },
      ]),
      User.aggregate([
        { $group: { _id: '$role', count: { $sum: 1 } } },
        { $project: { role: '$_id', count: 1, _id: 0 } },
      ]),
      Order.aggregate([
        { $match: { createdAt: { $gte: startOfMonth }, status: { $ne: 'cancelled' } } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } },
      ]),
      Order.aggregate([
        { $match: { createdAt: { $gte: startOfPrevMonth, $lt: startOfMonth }, status: { $ne: 'cancelled' } } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } },
      ]),
      Order.countDocuments({ createdAt: { $gte: startOfMonth } }),
      Order.countDocuments({ createdAt: { $gte: startOfPrevMonth, $lt: startOfMonth } }),
    ]);

  res.json({
    success: true,
    data: {
      analytics: {
        usersOverTime,
        ordersOverTime,
        topCategories,
        topArtisans,
        usersByRole,
        revenueThisMonth: revThisMonth[0]?.total || 0,
        revenuePrevMonth: revPrevMonth[0]?.total || 0,
        ordersThisMonth,
        ordersPrevMonth,
      },
    },
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// USERS
// ═══════════════════════════════════════════════════════════════════════════════

export const getUsers = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = {};

  if (req.query.role) filter.role = req.query.role;
  if (req.query.search) {
    const regex = new RegExp(req.query.search, 'i');
    filter.$or = [{ email: regex }];
  }

  const [users, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ]);

  // Attach profile info
  const userIds = users.map((u) => u._id);
  const profiles = await Profile.find({ userId: { $in: userIds } }).lean();
  const profileMap = {};
  for (const p of profiles) profileMap[p.userId.toString()] = p;

  // Also search by name if search query provided
  let enrichedUsers = users.map((u) => ({
    ...u,
    profile: profileMap[u._id.toString()] || null,
  }));

  if (req.query.search) {
    const regex = new RegExp(req.query.search, 'i');
    // Also include users whose profile name matches (if not already included by email)
    const nameProfiles = await Profile.find({ fullName: regex }).lean();
    const extraUserIds = nameProfiles
      .map((p) => p.userId.toString())
      .filter((id) => !enrichedUsers.some((u) => u._id.toString() === id));

    if (extraUserIds.length > 0) {
      const extraUsers = await User.find({ _id: { $in: extraUserIds } }).lean();
      for (const eu of extraUsers) {
        enrichedUsers.push({ ...eu, profile: profileMap[eu._id.toString()] || nameProfiles.find((p) => p.userId.toString() === eu._id.toString()) || null });
      }
    }
  }

  res.json({
    success: true,
    data: { users: enrichedUsers },
    pagination: buildPaginationMeta(total, page, limit),
  });
});

export const getUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).lean();
  if (!user) throw new AppError('User not found.', 404);

  const profile = await Profile.findOne({ userId: user._id }).lean();

  let roleProfile = null;
  if (profile) {
    if (profile.role === 'artisan') {
      roleProfile = await ArtisanProfile.findOne({ profileId: profile._id }).lean();
    } else if (profile.role === 'supplier') {
      roleProfile = await SupplierProfile.findOne({ profileId: profile._id }).lean();
    }
  }

  const [orderCount, jobCount, disputeCount] = await Promise.all([
    profile ? Order.countDocuments({ buyerId: profile._id }) : 0,
    profile
      ? Job.countDocuments({ $or: [{ clientId: profile._id }, { artisanId: profile._id }] })
      : 0,
    profile
      ? Dispute.countDocuments({ $or: [{ raisedBy: profile._id }, { against: profile._id }] })
      : 0,
  ]);

  res.json({
    success: true,
    data: {
      user,
      profile,
      roleProfile,
      stats: { orders: orderCount, jobs: jobCount, disputes: disputeCount },
    },
  });
});

export const updateUser = asyncHandler(async (req, res) => {
  const { isBanned, role } = req.body;
  const user = await User.findById(req.params.id);
  if (!user) throw new AppError('User not found.', 404);

  if (isBanned !== undefined) user.isBanned = isBanned;
  if (role && ['client', 'artisan', 'supplier'].includes(role)) {
    user.role = role;
    await Profile.findOneAndUpdate({ userId: user._id }, { role });
  }

  await user.save({ validateBeforeSave: false });
  res.json({ success: true, data: { user }, message: 'User updated.' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ORDERS
// ═══════════════════════════════════════════════════════════════════════════════

export const getOrders = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = {};
  if (req.query.status) filter.status = req.query.status;

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('buyerId', 'fullName avatarUrl')
      .lean(),
    Order.countDocuments(filter),
  ]);

  // Map buyerId populated data into a cleaner shape
  const enriched = orders.map((o) => ({
    ...o,
    buyer: o.buyerId || {},
    seller: o.items?.[0]?.supplierId || {},
  }));

  res.json({
    success: true,
    data: { orders: enriched },
    pagination: buildPaginationMeta(total, page, limit),
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PRODUCTS
// ═══════════════════════════════════════════════════════════════════════════════

export const getProducts = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = {};
  if (req.query.search) {
    filter.name = new RegExp(req.query.search, 'i');
  }

  const [products, total] = await Promise.all([
    Product.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('supplierId', 'fullName avatarUrl')
      .lean(),
    Product.countDocuments(filter),
  ]);

  const enriched = products.map((p) => ({
    ...p,
    seller: p.supplierId || {},
  }));

  res.json({
    success: true,
    data: { products: enriched },
    pagination: buildPaginationMeta(total, page, limit),
  });
});

export const updateProduct = asyncHandler(async (req, res) => {
  const { isActive } = req.body;
  const product = await Product.findById(req.params.id);
  if (!product) throw new AppError('Product not found.', 404);

  if (isActive !== undefined) product.isActive = isActive;
  await product.save({ validateBeforeSave: false });

  res.json({ success: true, data: { product }, message: 'Product updated.' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BLOG
// ═══════════════════════════════════════════════════════════════════════════════

export const getBlogPosts = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);

  const [posts, total] = await Promise.all([
    BlogPost.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('author', 'fullName avatarUrl')
      .lean(),
    BlogPost.countDocuments(),
  ]);

  res.json({
    success: true,
    data: { posts },
    pagination: buildPaginationMeta(total, page, limit),
  });
});

export const getBlogPost = asyncHandler(async (req, res) => {
  const post = await BlogPost.findById(req.params.id).populate('author', 'fullName avatarUrl');
  if (!post) throw new AppError('Blog post not found.', 404);
  res.json({ success: true, data: { post } });
});

export const createBlogPost = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) throw new AppError('Profile not found.', 404);

  const { title, slug, excerpt, body, coverImage, tags, status } = req.body;
  const post = await BlogPost.create({
    title,
    slug: slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    excerpt,
    body,
    coverImage,
    tags: Array.isArray(tags) ? tags : [],
    author: profile._id,
    status: status || 'draft',
  });

  res.status(201).json({ success: true, data: { post }, message: 'Blog post created.' });
});

export const updateBlogPost = asyncHandler(async (req, res) => {
  const post = await BlogPost.findById(req.params.id);
  if (!post) throw new AppError('Blog post not found.', 404);

  const fields = ['title', 'slug', 'excerpt', 'body', 'coverImage', 'tags', 'status'];
  for (const field of fields) {
    if (req.body[field] !== undefined) post[field] = req.body[field];
  }

  await post.save();
  res.json({ success: true, data: { post }, message: 'Blog post updated.' });
});

export const deleteBlogPost = asyncHandler(async (req, res) => {
  const post = await BlogPost.findByIdAndDelete(req.params.id);
  if (!post) throw new AppError('Blog post not found.', 404);
  res.json({ success: true, message: 'Blog post deleted.' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CAREERS
// ═══════════════════════════════════════════════════════════════════════════════

export const getCareers = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);

  const [careers, total] = await Promise.all([
    CareerListing.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    CareerListing.countDocuments(),
  ]);

  res.json({
    success: true,
    data: { careers },
    pagination: buildPaginationMeta(total, page, limit),
  });
});

export const getCareer = asyncHandler(async (req, res) => {
  const career = await CareerListing.findById(req.params.id);
  if (!career) throw new AppError('Career listing not found.', 404);
  res.json({ success: true, data: { career } });
});

export const createCareer = asyncHandler(async (req, res) => {
  const { title, department, location, type, description, requirements, status } = req.body;
  const career = await CareerListing.create({
    title,
    department,
    location,
    type,
    description,
    requirements,
    status: status || 'open',
  });

  res.status(201).json({ success: true, data: { career }, message: 'Career listing created.' });
});

export const updateCareer = asyncHandler(async (req, res) => {
  const career = await CareerListing.findById(req.params.id);
  if (!career) throw new AppError('Career listing not found.', 404);

  const fields = ['title', 'department', 'location', 'type', 'description', 'requirements', 'status'];
  for (const field of fields) {
    if (req.body[field] !== undefined) career[field] = req.body[field];
  }

  await career.save();
  res.json({ success: true, data: { career }, message: 'Career listing updated.' });
});

export const deleteCareer = asyncHandler(async (req, res) => {
  const career = await CareerListing.findByIdAndDelete(req.params.id);
  if (!career) throw new AppError('Career listing not found.', 404);
  res.json({ success: true, message: 'Career listing deleted.' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// HELP ARTICLES
// ═══════════════════════════════════════════════════════════════════════════════

const slugify = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const getHelpArticles = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const [articles, total] = await Promise.all([
    HelpArticle.find().sort({ category: 1, order: 1, createdAt: -1 }).skip(skip).limit(limit).lean(),
    HelpArticle.countDocuments(),
  ]);
  res.json({
    success: true,
    data: { articles },
    pagination: buildPaginationMeta(total, page, limit),
  });
});

export const getHelpArticle = asyncHandler(async (req, res) => {
  const article = await HelpArticle.findById(req.params.id);
  if (!article) throw new AppError('Help article not found.', 404);
  res.json({ success: true, data: { article } });
});

export const createHelpArticle = asyncHandler(async (req, res) => {
  const { title, slug, category, emoji, excerpt, body, order, status } = req.body;
  if (!title || !body) throw new AppError('title and body are required.', 400);

  const article = await HelpArticle.create({
    title,
    slug: slug || slugify(title),
    category,
    emoji,
    excerpt,
    body,
    order: order ?? 0,
    status: status || 'draft',
  });

  res.status(201).json({ success: true, data: { article }, message: 'Help article created.' });
});

export const updateHelpArticle = asyncHandler(async (req, res) => {
  const article = await HelpArticle.findById(req.params.id);
  if (!article) throw new AppError('Help article not found.', 404);

  const fields = ['title', 'slug', 'category', 'emoji', 'excerpt', 'body', 'order', 'status'];
  for (const f of fields) if (req.body[f] !== undefined) article[f] = req.body[f];

  await article.save();
  res.json({ success: true, data: { article }, message: 'Help article updated.' });
});

export const deleteHelpArticle = asyncHandler(async (req, res) => {
  const article = await HelpArticle.findByIdAndDelete(req.params.id);
  if (!article) throw new AppError('Help article not found.', 404);
  res.json({ success: true, message: 'Help article deleted.' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FEED POSTS
// ═══════════════════════════════════════════════════════════════════════════════

export const getFeedPosts = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const [posts, total] = await Promise.all([
    FeedPost.find()
      .sort({ isFeatured: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    FeedPost.countDocuments(),
  ]);
  res.json({
    success: true,
    data: { posts },
    pagination: buildPaginationMeta(total, page, limit),
  });
});

export const getFeedPost = asyncHandler(async (req, res) => {
  const post = await FeedPost.findById(req.params.id);
  if (!post) throw new AppError('Feed post not found.', 404);
  res.json({ success: true, data: { post } });
});

export const createFeedPost = asyncHandler(async (req, res) => {
  // Accept either modern (mediaUrl/mediaType) or legacy (imageUrl) payloads.
  const {
    title,
    caption,
    mediaType,
    mediaUrl,
    imageUrl, // legacy alias
    posterUrl,
    linkUrl,
    tags,
    isFeatured,
    status,
  } = req.body;

  const finalMediaUrl = mediaUrl || imageUrl;
  if (!title || !finalMediaUrl) {
    throw new AppError('title and mediaUrl are required.', 400);
  }
  const finalMediaType = mediaType || 'image';
  if (!['image', 'video'].includes(finalMediaType)) {
    throw new AppError('mediaType must be "image" or "video".', 400);
  }

  const post = await FeedPost.create({
    title,
    caption,
    mediaType: finalMediaType,
    mediaUrl: finalMediaUrl,
    posterUrl,
    linkUrl,
    tags: Array.isArray(tags) ? tags : [],
    isFeatured: !!isFeatured,
    status: status || 'draft',
  });

  res.status(201).json({ success: true, data: { post }, message: 'Feed post created.' });
});

export const updateFeedPost = asyncHandler(async (req, res) => {
  const post = await FeedPost.findById(req.params.id);
  if (!post) throw new AppError('Feed post not found.', 404);

  // Accept legacy `imageUrl` as `mediaUrl`.
  if (req.body.imageUrl !== undefined && req.body.mediaUrl === undefined) {
    req.body.mediaUrl = req.body.imageUrl;
  }

  const fields = [
    'title',
    'caption',
    'mediaType',
    'mediaUrl',
    'posterUrl',
    'linkUrl',
    'tags',
    'isFeatured',
    'status',
  ];
  for (const f of fields) if (req.body[f] !== undefined) post[f] = req.body[f];

  await post.save();
  res.json({ success: true, data: { post }, message: 'Feed post updated.' });
});

export const deleteFeedPost = asyncHandler(async (req, res) => {
  const post = await FeedPost.findByIdAndDelete(req.params.id);
  if (!post) throw new AppError('Feed post not found.', 404);
  res.json({ success: true, message: 'Feed post deleted.' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DISPUTES
// ═══════════════════════════════════════════════════════════════════════════════

export const getDisputes = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = {};
  if (req.query.status) filter.status = req.query.status;

  const [disputes, total] = await Promise.all([
    Dispute.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('raisedBy', 'fullName avatarUrl')
      .populate('against', 'fullName avatarUrl')
      .lean(),
    Dispute.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: { disputes },
    pagination: buildPaginationMeta(total, page, limit),
  });
});

export const updateDispute = asyncHandler(async (req, res) => {
  const dispute = await Dispute.findById(req.params.id);
  if (!dispute) throw new AppError('Dispute not found.', 404);

  const { status, adminNote, resolution } = req.body;
  if (status) dispute.status = status;
  if (adminNote !== undefined) dispute.adminNote = adminNote;
  if (resolution !== undefined) dispute.resolution = resolution;

  if (status === 'resolved' || status === 'dismissed') {
    dispute.resolvedBy = req.user.id;
    dispute.resolvedAt = new Date();
  }

  await dispute.save();
  res.json({ success: true, data: { dispute }, message: `Dispute ${status || 'updated'}.` });
});

// ═══════════════════════════════════════════════════════════════════════════════
// VERIFICATION REQUESTS
// ═══════════════════════════════════════════════════════════════════════════════

export const getVerifications = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = {};
  if (req.query.status) filter.status = req.query.status;

  const [verifications, total] = await Promise.all([
    VerificationRequest.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('sellerId', 'fullName avatarUrl')
      .lean(),
    VerificationRequest.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: { verifications },
    pagination: buildPaginationMeta(total, page, limit),
  });
});

export const updateVerification = asyncHandler(async (req, res) => {
  const verification = await VerificationRequest.findById(req.params.id);
  if (!verification) throw new AppError('Verification request not found.', 404);

  const { status, reviewNote } = req.body;
  const validStatuses = ['pending', 'approved', 'rejected', 'revoked'];
  if (status && !validStatuses.includes(status)) {
    throw new AppError(`Status must be one of ${validStatuses.join(', ')}.`, 400);
  }
  // Revocation requires a reason — it explains the change to the requestor.
  if ((status === 'rejected' || status === 'revoked') && !reviewNote?.trim()) {
    throw new AppError('A reason is required when rejecting or revoking verification.', 400);
  }

  if (status) verification.status = status;
  if (reviewNote !== undefined) verification.reviewNote = reviewNote;
  verification.reviewedBy = req.user.id;
  verification.reviewedAt = new Date();

  await verification.save();

  // Sync isVerified on the artisan/supplier profile.
  // - approved → true
  // - revoked  → false
  const profile = await Profile.findById(verification.sellerId);
  if (profile && (status === 'approved' || status === 'revoked')) {
    const isVerified = status === 'approved';
    if (profile.role === 'artisan') {
      await ArtisanProfile.findOneAndUpdate({ profileId: profile._id }, { isVerified });
    } else if (profile.role === 'supplier') {
      await SupplierProfile.findOneAndUpdate({ profileId: profile._id }, { isVerified });
    }
  }

  // Notify the seller for any status change that affects them.
  if (profile && ['approved', 'rejected', 'revoked'].includes(status)) {
    const sellerUserId = profile.userId;
    const TITLES = {
      approved: "You're verified ✓",
      rejected: 'Verification could not be approved',
      revoked: 'Verification revoked',
    };
    const BODIES = {
      approved: `${verification.businessName} has been verified.`,
      rejected: `Verification for ${verification.businessName} could not be approved.${
        reviewNote ? ` Reason: ${reviewNote}` : ''
      }`,
      revoked: `Verified status for ${verification.businessName} has been revoked.${
        reviewNote ? ` Reason: ${reviewNote}` : ''
      }`,
    };

    try {
      const notif = await Notification.create({
        userId: sellerUserId,
        title: TITLES[status],
        body: BODIES[status],
        type: `verification_${status}`,
        data: { verificationId: verification._id, reviewNote: verification.reviewNote },
      });
      emitNotification(req, notif);
    } catch (err) {
      console.warn('[verification] notification failed:', err.message);
    }

    const sellerUser = await User.findById(sellerUserId).select('email');
    if (sellerUser?.email) {
      let tpl;
      if (status === 'approved') {
        tpl = verificationApproved({ businessName: verification.businessName });
      } else {
        // Reuse the rejected template for revoked too — both communicate
        // "your verification isn't active" with a reason.
        tpl = verificationRejected({
          businessName: verification.businessName,
          reviewNote: verification.reviewNote,
        });
        if (status === 'revoked') {
          tpl.subject = 'Your verified status has been revoked';
        }
      }
      sendEmailSafe({ to: sellerUser.email, ...tpl });
    }
  }

  res.json({ success: true, data: { verification }, message: `Verification ${status}.` });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PLATFORM SETTINGS
// ═══════════════════════════════════════════════════════════════════════════════

export const getSettings = asyncHandler(async (_req, res) => {
  const settings = await PlatformSetting.getAll();
  res.json({ success: true, data: { settings } });
});

export const updateSettings = asyncHandler(async (req, res) => {
  const entries = Object.entries(req.body);
  await Promise.all(entries.map(([key, value]) => PlatformSetting.set(key, value)));
  res.json({ success: true, message: 'Settings saved.' });
});
