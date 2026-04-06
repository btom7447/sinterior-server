import Order from '../models/Order.js';
import Product from '../models/Product.js';
import Profile from '../models/Profile.js';
import Notification from '../models/Notification.js';
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess, sendPaginated } from '../utils/apiResponse.js';
import { getPagination, buildPaginationMeta } from '../utils/paginate.js';
import { emitNotification } from '../utils/emitNotification.js';

const VALID_STATUS_TRANSITIONS = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

// ── POST /api/v1/orders ───────────────────────────────────────────────────────
export const create = asyncHandler(async (req, res) => {
  const buyerProfile = await Profile.findOne({ userId: req.user.id });
  if (!buyerProfile) {
    throw new AppError('Buyer profile not found.', 404);
  }

  const { items, deliveryAddress, city, note, paymentMethod } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    throw new AppError('Order must contain at least one item.', 400);
  }

  // Fetch all products in one query and verify they exist & are active
  const productIds = items.map((i) => i.productId);
  const products = await Product.find({ _id: { $in: productIds }, isActive: true });

  if (products.length !== productIds.length) {
    throw new AppError('One or more products are unavailable or not found.', 400);
  }

  const productMap = new Map(products.map((p) => [p._id.toString(), p]));

  let totalAmount = 0;
  const enrichedItems = items.map((item) => {
    const product = productMap.get(item.productId.toString());
    const quantity = parseInt(item.quantity, 10);
    if (!quantity || quantity < 1) {
      throw new AppError(`Invalid quantity for product "${product.name}".`, 400);
    }
    const priceAtOrder = product.price;
    totalAmount += priceAtOrder * quantity;

    return {
      productId: product._id,
      supplierId: product.supplierId,
      name: product.name,
      quantity,
      priceAtOrder,
    };
  });

  const order = await Order.create({
    buyerId: buyerProfile._id,
    items: enrichedItems,
    totalAmount,
    deliveryAddress,
    city,
    note,
    paymentMethod,
    paymentStatus: 'paid', // dummy payment — always succeeds
  });

  // Notify each unique supplier about the new order
  const supplierIds = [...new Set(enrichedItems.map((i) => i.supplierId.toString()))];
  const supplierProfiles = await Profile.find({ _id: { $in: supplierIds } }).select('userId fullName');
  for (const supplier of supplierProfiles) {
    const notification = await Notification.create({
      userId: supplier.userId,
      title: 'New Order Received',
      body: `${buyerProfile.fullName} placed an order (₦${totalAmount.toLocaleString('en-NG')}). Check your orders to confirm.`,
      type: 'order',
      data: { orderId: order._id },
    });
    emitNotification(req, notification);
  }

  sendSuccess(res, { order }, 'Order placed successfully.', 201);
});

// ── GET /api/v1/orders ────────────────────────────────────────────────────────
export const list = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) {
    throw new AppError('Profile not found.', 404);
  }

  const { page, limit, skip } = getPagination(req.query);
  const role = req.user.role;

  // Clients see their own orders; suppliers see orders that contain their products
  let filter;
  if (role === 'supplier') {
    filter = { 'items.supplierId': profile._id };
  } else {
    filter = { buyerId: profile._id };
  }

  if (req.query.status) {
    filter.status = req.query.status;
  }

  const [total, orders] = await Promise.all([
    Order.countDocuments(filter),
    Order.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('buyerId', 'fullName avatarUrl city'),
  ]);

  const pagination = buildPaginationMeta(total, page, limit);
  sendPaginated(res, orders, pagination, 'Orders retrieved.');
});

// ── GET /api/v1/orders/:id ────────────────────────────────────────────────────
export const getById = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) {
    throw new AppError('Profile not found.', 404);
  }

  const order = await Order.findById(req.params.id).populate(
    'buyerId',
    'fullName avatarUrl phone city'
  );

  if (!order) {
    throw new AppError('Order not found.', 404);
  }

  // Buyer or supplier (whose product is in the order) may view
  const isBuyer = order.buyerId._id.toString() === profile._id.toString();
  const isSupplier = order.items.some((item) => item.supplierId.toString() === profile._id.toString());

  if (!isBuyer && !isSupplier) {
    throw new AppError('You are not authorised to view this order.', 403);
  }

  sendSuccess(res, { order }, 'Order retrieved.');
});

// ── PATCH /api/v1/orders/:id/status ──────────────────────────────────────────
export const updateStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;

  if (!status) {
    throw new AppError('status is required.', 400);
  }

  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) {
    throw new AppError('Profile not found.', 404);
  }

  const order = await Order.findById(req.params.id).populate('buyerId', 'userId fullName');
  if (!order) {
    throw new AppError('Order not found.', 404);
  }

  // Authorization: buyer can cancel; supplier can confirm/ship/deliver
  const isBuyer = order.buyerId._id.toString() === profile._id.toString();
  const isSupplier = order.items.some((item) => item.supplierId.toString() === profile._id.toString());

  if (!isBuyer && !isSupplier) {
    throw new AppError('You are not authorised to update this order.', 403);
  }

  // Buyers can only cancel
  if (isBuyer && !isSupplier && status !== 'cancelled') {
    throw new AppError('Buyers can only cancel orders.', 403);
  }

  const allowedNext = VALID_STATUS_TRANSITIONS[order.status];
  if (!allowedNext) {
    throw new AppError(`Order status "${order.status}" cannot be transitioned.`, 400);
  }

  if (!allowedNext.includes(status)) {
    throw new AppError(
      `Cannot move order from "${order.status}" to "${status}". ` +
        `Allowed next statuses: ${allowedNext.join(', ') || 'none'}.`,
      400
    );
  }

  order.status = status;
  await order.save();

  // Notify the other party about the status change
  const notifyUserId = isBuyer ? null : order.buyerId.userId;
  if (notifyUserId) {
    const notification = await Notification.create({
      userId: notifyUserId,
      title: 'Order Status Updated',
      body: `Your order has been updated to "${status}".`,
      type: 'order',
      data: { orderId: order._id, status },
    });
    emitNotification(req, notification);
  }

  sendSuccess(res, { order }, `Order status updated to "${status}".`);
});
