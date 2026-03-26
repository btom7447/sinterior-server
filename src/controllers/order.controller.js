import Order from '../models/Order.js';
import Product from '../models/Product.js';
import Profile from '../models/Profile.js';
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess, sendPaginated } from '../utils/apiResponse.js';
import { getPagination, buildPaginationMeta } from '../utils/paginate.js';

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
  });

  sendSuccess(res, { order }, 'Order placed successfully.', 201);
});

// ── GET /api/v1/orders ────────────────────────────────────────────────────────
export const list = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) {
    throw new AppError('Profile not found.', 404);
  }

  const { page, limit, skip } = getPagination(req.query);

  // Clients see their own orders; suppliers see orders that contain their products
  // For simplicity, all non-admin users see orders where they are the buyer
  const filter = { buyerId: profile._id };

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

  // Only the buyer may view this order (admins can extend this later)
  if (order.buyerId._id.toString() !== profile._id.toString()) {
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

  const order = await Order.findById(req.params.id);
  if (!order) {
    throw new AppError('Order not found.', 404);
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

  sendSuccess(res, { order }, `Order status updated to "${status}".`);
});
