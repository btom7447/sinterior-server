import mongoose from 'mongoose';
import asyncHandler from '../utils/asyncHandler.js';
import Order from '../models/Order.js';
import Job from '../models/Job.js';
import Review from '../models/Review.js';
import Product from '../models/Product.js';
import Appointment from '../models/Appointment.js';
import Profile from '../models/Profile.js';

/**
 * GET /api/v1/dashboard/stats
 * Returns role-specific dashboard statistics for the authenticated user.
 */
export const getStats = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) {
    return res.status(200).json({ success: true, data: { stats: {} }, message: 'No profile found.' });
  }

  const profileId = profile._id;
  const role = req.user.role;
  const stats = {};

  if (role === 'client') {
    const [totalOrders, pendingOrders, completedOrders, totalSpent] = await Promise.all([
      Order.countDocuments({ buyerId: profileId }),
      Order.countDocuments({ buyerId: profileId, status: 'pending' }),
      Order.countDocuments({ buyerId: profileId, status: 'delivered' }),
      Order.aggregate([
        { $match: { buyerId: new mongoose.Types.ObjectId(profileId), status: { $in: ['confirmed', 'shipped', 'delivered'] } } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } },
      ]),
    ]);
    stats.totalOrders = totalOrders;
    stats.pendingOrders = pendingOrders;
    stats.completedOrders = completedOrders;
    stats.totalSpent = totalSpent[0]?.total || 0;
  }

  if (role === 'artisan') {
    const [totalJobs, activeJobs, completedJobs, totalReviews, avgRating, upcomingAppointments] =
      await Promise.all([
        Job.countDocuments({ artisanId: profileId }),
        Job.countDocuments({ artisanId: profileId, status: { $in: ['accepted', 'in_progress'] } }),
        Job.countDocuments({ artisanId: profileId, status: 'completed' }),
        Review.countDocuments({ artisanId: profileId }),
        Review.aggregate([
          { $match: { artisanId: new mongoose.Types.ObjectId(profileId) } },
          { $group: { _id: null, avg: { $avg: '$rating' } } },
        ]),
        Appointment.countDocuments({ artisanId: profileId, status: 'scheduled', date: { $gte: new Date() } }),
      ]);
    stats.totalJobs = totalJobs;
    stats.activeJobs = activeJobs;
    stats.completedJobs = completedJobs;
    stats.totalReviews = totalReviews;
    stats.avgRating = avgRating[0]?.avg ? Math.round(avgRating[0].avg * 10) / 10 : 0;
    stats.upcomingAppointments = upcomingAppointments;
  }

  if (role === 'supplier') {
    const oid = new mongoose.Types.ObjectId(profileId);
    const [totalProducts, outOfStockProducts, orderStats, pendingOrders] = await Promise.all([
      Product.countDocuments({ supplierId: profileId }),
      Product.countDocuments({ supplierId: profileId, isActive: true, inStock: false }),
      Order.aggregate([
        { $match: { 'items.supplierId': oid, status: { $in: ['confirmed', 'shipped', 'delivered'] } } },
        {
          $group: {
            _id: null,
            totalOrders: { $sum: 1 },
            totalRevenue: { $sum: '$totalAmount' },
          },
        },
      ]),
      Order.countDocuments({ 'items.supplierId': oid, status: 'pending' }),
    ]);
    stats.totalProducts = totalProducts;
    stats.outOfStockProducts = outOfStockProducts;
    stats.totalOrders = orderStats[0]?.totalOrders || 0;
    stats.totalRevenue = orderStats[0]?.totalRevenue || 0;
    stats.pendingOrders = pendingOrders;
  }

  res.status(200).json({
    success: true,
    data: { stats },
    message: 'Dashboard stats retrieved.',
  });
});

/**
 * GET /api/v1/dashboard/recent-orders
 * Returns the 5 most recent orders for the authenticated user (buyer or supplier).
 */
export const getRecentOrders = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) {
    return res.status(200).json({ success: true, data: { orders: [] }, message: 'No profile found.' });
  }

  const role = req.user.role;
  const filter =
    role === 'supplier'
      ? { 'items.supplierId': profile._id }
      : { buyerId: profile._id };

  const orders = await Order.find(filter)
    .sort({ createdAt: -1 })
    .limit(5)
    .populate('buyerId', 'fullName avatarUrl city');

  res.status(200).json({
    success: true,
    data: { orders },
    message: 'Recent orders retrieved.',
  });
});
