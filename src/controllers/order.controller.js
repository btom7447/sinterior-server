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
import { isSameRef, refId } from '../utils/refId.js';
import { anyStock, priceLine } from '../config/pricing.js';
import { sendEmailSafe } from '../utils/sendEmail.js';
import { settledSuppliers, suppliersOn } from '../config/delivery.js';
import { releaseEscrow, accrueCodFee } from '../services/wallet.service.js';
import PlatformSetting from '../models/PlatformSetting.js';
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

  // Self-order guard. A buyer can't order any product from themselves —
  // catches the case where a supplier (whose buyer profile is the same
  // Profile row) tries to checkout their own listing.
  const supplierIds = [...new Set(products.map((p) => p.supplierId.toString()))];
  if (supplierIds.includes(buyerProfile._id.toString())) {
    throw new AppError('You cannot order your own products.', 400);
  }

  // Block orders containing items from suspended suppliers.
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
    /*
     * Price the line through the one module that knows how.
     *
     * The base price is no longer the whole answer: a chosen variant has its
     * own price and its own stock, and a bulk tier can cut both. Resolving that
     * anywhere but config/pricing.js means two places that can disagree about
     * what somebody owes.
     */
    const line = priceLine({ product, quantity, options: item.selectedSpecs });

    if (line.available !== undefined && line.available < quantity) {
      const what = line.skuKey ? `"${product.name}" in that option` : `"${product.name}"`;
      throw new AppError(`Insufficient stock for ${what}. Available: ${line.available}.`, 400);
    }

    totalAmount += line.unitPrice * quantity;

    // The chosen options are recorded as given, so the order says which of the
    // variants was bought even after the listing changes.
    const selectedSpecs =
      item.selectedSpecs && typeof item.selectedSpecs === 'object' && Object.keys(item.selectedSpecs).length > 0
        ? item.selectedSpecs
        : undefined;

    return {
      productId: product._id,
      supplierId: product.supplierId,
      name: product.name,
      quantity,
      priceAtOrder: line.unitPrice,
      skuKey: line.skuKey ?? undefined,
      // Recorded on the line so the order screens can say "arriving in weeks,
      // not days" long after the listing has changed.
      preorder: line.preorder || undefined,
      ...(selectedSpecs ? { selectedSpecs } : {}),
    };
  });

  // Atomically decrement stock for each product
  for (const item of enrichedItems) {
    // A pre-order draws from nothing. Decrementing would push a count nobody is
    // holding into the negative, and the low-stock warning would fire on a
    // listing that never had stock to be low on.
    if (item.preorder) continue;

    /*
     * A variant draws from its own counter, not the product's. Decrementing the
     * wrong one oversells that variant and strands the rest, and the guard has
     * to sit in the query rather than in a read-then-write — two buyers taking
     * the last four bags a second apart would otherwise both succeed.
     */
    const claim = item.skuKey
      ? {
          filter: {
            _id: item.productId,
            skus: { $elemMatch: { key: item.skuKey, quantity: { $gte: item.quantity } } },
          },
          update: { $inc: { 'skus.$[row].quantity': -item.quantity } },
          options: { new: true, arrayFilters: [{ 'row.key': item.skuKey }] },
        }
      : {
          filter: { _id: item.productId, quantity: { $gte: item.quantity } },
          update: { $inc: { quantity: -item.quantity } },
          options: { new: true },
        };

    const result = await Product.findOneAndUpdate(claim.filter, claim.update, claim.options);
    if (!result) {
      throw new AppError(`Product "${item.name}" is no longer available in the requested quantity.`, 400);
    }

    // inStock covers the whole listing, so a product with variants is only out
    // when every one of them is — one sold-out colour must not hide the others.
    const stillSellable = anyStock(result);
    if (result.inStock !== stillSellable) {
      result.inStock = stillSellable;
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
    contactName,
    contactPhone,
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
      // The item carries a name snapshot but not a picture, and a list of
      // orders that is only text is unreadable at a glance. Images only —
      // the name and price must stay the snapshot taken at order time.
      .populate('buyerId', 'fullName avatarUrl city')
      .populate('items.productId', 'images'),
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

  const order = await Order.findById(req.params.id)
    .populate('buyerId', 'fullName avatarUrl phone city')
    // Images only. Name and price stay as they were when the order was placed —
    // repricing an order from the live product would rewrite history.
    .populate('items.productId', 'images')
    // Who is actually sending it. An order can span several suppliers, so the
    // buyer needs them named — to know who to chase, and to review afterwards.
    .populate('items.supplierId', 'fullName avatarUrl');

  if (!order) {
    throw new AppError('Order not found.', 404);
  }

  // Buyer or supplier (whose product is in the order) may view. Both refs are
  // populated above, so both are read through isSameRef.
  const isBuyer = isSameRef(order.buyerId, profile._id);
  const isSupplier = order.items.some((item) => isSameRef(item.supplierId, profile._id));

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
  const isBuyer = isSameRef(order.buyerId, profile._id);
  const isSupplier = order.items.some((item) => isSameRef(item.supplierId, profile._id));

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

  /*
   * Cancelling returns the stock the order took.
   *
   * `create` decrements on the way in and nothing put it back, so every
   * cancellation permanently ate inventory — a supplier with four hundred bags
   * and ten cancelled forty-bag orders reads as sold out with four hundred bags
   * in the yard, and the shop hides the Add button on all of them. Unpaid
   * orders can be cancelled and abandoned checkouts create orders, so this was
   * not a rare path.
   *
   * Safe to run exactly once: VALID_STATUS_TRANSITIONS leaves `cancelled` with
   * nowhere to go, so a second cancellation is refused before reaching here.
   * Pre-orders are skipped because they never decremented anything.
   */
  if (status === 'cancelled') {
    await Promise.all(
      order.items
        .filter((item) => !item.preorder)
        .map((item) =>
          item.skuKey
            ? Product.updateOne(
                { _id: refId(item.productId) },
                { $inc: { 'skus.$[row].quantity': item.quantity } },
                { arrayFilters: [{ 'row.key': item.skuKey }] }
              ).catch(() => {})
            : Product.updateOne(
                { _id: refId(item.productId) },
                { $inc: { quantity: item.quantity } }
              ).catch(() => {})
        )
    );

    // Anything that went to zero on the way out is sellable again now.
    const touched = await Product.find({
      _id: { $in: order.items.map((item) => refId(item.productId)) },
    });
    await Promise.all(
      touched.map((product) => {
        const sellable = anyStock(product);
        if (product.inStock === sellable) return null;
        product.inStock = sellable;
        return product.save().catch(() => {});
      })
    );
  }

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

  const isBuyer = isSameRef(order.buyerId, profile._id);
  const isSupplier = order.items.some((item) => isSameRef(item.supplierId, profile._id));
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

  /*
   * Every distinct supplier with a line on this order.
   *
   * Approval is tracked per supplier, because an order can straddle two of them
   * and one confirming does not mean the other has shipped anything.
   */
  const supplierIds = suppliersOn(order.items);
  const has = (list, id) => (list ?? []).some((entry) => isSameRef(entry, id));

  // Supplier-side approval — also handles pay-on-delivery cash collection.
  if (isSupplier) {
    if (has(order.supplierApprovals, profile._id)) {
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
    order.supplierApprovals.push(profile._id);
  } else {
    /*
     * Buyer-side approval — they confirm receipt, of one supplier's goods or of
     * everything.
     *
     * Naming a supplier is what makes a split delivery honest: a buyer whose
     * tiles arrived and whose cement has not should be able to free the tiles
     * without signing for the cement. Omitting it confirms the lot, which is
     * both the old behaviour and the right one for a single-supplier order.
     */
    const only = req.body?.supplierId;
    if (only && !supplierIds.some((id) => isSameRef(id, only))) {
      throw new AppError('That supplier has nothing on this order.', 400);
    }

    const confirming = only ? [only] : supplierIds;
    const fresh = confirming.filter((id) => !has(order.buyerApprovals, id));
    if (!fresh.length) {
      return sendSuccess(res, { order }, 'You have already confirmed receipt.');
    }
    order.buyerApprovals.push(...fresh);
  }

  /*
   * Which suppliers are now settled — confirmed by both sides.
   *
   * This is what decides the payout, rather than the order-level flags: escrow
   * for a supplier releases when that supplier has said they delivered and the
   * buyer has said it arrived, and not one moment before.
   */
  const settled = settledSuppliers({
    items: order.items,
    supplierApprovals: order.supplierApprovals,
    buyerApprovals: order.buyerApprovals,
  });

  // The summary flags every client already reads. True only when the whole
  // order is accounted for, which is what they have always meant.
  order.supplierDeliveryApproved = supplierIds.every((id) => has(order.supplierApprovals, id));
  order.buyerDeliveryApproved = supplierIds.every((id) => has(order.buyerApprovals, id));

  // Delivered when every supplier is settled and the money is in.
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

  /*
   * Escrow releases per supplier, the moment both sides have signed that
   * supplier off — not when the whole order completes.
   *
   * Gating this on the order-level transition would hold a supplier who
   * delivered hostage to a co-supplier who may never deliver, which is the
   * mirror image of the bug it replaced. Running it on every approval is safe
   * because each entry is claimed atomically below: a second call finds nothing
   * still `held` and does nothing.
   */
  if (settled.length > 0) {
    const heldEntries = await EscrowEntry.find({
      entityType: 'order',
      entityId: order._id,
      status: 'held',
      // Only suppliers both sides have signed off. Without this the first
      // supplier to confirm released the whole order's escrow, paying a
      // co-supplier who had shipped nothing.
      sellerProfileId: { $in: settled },
    }).select('_id');

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
  }

  // On full delivery: credit the sale to each listing, and — for a cash order
  // that never had escrow — accrue the platform fee we will collect later.
  if (transitioned) {
    /*
     * Credit the sale to each listing. Delivered is the only honest moment for
     * this — an order counted at checkout advertises sales that abandoned
     * payments and cancellations would later un-make, and nothing walks a
     * counter backwards.
     */
    await Promise.all(
      order.items.map((item) =>
        Product.updateOne(
          { _id: refId(item.productId) },
          { $inc: { soldCount: item.quantity } }
        ).catch(() => {})
      )
    );

    // Whether this order ever had escrow at all, rather than whether anything
    // is still held — by now the held entries have just been released, and
    // reading "none held" as "this was cash" would charge a COD fee on an
    // order that was paid online.
    const hadEscrow = await EscrowEntry.countDocuments({
      entityType: 'order',
      entityId: order._id,
    });

    if (hadEscrow === 0) {
      // COD flow — no escrow ever existed (money went buyer → supplier in cash).
      // Accrue platform fee per supplier so we can collect later.
      const supplierTotals = new Map();
      for (const item of order.items) {
        const sid = refId(item.supplierId);
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
