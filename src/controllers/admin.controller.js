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
import EscrowEntry from '../models/EscrowEntry.js';
import PayoutRequest from '../models/PayoutRequest.js';
import Wallet from '../models/Wallet.js';
import WalletTransaction from '../models/WalletTransaction.js';
import { getPagination, buildPaginationMeta } from '../utils/paginate.js';
import { emitNotification } from '../utils/emitNotification.js';
import { sendEmailSafe } from '../utils/sendEmail.js';
import { verificationApproved, verificationRejected } from '../utils/emailTemplates.js';
import { adjust, reversePayout } from '../services/wallet.service.js';
import { issueRefund } from '../services/refund.service.js';

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

  // ruleFor: 'buyer' | 'seller' — when set on resolution, drives the refund decision.
  // refundAmount: optional partial (kobo). Omit for full refund (only relevant when ruleFor='buyer').
  const { status, adminNote, resolution, ruleFor, refundAmount } = req.body;
  if (status) dispute.status = status;
  if (adminNote !== undefined) dispute.adminNote = adminNote;
  if (resolution !== undefined) dispute.resolution = resolution;

  if (status === 'resolved' || status === 'dismissed') {
    dispute.resolvedBy = req.user.id;
    dispute.resolvedAt = new Date();
  }

  await dispute.save();

  // If admin resolved in favour of the buyer, fire the refund flow against
  // the linked entity's escrow entry. The dispute can be on an order or job.
  let refunded = null;
  if (status === 'resolved' && ruleFor === 'buyer') {
    const entityType = dispute.type; // 'order' | 'job'
    const entityId = dispute.orderId || dispute.jobId;
    if (entityId) {
      const entry = await EscrowEntry.findOne({
        entityType,
        entityId,
        status: { $in: ['held', 'released', 'partially_refunded'] },
      });
      if (entry) {
        try {
          const result = await issueRefund({
            escrowEntryId: entry._id,
            amount: refundAmount ? Number(refundAmount) : null,
            reason: `Dispute ruled for buyer: ${resolution || dispute.reason}`,
            adminUserId: req.user.id,
          });
          refunded = { amount: result.refundAmount, entryId: entry._id };
        } catch (err) {
          // Surface but don't block the dispute update — admin can retry refund manually.
          console.warn(`[updateDispute] refund failed: ${err.message}`);
        }
      }
    }
  }

  res.json({
    success: true,
    data: { dispute, refunded },
    message: refunded
      ? `Dispute ${status} — refunded ₦${(refunded.amount / 100).toLocaleString('en-NG')}.`
      : `Dispute ${status || 'updated'}.`,
  });
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

// ═══════════════════════════════════════════════════════════════════════════════
// PAYMENTS — escrow, payouts, wallets
// ═══════════════════════════════════════════════════════════════════════════════

// GET /admin/escrow — list with optional status filter
export const getEscrow = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.entityType) filter.entityType = req.query.entityType;

  const [entries, total] = await Promise.all([
    EscrowEntry.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('buyerProfileId', 'fullName')
      .populate('sellerProfileId', 'fullName')
      .lean(),
    EscrowEntry.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: { entries },
    pagination: buildPaginationMeta(total, page, limit),
  });
});

// GET /admin/payouts — payout queue
export const getPayouts = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const filter = {};
  if (req.query.status) filter.status = req.query.status;

  const [payouts, total] = await Promise.all([
    PayoutRequest.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('profileId', 'fullName')
      .populate('bankAccountId', 'accountNumber bankName accountName')
      .lean(),
    PayoutRequest.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: { payouts },
    pagination: buildPaginationMeta(total, page, limit),
  });
});

// POST /admin/payouts/:id/release-now — skip cooldown for a pending payout.
// The cron will pick it up on the next tick (we just move scheduledFor to now).
export const releasePayoutNow = asyncHandler(async (req, res) => {
  const payout = await PayoutRequest.findById(req.params.id);
  if (!payout) throw new AppError('Payout not found.', 404);
  if (payout.status !== 'pending') {
    throw new AppError(`Payout is already ${payout.status}.`, 400);
  }
  payout.scheduledFor = new Date();
  await payout.save();
  res.json({ success: true, data: { payout }, message: 'Cooldown released — cron will fire on next tick.' });
});

// POST /admin/payouts/:id/cancel — cancel a pending payout, refund the wallet.
export const cancelPayout = asyncHandler(async (req, res) => {
  const payout = await PayoutRequest.findById(req.params.id);
  if (!payout) throw new AppError('Payout not found.', 404);
  if (payout.status !== 'pending') {
    throw new AppError('Only pending payouts can be cancelled.', 400);
  }
  payout.status = 'cancelled';
  payout.failureReason = req.body?.reason || 'Cancelled by admin';
  payout.processedAt = new Date();
  await payout.save();
  await reversePayout({
    profileId: payout.profileId,
    amount: payout.amount,
    referenceId: payout._id,
  });
  res.json({ success: true, data: { payout }, message: 'Payout cancelled and wallet refunded.' });
});

