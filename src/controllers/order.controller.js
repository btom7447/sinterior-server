import Order from '../models/Order.js';
import Product from '../models/Product.js';
import Profile from '../models/Profile.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import EscrowEntry from '../models/EscrowEntry.js';
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess, sendPaginated } from '../utils/apiResponse.js';
import { getPagination, buildPaginationMeta } from '../utils/paginate.js';
import { emitNotification } from '../utils/emitNotification.js';
import { sendEmailSafe } from '../utils/sendEmail.js';
import { releaseEscrow, accrueCodFee } from '../services/wallet.service.js';
import PlatformSetting from '../models/PlatformSetting.js';
import Wallet from '../models/Wallet.js';
import {
  orderPlacedClient,
  orderPlacedSupplier,
  orderStatusChanged,
} from '../utils/emailTemplates.js';

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
  if (buyerProfile.isSuspended) {
    throw new AppError('Your account is suspended. Contact admin to reinstate.', 403);
  }

  const { items, deliveryAddress, deliveryState, city, contactName, contactPhone, note, paymentMethod, shippingCost: clientShippingCost } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    throw new AppError('Order must contain at least one item.', 400);
  }

  // Fetch all products in one query and verify they exist & are active
  const productIds = items.map((i) => i.productId);
  const products = await Product.find({ _id: { $in: productIds }, isActive: true });

  if (products.length !== productIds.length) {
    throw new AppError('One or more products are unavailable or not found.', 400);
  }

  // Block orders containing items from suspended suppliers.
  const supplierIds = [...new Set(products.map((p) => p.supplierId.toString()))];
  const suspendedSuppliers = await Profile.find({
    _id: { $in: supplierIds },
    isSuspended: true,
  }).select('_id');
  if (suspendedSuppliers.length > 0) {
    throw new AppError('One or more suppliers in this order are currently unavailable.', 400);
  }

  const productMap = new Map(products.map((p) => [p._id.toString(), p]));

  let totalAmount = 0;
  const enrichedItems = items.map((item) => {
    const product = productMap.get(item.productId.toString());
    const quantity = parseInt(item.quantity, 10);
    if (!quantity || quantity < 1) {
      throw new AppError(`Invalid quantity for product "${product.name}".`, 400);
    }
    // Check stock
    if (product.quantity !== undefined && product.quantity < quantity) {
      throw new AppError(`Insufficient stock for "${product.name}". Available: ${product.quantity}.`, 400);
    }
    const priceAtOrder = product.price;
    totalAmount += priceAtOrder * quantity;

    // Carry buyer's spec selections (e.g. { Color: "Red", Size: "Large" })
    const selectedSpecs =
      item.selectedSpecs && typeof item.selectedSpecs === 'object' && Object.keys(item.selectedSpecs).length > 0
        ? item.selectedSpecs
        : undefined;

    return {
      productId: product._id,
      supplierId: product.supplierId,
      name: product.name,
      quantity,
      priceAtOrder,
      ...(selectedSpecs ? { selectedSpecs } : {}),
    };
  });

  // Atomically decrement stock for each product
  for (const item of enrichedItems) {
    const result = await Product.findOneAndUpdate(
      { _id: item.productId, quantity: { $gte: item.quantity } },
      { $inc: { quantity: -item.quantity } },
      { new: true }
    );
    if (!result) {
      throw new AppError(`Product "${item.name}" is no longer available in the requested quantity.`, 400);
    }
    // Update inStock flag
    if (result.quantity === 0) {
      result.inStock = false;
      await result.save();
    }

    // Low stock notification (sent once per threshold crossing)
    const threshold = result.lowStockThreshold ?? 20;
    if (result.quantity > 0 && result.quantity <= threshold && !result.lowStockNotified) {
      result.lowStockNotified = true;
      await result.save();

      // Notify the supplier
      const supplierProfile = await Profile.findById(result.supplierId).select('userId fullName');
      if (supplierProfile) {
        const notification = await Notification.create({
          userId: supplierProfile.userId,
          title: 'Low Stock Alert',
          body: `"${result.name}" is running low — only ${result.quantity} left in stock.`,
          type: 'inventory',
          data: { productId: result._id },
        });
        emitNotification(req, notification);
      }
    }
  }

  const shipping = Math.max(0, parseFloat(clientShippingCost) || 0);
  const grandTotal = totalAmount + shipping;

  const order = await Order.create({
    buyerId: buyerProfile._id,
    items: enrichedItems,
    totalAmount: grandTotal,
    shippingCost: shipping,
    deliveryAddress,
    deliveryState,
    city,
    note,
    paymentMethod,
    paymentStatus: paymentMethod === 'Pay on Delivery' ? 'pending' : 'pending',
  });

  // Notify each unique supplier about the new order
  const notifySupplierIds = [...new Set(enrichedItems.map((i) => i.supplierId.toString()))];
  const supplierProfiles = await Profile.find({ _id: { $in: notifySupplierIds } }).select('userId fullName');
  for (const supplier of supplierProfiles) {
    const notification = await Notification.create({
      userId: supplier.userId,
      title: 'New Order Received',
      body: `${buyerProfile.fullName} placed an order (₦${grandTotal.toLocaleString('en-NG')}). Check your orders to confirm.`,
      type: 'order',
      data: { orderId: order._id },
    });
    emitNotification(req, notification);
  }

  // ── Email notifications ────────────────────────────────────────────────
  // Buyer receipt
  const buyerUser = await User.findById(req.user.id).select('email');
  if (buyerUser?.email) {
    const { subject, html } = orderPlacedClient({
      order,
      buyerName: buyerProfile.fullName,
    });
    sendEmailSafe({ to: buyerUser.email, subject, html });
  }

  // Supplier alerts — one per unique supplier, each scoped to their items
  for (const supplier of supplierProfiles) {
    const supplierUser = await User.findById(supplier.userId).select('email');
    if (!supplierUser?.email) continue;
    const supplierItems = enrichedItems.filter(
      (i) => i.supplierId.toString() === supplier._id.toString()
    );
    const { subject, html } = orderPlacedSupplier({
      order,
      supplierItems,
      buyerName: buyerProfile.fullName,
    });
    sendEmailSafe({ to: supplierUser.email, subject, html });
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

  // ?as=buyer|seller — explicitly choose the view. If omitted, default by role
  // (supplier → seller view, anyone else → buyer view).
  const explicitAs = req.query.as;
  const view =
    explicitAs === 'buyer' || explicitAs === 'seller'
      ? explicitAs
      : role === 'supplier'
      ? 'seller'
      : 'buyer';

  let filter;
  if (view === 'seller') {
    filter = { 'items.supplierId': profile._id };
  } else {
    filter = { buyerId: profile._id };
  }

  const validStatuses = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];
  if (req.query.status && validStatuses.includes(req.query.status)) {
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

  // Delivery is now a dual-approval flow on its own endpoint — direct status
  // updates to 'delivered' aren't allowed any more.
  if (status === 'delivered') {
    throw new AppError(
      'Use POST /orders/:id/approve-delivery instead — delivery requires both parties to confirm.',
      400
    );
  }

  // Cancellation requires a reason — this is shown to the other party.
  if (status === 'cancelled') {
    const reason = (req.body?.reason || '').trim();
    if (!reason) {
      throw new AppError('A reason is required when cancelling an order.', 400);
    }
    order.cancellationReason = reason;
    order.cancelledBy = isBuyer ? 'buyer' : 'supplier';
  }

  order.status = status;
  await order.save();

  // Notify the other party. For supplier-driven transitions (confirmed/shipped/delivered)
  // we notify the buyer; for cancellations we notify whichever side didn't cancel.
  const notifyUserId =
    status === 'cancelled' && !isBuyer
      ? order.buyerId.userId
      : status === 'cancelled' && isBuyer
      ? null // we don't yet have a single supplier user to notify on a multi-supplier order
      : !isBuyer
      ? order.buyerId.userId
      : null;

  if (notifyUserId) {
    const reasonSuffix =
      status === 'cancelled' && order.cancellationReason
        ? ` Reason: ${order.cancellationReason}`
        : '';
    const notification = await Notification.create({
      userId: notifyUserId,
      title: status === 'cancelled' ? 'Order cancelled' : 'Order status updated',
      body: `Your order has been ${status === 'cancelled' ? 'cancelled' : `marked as ${status}`}.${reasonSuffix}`,
      type: 'order',
      data: { orderId: order._id, status, reason: order.cancellationReason },
    });
    emitNotification(req, notification);

    const buyerUser = await User.findById(notifyUserId).select('email');
    if (buyerUser?.email) {
      const { subject, html } = orderStatusChanged({ order, status });
      sendEmailSafe({ to: buyerUser.email, subject, html });
    }
  }

  sendSuccess(res, { order }, `Order status updated to "${status}".`);
});

