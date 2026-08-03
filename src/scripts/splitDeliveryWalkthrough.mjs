/**
 * What happens to a two-supplier order when only one supplier delivers.
 *
 * Delivery approval is a single boolean on the order — `supplierDeliveryApproved`
 * — and the release loop takes every held escrow entry on that order. So the
 * question this asks is whether a supplier who has shipped nothing gets paid
 * when their co-supplier delivers and the buyer confirms.
 *
 * Worth asking now specifically. Until recently the catalogue had one supplier
 * and almost every order was single-supplier; the shop now spans two and
 * checkout deliberately groups the cart by supplier, so orders that straddle
 * both are the normal case rather than a curiosity.
 *
 * Development only. Builds its own order and escrow entries, asserts, and
 * removes everything it made on the way out — including on failure.
 *
 * Usage: node src/scripts/splitDeliveryWalkthrough.mjs
 */
import mongoose from 'mongoose';
import assert from 'node:assert/strict';
import { connectGuarded } from './_guard.js';
import Order from '../models/Order.js';
import Profile from '../models/Profile.js';
import Product from '../models/Product.js';
import EscrowEntry from '../models/EscrowEntry.js';
import { settledSuppliers, fullyDelivered } from '../config/delivery.js';

const { isProduction } = await connectGuarded();
if (isProduction) throw new Error('This walkthrough writes orders. Development only.');

const created = { order: null, entries: [] };
let failed = null;
const step = (m) => console.log(`  ${m}`);

try {
  const buyer = await Profile.findOne({ role: 'client' }).select('_id fullName').lean();
  const suppliers = await Profile.find({ role: 'supplier' }).select('_id fullName').limit(2).lean();
  assert.ok(buyer, 'no client profile on this database');
  assert.equal(suppliers.length, 2, 'need two supplier profiles to build a split order');

  const [alpha, beta] = suppliers;
  step(`buyer ${buyer.fullName}, suppliers ${alpha.fullName} + ${beta.fullName}`);

  // A product each, so the order genuinely straddles two suppliers.
  const products = await Promise.all(
    suppliers.map((s) => Product.findOne({ supplierId: s._id }).select('_id name price unit').lean())
  );
  assert.ok(products[0] && products[1], 'both suppliers need at least one listing');

  const order = await Order.create({
    buyerId: buyer._id,
    items: products.map((p, i) => ({
      productId: p._id,
      supplierId: suppliers[i]._id,
      // The order snapshots the name and unit, so a later rename or delete
      // cannot rewrite what somebody bought.
      name: p.name,
      unit: p.unit ?? 'piece',
      quantity: 1,
      priceAtOrder: p.price,
    })),
    totalAmount: products[0].price + products[1].price,
    deliveryAddress: 'Walkthrough address, Uyo',
    contactName: 'Split Delivery Test',
    contactPhone: '08031234567',
    status: 'shipped',
    paymentStatus: 'paid',
  });
  created.order = order._id;
  step(`order ${order._id} — one line from each supplier, paid, shipped`);

  // One held escrow entry per supplier, which is what payment creates.
  for (const [i, supplier] of suppliers.entries()) {
    const entry = await EscrowEntry.create({
      entityType: 'order',
      entityId: order._id,
      sellerProfileId: supplier._id,
      buyerProfileId: buyer._id,
      amount: Math.round(products[i].price * 100),
      status: 'held',
    });
    created.entries.push(entry._id);
  }
  step(`two escrow entries held — ${alpha.fullName} and ${beta.fullName}`);

  // ── Alpha delivers. Beta has shipped nothing. ────────────────────────────
  order.supplierApprovals.push(alpha._id); // what approveDelivery now records
  order.buyerApprovals.push(alpha._id); // buyer confirms what actually arrived
  await order.save();
  step(`${alpha.fullName} confirmed delivery; buyer confirmed receipt of it`);

  const releasedTo = (o) =>
    settledSuppliers({
      items: o.items,
      supplierApprovals: o.supplierApprovals,
      buyerApprovals: o.buyerApprovals,
    });
  const done = (o) =>
    fullyDelivered({
      items: o.items,
      supplierApprovals: o.supplierApprovals,
      buyerApprovals: o.buyerApprovals,
    });
  const named = (ids) =>
    ids.map((id) => suppliers.find((s) => String(s._id) === String(id))?.fullName).join(', ');

  const first = releasedTo(order);
  step(`escrow released to: ${named(first) || 'nobody'}`);

  assert.equal(first.length, 1, 'exactly one supplier should have settled');
  assert.ok(
    !first.some((id) => String(id) === String(beta._id)),
    `${beta.fullName} was paid without ever confirming delivery`
  );
  assert.equal(done(order), false, 'order marked delivered while a supplier has shipped nothing');
  step(`${beta.fullName} still held, order still not delivered`);

  // ── Then Beta delivers too. ──────────────────────────────────────────────
  order.supplierApprovals.push(beta._id);
  order.buyerApprovals.push(beta._id);
  await order.save();

  assert.equal(releasedTo(order).length, 2, 'both should settle once both are confirmed');
  assert.equal(done(order), true, 'order should be delivered once every supplier is settled');
  step(`${beta.fullName} confirmed — both released, order now delivered`);

  /*
   * And the query the controller actually runs, against the same data.
   *
   * The rule above is a pure function; this is the database asking for the
   * entries it will release. Both are checked because a correct rule wired to
   * the wrong query pays the wrong people just as effectively.
   */
  const wouldRelease = await EscrowEntry.find({
    entityType: 'order',
    entityId: order._id,
    status: 'held',
    sellerProfileId: { $in: releasedTo(order) },
  })
    .select('sellerProfileId')
    .lean();

  assert.equal(wouldRelease.length, 2, 'the release query should match both settled suppliers');
  step('the release query agrees with the rule');

  console.log('\n  all good\n');
} catch (err) {
  failed = err;
} finally {
  if (created.entries.length) await EscrowEntry.deleteMany({ _id: { $in: created.entries } });
  if (created.order) await Order.deleteOne({ _id: created.order });
  step('cleaned up');
  await mongoose.disconnect();
}

if (failed) {
  console.error(`\n  FAILED: ${failed.message}\n`);
  process.exit(1);
}