// GET /admin/wallets/platform — platform fee account
export const getPlatformWallet = asyncHandler(async (_req, res) => {
  const wallet = await Wallet.getPlatform();
  const recent = await WalletTransaction.find({ walletId: wallet._id })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  res.json({ success: true, data: { wallet, recent } });
});

// GET /admin/wallets/:profileId — inspect any seller wallet
export const getSellerWallet = asyncHandler(async (req, res) => {
  const wallet = await Wallet.findOne({ profileId: req.params.profileId })
    .populate('profileId', 'fullName role')
    .lean();
  if (!wallet) throw new AppError('Wallet not found.', 404);
  const recent = await WalletTransaction.find({ walletId: wallet._id })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  res.json({ success: true, data: { wallet, recent } });
});

// PATCH /admin/wallets/:profileId — toggle pause, set feeMode, custom hold/cooldown
export const updateSellerWallet = asyncHandler(async (req, res) => {
  const wallet = await Wallet.findOne({ profileId: req.params.profileId });
  if (!wallet) throw new AppError('Wallet not found.', 404);

  // Hard caps so admin can't accidentally lock a seller out (e.g. holdHours
  // = 99999 ≈ never). Pick conservative ceilings; admin can still pause via
  // the dedicated flag if they need a longer hold.
  const MAX_HOLD_HOURS = 30 * 24;        // 30 days
  const MAX_REVIEW_HOURS = 14 * 24;      // 14 days
  const MAX_MIN_PAYOUT_KOBO = 10_000_000; // ₦100k

  const allowed = [
    'withdrawalsPaused',
    'pauseReason',
    'feeMode',
    'customHoldHours',
    'customPayoutReviewHours',
    'customMinPayoutKobo',
  ];
  if (req.body.feeMode && !['per_transaction', 'weekly', 'monthly'].includes(req.body.feeMode)) {
    throw new AppError('Invalid feeMode.', 400);
  }
  if (req.body.customHoldHours !== undefined) {
    const h = Number(req.body.customHoldHours);
    if (!Number.isFinite(h) || h < 0 || h > MAX_HOLD_HOURS) {
      throw new AppError(`customHoldHours must be 0–${MAX_HOLD_HOURS}.`, 400);
    }
  }
  if (req.body.customPayoutReviewHours !== undefined) {
    const h = Number(req.body.customPayoutReviewHours);
    if (!Number.isFinite(h) || h < 0 || h > MAX_REVIEW_HOURS) {
      throw new AppError(`customPayoutReviewHours must be 0–${MAX_REVIEW_HOURS}.`, 400);
    }
  }
  if (req.body.customMinPayoutKobo !== undefined) {
    const v = Number(req.body.customMinPayoutKobo);
    if (!Number.isFinite(v) || v < 0 || v > MAX_MIN_PAYOUT_KOBO) {
      throw new AppError(`customMinPayoutKobo must be 0–${MAX_MIN_PAYOUT_KOBO}.`, 400);
    }
  }

  for (const key of allowed) {
    if (req.body[key] !== undefined) wallet[key] = req.body[key];
  }
  await wallet.save();
  res.json({ success: true, data: { wallet }, message: 'Wallet updated.' });
});

// POST /admin/wallets/:profileId/adjust — manual ledger entry (any bucket)
export const adjustSellerWallet = asyncHandler(async (req, res) => {
  const { amount, bucket = 'available', reason } = req.body;
  if (!amount || !reason?.trim()) {
    throw new AppError('amount and reason are required.', 400);
  }
  // Whitelist the bucket so a typo can't silently mutate the wrong field.
  if (!['pending', 'holding', 'available', 'feesOwed'].includes(bucket)) {
    throw new AppError('Invalid bucket. Use pending, holding, available, or feesOwed.', 400);
  }
  const numAmount = Number(amount);
  if (!Number.isFinite(numAmount) || numAmount === 0) {
    throw new AppError('amount must be a non-zero number.', 400);
  }
  const wallet = await adjust({
    profileId: req.params.profileId,
    amount: numAmount,
    bucket,
    reason: reason.trim(),
  });
  res.json({ success: true, data: { wallet }, message: 'Adjustment applied.' });
});

// POST /admin/settings/global-pause — emergency kill-switch
export const setGlobalPause = asyncHandler(async (req, res) => {
  const { paused } = req.body;
  await PlatformSetting.set('globalPayoutsPaused', !!paused);
  res.json({
    success: true,
    message: paused
      ? 'Global payouts paused.'
      : 'Global payouts resumed.',
  });
});

// POST /admin/escrow/:id/refund — issue full or partial refund
export const refundEscrow = asyncHandler(async (req, res) => {
  const { amount, reason } = req.body;
  if (!reason?.trim()) throw new AppError('Reason is required for refunds.', 400);
  const { refundAmount, entry } = await issueRefund({
    escrowEntryId: req.params.id,
    amount: amount ? Number(amount) : null,
    reason: reason.trim(),
    adminUserId: req.user.id,
  });
  res.json({
    success: true,
    data: { entry, refundAmount },
    message: `Refunded ₦${(refundAmount / 100).toLocaleString('en-NG')}.`,
  });
});

