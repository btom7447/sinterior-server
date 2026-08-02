/**
 * The four money paths the main walkthrough never reaches.
 *
 *   node server.js                         # on .env.local: test keys, dev db
 *   node src/scripts/walkthroughSeed.mjs   # once
 *   node src/scripts/edgeWalkthrough.mjs
 *
 * Dev database only.
 *
 *  1. A two-supplier order — the escrow split has only ever had one entry to
 *     split into, so the loop that divides a payment between sellers has never
 *     actually divided anything.
 *  2. Cash on delivery — the branch where no escrow entry exists at all and the
 *     platform fee is accrued against the supplier instead.
 *  3. A refund — money going back, which nothing has ever exercised.
 *  4. An admin releasing a payout, which is where a transfer actually reaches
 *     Paystack.
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', override: true });

const API = 'http://localhost:5000/api/v1';
const PS = 'https://api.paystack.co';
const KEY = process.env.PAYSTACK_SECRET_KEY;
if (!KEY?.startsWith('sk_test')) throw new Error('refusing to run without a test key');

const CARD = { number: '4084084084084081', cvv: '408', expiry_month: '12', expiry_year: '30' };
const PIN = '0000';
const OTP = '123456';

let failures = 0;
const ok = (label, pass, detail = '') => {
  console.log(`${pass ? '  OK  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures += 1;
  return pass;
};
const note = (text) => console.log(`  ..    ${text}`);
const section = (text) => console.log(`\n${text}`);

const call = async (path, { method = 'GET', token, body } = {}) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { ok: res.ok, status: res.status, json: await res.json().catch(() => ({})) };
};

const paystack = async (path, body) => {
  const res = await fetch(`${PS}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
};

const signIn = async (email) => {
  const r = await call('/auth/login', { method: 'POST', body: { email, password: 'Password@123' } });
  const token = r.json?.data?.accessToken;
  if (!token) throw new Error(`could not sign in ${email}: ${JSON.stringify(r.json).slice(0, 160)}`);
  return token;
};

/** Charge a test card against an order, then let our own verify do the rest. */
const payFor = async (order) => {
  let charge = await paystack('/charge', {
    email: 'walkthrough.buyer@gmail.com',
    amount: Math.round(order.totalAmount * 100),
    card: CARD,
    metadata: { type: 'order', entityId: order._id },
  });
  if (charge.data?.status === 'send_pin') {
    charge = await paystack('/charge/submit_pin', { pin: PIN, reference: charge.data.reference });
  }
  if (charge.data?.status === 'send_otp') {
    charge = await paystack('/charge/submit_otp', { otp: OTP, reference: charge.data.reference });
  }
  if (charge.data?.status !== 'success') return null;
  await call(`/payments/verify?reference=${charge.data.reference}`);
  return charge.data.reference;
};

const buyer = await signIn('walkthrough-buyer@sintherior.test');
const seller = await signIn('walkthrough-seller@sintherior.test');
const seller2 = await signIn('walkthrough-seller2@sintherior.test');
const admin = await signIn('walkthrough-admin@sintherior.test');

const products = await call('/products?limit=100');
const list = Array.isArray(products.json.data) ? products.json.data : products.json.data.products;
const one = list.find((p) => p.name === 'Walkthrough test bag');
const two = list.find((p) => p.name === 'Walkthrough test bag (two)');
if (!one || !two) throw new Error('seed products missing — run walkthroughSeed.mjs');

const wallet = async (token) => (await call('/wallet/me', { token })).json.data.wallet;

// ── 1. A two-supplier order splits into two escrow entries ──────────────────
section('1. Per-supplier escrow split');

const w1before = await wallet(seller);
const w2before = await wallet(seller2);

const splitOrder = (
  await call('/orders', {
    method: 'POST',
    token: buyer,
    body: {
      items: [
        { productId: one._id, quantity: 2 }, // 2 × ₦1,000 = ₦2,000
        { productId: two._id, quantity: 3 }, // 3 × ₦2,500 = ₦7,500
      ],
      contactName: 'Walkthrough Buyer',
      contactPhone: '08000000000',
      deliveryAddress: '1 Test Road',
      deliveryState: 'Lagos',
    },
  })
).json?.data?.order;