// ── POST /api/v1/orders/:id/approve-delivery ────────────────────────────────
// Either party flips their delivery-approval flag. The order only transitions
// to `delivered` when both parties have approved AND payment is settled.
//
// Payment guard:
//   - If paymentStatus is already 'paid' (online payment cleared), no extra
//     check is needed.
//   - Otherwise (pay-on-delivery), the supplier must pass `cashCollected: true`
//     in their approval call. We then mark paymentStatus='paid'.
//
// We deliberately do not let buyers mark delivery if payment is unsettled, so
// suppliers always have visibility into the cash-collection step.
export const approveDelivery = asyncHandler(async (req, res) => {
  const profile = await Profile.findOne({ userId: req.user.id });
  if (!profile) throw new AppError('Profile not found.', 404);

  const order = await Order.findById(req.params.id).populate('buyerId', 'userId fullName');
  if (!order) throw new AppError('Order not found.', 404);

  const isBuyer = order.buyerId._id.toString() === profile._id.toString();
  const isSupplier = order.items.some(
    (item) => item.supplierId.toString() === profile._id.toString()
  );
  if (!isBuyer && !isSupplier) {
    throw new AppError('You are not authorised to update this order.', 403);
  }

  if (order.status !== 'shipped') {
    throw new AppError(
      'Delivery can only be approved on a shipped order.',
      400
    );
  }

  const cashCollected = req.body?.cashCollected === true;

  // Supplier-side approval — also handles pay-on-delivery cash collection.
  if (isSupplier) {
    if (order.supplierDeliveryApproved) {
      return sendSuccess(res, { order }, 'You have already confirmed delivery.');
    }
    if (order.paymentStatus !== 'paid' && !cashCollected) {
      throw new AppError(
        'Confirm cash was collected from the buyer to mark this delivered.',
        400
      );
    }
    if (order.paymentStatus !== 'paid' && cashCollected) {
      order.paymentStatus = 'paid';
    }
    order.supplierDeliveryApproved = true;
  } else {
    // Buyer-side approval — they confirm receipt.
    if (order.buyerDeliveryApproved) {
      return sendSuccess(res, { order }, 'You have already confirmed receipt.');
    }
    order.buyerDeliveryApproved = true;
  }

  // Both sides approved AND payment settled → transition to delivered.
  let transitioned = false;
  if (
    order.buyerDeliveryApproved &&
    order.supplierDeliveryApproved &&
    order.paymentStatus === 'paid'
  ) {
    order.status = 'delivered';
    order.deliveredAt = new Date();
    transitioned = true;
  }

  await order.save();

  // On transition to delivered: release any escrow entries (online-paid orders)
  // OR accrue COD platform fee if there's no escrow (cash-collected orders).
  if (transitioned) {
    // Read the held entry IDs first — we'll claim each one atomically below
    // so a duplicate transition (rare but possible) doesn't double-release.
    const heldEntries = await EscrowEntry.find({
      entityType: 'order',
      entityId: order._id,
      status: 'held',
    }).select('_id');

    if (heldEntries.length > 0) {
      for (const candidate of heldEntries) {
        const entry = await EscrowEntry.findOneAndUpdate(
          { _id: candidate._id, status: 'held' },
          { status: 'released', releasedAt: new Date() },
          { new: true }
        );
        if (!entry) continue; // claimed by a parallel call
        const { feeAmount, netAmount } = await releaseEscrow({
          sellerProfileId: entry.sellerProfileId,
          amount: entry.amount,
          source: 'order',
          referenceId: order._id,
        });
        entry.feeAmount = feeAmount;
        entry.netAmount = netAmount;
        await entry.save();
      }
    } else {
      // COD flow — no escrow ever existed (money went buyer → supplier in cash).
      // Accrue platform fee per supplier so we can collect later.
      const supplierTotals = new Map();
      for (const item of order.items) {
        const sid = item.supplierId.toString();
        const lineKobo = Math.round(item.priceAtOrder * item.quantity * 100);
        supplierTotals.set(sid, (supplierTotals.get(sid) || 0) + lineKobo);
      }
      const cfg = await PlatformSetting.getPaymentConfig();
      for (const [supplierId, amountKobo] of supplierTotals) {
        const { breachedThreshold, totalOwed } = await accrueCodFee({
          sellerProfileId: supplierId,
          orderAmountKobo: amountKobo,
          source: 'order',
          referenceId: order._id,
        });
        if (breachedThreshold) {
          // Fan-out to every admin so they can intervene.
          const admins = await User.find({ role: 'admin' }).select('_id');
          const supplier = await Profile.findById(supplierId).select('fullName');
          for (const admin of admins) {
            const n = await Notification.create({
              userId: admin._id,
              title: 'COD fees over threshold',
              body: `${supplier?.fullName || 'A supplier'} has accrued ₦${(totalOwed / 100).toLocaleString('en-NG')} in unpaid COD fees (threshold ₦${(cfg.codFeeThresholdKobo / 100).toLocaleString('en-NG')}).`,
              type: 'admin_fee_threshold',
              data: { supplierId, totalOwed },
            });
            emitNotification(req, n);
          }
        }
      }
    }
  }

  // Notify the other party.
  const otherUserId = isBuyer ? null : order.buyerId.userId;
  if (otherUserId) {
    const title = transitioned
      ? 'Order delivered'
      : isSupplier
      ? 'Awaiting your delivery confirmation'
      : 'Buyer confirmed receipt';
    const body = transitioned
      ? `Both parties confirmed delivery of order #${order._id.toString().slice(-8).toUpperCase()}.`
      : isSupplier
      ? `${profile.fullName} confirmed delivery — confirm receipt to finalise.`
      : `${profile.fullName} confirmed receipt — confirm delivery to finalise.`;
    const notification = await Notification.create({
      userId: otherUserId,
      title,
      body,
      type: 'order',
      data: { orderId: order._id, status: order.status },
    });
    emitNotification(req, notification);

    if (transitioned) {
      const buyerUser = await User.findById(otherUserId).select('email');
      if (buyerUser?.email) {
        const tpl = orderStatusChanged({ order, status: 'delivered' });
        sendEmailSafe({ to: buyerUser.email, subject: tpl.subject, html: tpl.html });
      }
    }
  }

  sendSuccess(
    res,
    { order },
    transitioned
      ? 'Order delivered.'
      : `${isSupplier ? 'Delivery' : 'Receipt'} approved — waiting on the other party.`
  );
});