// POST /admin/escrow/:id/release — force-release an escrow entry (override delivery flow)
export const forceReleaseEscrow = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  if (!reason?.trim()) throw new AppError('Reason is required for force-release.', 400);
  // Atomic claim — admin double-click can't double-release.
  const entry = await EscrowEntry.findOneAndUpdate(
    { _id: req.params.id, status: 'held' },
    {
      status: 'released',
      releasedAt: new Date(),
      adminOverrideReason: reason.trim(),
      adminOverrideBy: req.user.id,
    },
    { new: true }
  );
  if (!entry) {
    // Either not found or already non-held.
    const existing = await EscrowEntry.findById(req.params.id).select('status');
    if (!existing) throw new AppError('Escrow entry not found.', 404);
    throw new AppError(`Cannot force-release — entry is ${existing.status}.`, 400);
  }
  const { releaseEscrow } = await import('../services/wallet.service.js');
  const { feeAmount, netAmount } = await releaseEscrow({
    sellerProfileId: entry.sellerProfileId,
    amount: entry.amount,
    source: entry.entityType,
    referenceId: entry.entityId,
  });
  entry.feeAmount = feeAmount;
  entry.netAmount = netAmount;
  await entry.save();
  res.json({ success: true, data: { entry }, message: `Force-released. Reason: ${reason}` });
});

// POST /admin/wallets/:profileId/suspend
export const suspendSeller = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  if (!reason?.trim()) throw new AppError('Reason is required.', 400);
  const profile = await Profile.findById(req.params.profileId);
  if (!profile) throw new AppError('Profile not found.', 404);
  profile.isSuspended = true;
  profile.suspensionReason = reason.trim();
  profile.suspendedAt = new Date();
  profile.suspendedBy = req.user.id;
  await profile.save();
  // Also pause payouts if not already.
  await Wallet.findOneAndUpdate(
    { profileId: profile._id },
    { withdrawalsPaused: true, pauseReason: `Suspended: ${reason.trim()}` }
  );
  // Notify the seller.
  await Notification.create({
    userId: profile.userId,
    title: 'Account suspended',
    body: `Your account has been suspended. Reason: ${reason.trim()}. Contact admin to resolve.`,
    type: 'admin',
    data: { reason: reason.trim() },
  });
  res.json({ success: true, data: { profile }, message: 'Seller suspended.' });
});

// POST /admin/wallets/:profileId/unsuspend
export const unsuspendSeller = asyncHandler(async (req, res) => {
  const profile = await Profile.findById(req.params.profileId);
  if (!profile) throw new AppError('Profile not found.', 404);
  profile.isSuspended = false;
  profile.suspensionReason = undefined;
  profile.suspendedAt = undefined;
  profile.suspendedBy = undefined;
  await profile.save();

  // Auto-unpause payouts ONLY if the wallet isn't separately in the red.
  // A negative balance keeps payouts paused on its own — clearing the
  // suspension shouldn't bypass that gate.
  const wallet = await Wallet.findOne({ profileId: profile._id });
  if (wallet && wallet.availableBalance >= 0) {
    wallet.withdrawalsPaused = false;
    wallet.pauseReason = undefined;
    await wallet.save();
  } else if (wallet) {
    wallet.pauseReason = 'Wallet negative — settle balance to resume payouts.';
    await wallet.save();
  }

  await Notification.create({
    userId: profile.userId,
    title: 'Account reinstated',
    body:
      wallet && wallet.availableBalance < 0
        ? 'Your account has been reinstated. Payouts remain paused until your wallet balance clears the negative.'
        : 'Your account has been reinstated. You can resume normal activity.',
    type: 'admin',
  });
  res.json({ success: true, data: { profile }, message: 'Seller unsuspended.' });
});

// POST /admin/wallets/:profileId/send-fee-reminder
export const sendFeeReminder = asyncHandler(async (req, res) => {
  const profile = await Profile.findById(req.params.profileId);
  if (!profile) throw new AppError('Profile not found.', 404);
  const wallet = await Wallet.findOrCreate(profile._id);
  if ((wallet.feesOwed || 0) <= 0) {
    throw new AppError('No fees owed.', 400);
  }
  await Notification.create({
    userId: profile.userId,
    title: 'Outstanding platform fees',
    body: `You owe ₦${(wallet.feesOwed / 100).toLocaleString('en-NG')} in platform fees. Settle from your wallet to avoid suspension.`,
    type: 'admin',
    data: { feesOwed: wallet.feesOwed },
  });
  // Email reminder
  const user = await User.findById(profile.userId).select('email');
  if (user?.email) {
    sendEmailSafe({
      to: user.email,
      subject: 'Outstanding platform fees on Sintherior',
      html: `
        <p>Hi ${profile.fullName || ''},</p>
        <p>Your wallet currently shows outstanding platform fees of <strong>₦${(wallet.feesOwed / 100).toLocaleString('en-NG')}</strong>.</p>
        <p>Please settle from your earnings or contact admin to resolve.</p>
      `,
    });
  }
  res.json({ success: true, message: 'Reminder sent.' });
});