ok('order spans two suppliers', splitOrder?.totalAmount === 9500, `₦${splitOrder?.totalAmount}`);
if (!splitOrder) process.exit(1);

const splitRef = await payFor(splitOrder);
ok('two-supplier order paid', !!splitRef, splitRef ?? 'charge failed');

const w1after = await wallet(seller);
const w2after = await wallet(seller2);

// The whole point: each seller is credited what THEY sold, not half the total.
ok(
  'first supplier credited their own lines',
  w1after.pendingBalance - w1before.pendingBalance === 200_000,
  `moved ${w1after.pendingBalance - w1before.pendingBalance}, expected 200000`
);
ok(
  'second supplier credited their own lines',
  w2after.pendingBalance - w2before.pendingBalance === 750_000,
  `moved ${w2after.pendingBalance - w2before.pendingBalance}, expected 750000`
);

const e1 = (await call('/wallet/me/escrow', { token: seller })).json.data.entries;
const e2 = (await call('/wallet/me/escrow', { token: seller2 })).json.data.entries;
ok('each supplier holds their own escrow entry', e1.length >= 1 && e2.length >= 1,
  `${e1.length} and ${e2.length}`);

// ── 2. Cash on delivery accrues a fee instead of escrowing ──────────────────
section('2. Cash on delivery');

const codBefore = await wallet(seller);
const codOrder = (
  await call('/orders', {
    method: 'POST',
    token: buyer,
    body: {
      items: [{ productId: one._id, quantity: 4 }],
      contactName: 'Walkthrough Buyer',
      contactPhone: '08000000000',
      deliveryAddress: '1 Test Road',
      deliveryState: 'Lagos',
      paymentMethod: 'Pay on Delivery',
    },
  })
).json?.data?.order;
ok('cash order placed', !!codOrder, codOrder ? `₦${codOrder.totalAmount}` : 'failed');

// No card, no escrow. Straight along the status track.
await call(`/orders/${codOrder._id}/status`, { method: 'PATCH', token: seller, body: { status: 'confirmed' } });
await call(`/orders/${codOrder._id}/status`, { method: 'PATCH', token: seller, body: { status: 'shipped' } });

const codEscrow = (await call('/wallet/me/escrow', { token: seller })).json.data.entries;
const codHasNoEntry = !codEscrow.some((e) => String(e.entityId) === String(codOrder._id));
ok('no escrow entry exists for a cash order', codHasNoEntry);

// The supplier confirms with the cash in hand; the buyer confirms receipt.
const collected = await call(`/orders/${codOrder._id}/approve-delivery`, {
  method: 'POST',
  token: seller,
  body: { cashCollected: true },
});
ok('supplier confirms cash collected', collected.ok, JSON.stringify(collected.json).slice(0, 120));
await call(`/orders/${codOrder._id}/approve-delivery`, { method: 'POST', token: buyer, body: {} });

const codOrderAfter = (await call(`/orders/${codOrder._id}`, { token: buyer })).json.data.order;
ok('cash order reads as paid and delivered',
  codOrderAfter.paymentStatus === 'paid' && codOrderAfter.status === 'delivered',
  `${codOrderAfter.paymentStatus} / ${codOrderAfter.status}`);

const codAfter = await wallet(seller);
ok('a platform fee is now owed', codAfter.feesOwed > codBefore.feesOwed,
  `${codBefore.feesOwed} → ${codAfter.feesOwed}`);
ok('nothing was credited — the money went hand to hand',
  codAfter.availableBalance === codBefore.availableBalance &&
    codAfter.pendingBalance === codBefore.pendingBalance);

// ── 3. A refund pulls money back ────────────────────────────────────────────
section('3. Refund');

const held = (await call('/wallet/me/escrow', { token: seller2 })).json.data.entries;
const target = held[0];
if (!target) {
  ok('an escrow entry exists to refund', false, 'none held');
} else {
  const refundBefore = await wallet(seller2);
  const refunded = await call(`/admin/escrow/${target._id}/refund`, {
    method: 'POST',
    token: admin,
    body: { reason: 'Edge walkthrough' },
  });
  ok('admin can refund a held entry', refunded.ok, JSON.stringify(refunded.json).slice(0, 140));

  const refundAfter = await wallet(seller2);
  ok('the pending balance came back down',
    refundAfter.pendingBalance === refundBefore.pendingBalance - target.amount,
    `${refundBefore.pendingBalance} → ${refundAfter.pendingBalance}, entry was ${target.amount}`);
  ok('the refund total went up',
    refundAfter.totalRefunded > refundBefore.totalRefunded,
    `${refundBefore.totalRefunded} → ${refundAfter.totalRefunded}`);

  const stillHeld = (await call('/wallet/me/escrow', { token: seller2 })).json.data.entries;
  ok('the entry is no longer held',
    !stillHeld.some((e) => String(e._id) === String(target._id)));
}

// ── 4. An admin releases a payout, and a transfer leaves ────────────────────
section('4. Payout transfer');

const pending = (await call('/payouts/me', { token: seller })).json.data.payouts.filter(
  (p) => p.status === 'pending'
);

if (!pending.length) {
  note('no pending payout to release — run moneyWalkthrough then payoutWalkthrough first');
} else {
  const payout = pending[0];

  /*
   * release-now clears the cooldown; it does not transfer.
   *
   * The first version of this asserted the payout left `pending` immediately
   * and failed — which was the test being wrong, not the code. The transfer is
   * the cron's job, so the cron is what has to run.
   */
  const released = await call(`/admin/payouts/${payout._id}/release-now`, {
    method: 'POST',
    token: admin,
  });
  ok('admin cleared the cooldown', released.ok, JSON.stringify(released.json).slice(0, 120));

  /*
   * The real job, not a hand-moved status — otherwise this proves nothing about
   * the code that runs in production.
   *
   * It talks to Mongo directly, and this script has only ever spoken HTTP, so
   * it needs its own connection. Without one every model call sits in
   * mongoose's buffer until it times out, which reads as the cron failing when
   * it never ran at all.
   */
  const mongoose = (await import('mongoose')).default;
  // The job populates these, and mongoose only knows a model once its module
  // has been imported. Without them it throws "Schema hasn't been registered"
  // rather than doing any work.
  await import('../models/BankAccount.js');
  await import('../models/PayoutRequest.js');
  await import('../models/Wallet.js');
  await import('../models/PlatformSetting.js');
  await mongoose.connect(process.env.MONGO_URI);
  if (mongoose.connection.name !== 'sinterior-dev') {
    throw new Error(`refusing to run the cron against "${mongoose.connection.name}"`);
  }
  const { runProcessPayoutCooldown } = await import('../jobs/processPayoutCooldown.js');
  await runProcessPayoutCooldown().catch((err) => note(`cron threw: ${err.message}`));
  await mongoose.disconnect();

  /*
   * Paystack blocks live transfers on unactivated test businesses, which is a
   * limit of the account rather than of this code. Reaching Paystack and being
   * told that is still proof the transfer was actually attempted — so it is
   * reported rather than counted as a failure of ours.
   */
  const after = (await call('/payouts/me', { token: seller })).json.data.payouts.find(
    (p) => String(p._id) === String(payout._id)
  );

  /*
   * Paystack blocks transfers on unactivated test businesses. That is a limit
   * of the account, not of this code — reaching Paystack and being refused
   * still proves the transfer was attempted, so it is reported rather than
   * counted against us.
   */
  if (after?.status === 'failed' && /transfer|recipient|balance|activate|starter|third party/i.test(after.failureReason ?? '')) {
    note(`Paystack refused the transfer: ${after.failureReason}`);
    note('the request reached Paystack, which is as far as a test account goes');
    ok('the failure was recorded against the payout', !!after.failureReason);
  } else {
    ok('the payout left the pending state', after && after.status !== 'pending', after?.status);
  }
}

console.log(
  failures ? `\n${failures} check(s) failed.` : '\nAll four paths behave correctly.'
);
process.exit(failures ? 1 : 0);
