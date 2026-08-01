/**
 * The money path, end to end, against Paystack's test keys.
 *
 *   node server.js                              # on .env.local: test keys, dev db
 *   node src/scripts/walkthroughSeed.mjs        # once
 *   QTY=10 node src/scripts/moneyWalkthrough.mjs
 *   node src/scripts/payoutWalkthrough.mjs
 *
 * Dev database only. It charges a card, holds escrow, releases it and moves a
 * real balance — none of which belongs in production.
 *
 * Order → charge → escrow held → supplier confirms → ships → both parties
 * approve delivery → escrow released → wallet credited → payout requested.
 *
 * The card is charged through Paystack's Charge API rather than the checkout
 * page, because a browser is the one thing a script cannot drive. The metadata
 * matches what /payments/initialize would have set, so our own /payments/verify
 * treats it exactly as it treats a real one — same amount check, same escrow
 * creation, same idempotency guard.
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
  const r = await call('/auth/login', {
    method: 'POST',
    body: { email, password: 'Password@123' },
  });
  const token = r.json?.data?.accessToken;
  if (!token) throw new Error(`could not sign in ${email}: ${JSON.stringify(r.json).slice(0, 160)}`);
  return token;
};

const buyer = await signIn('walkthrough-buyer@sintherior.test');
const seller = await signIn('walkthrough-seller@sintherior.test');
console.log('signed in as both parties\n');

// ── 1. Place the order ──────────────────────────────────────────────────────
const products = await call('/products?limit=100');
const list = Array.isArray(products.json.data) ? products.json.data : products.json.data.products;
const item = list.find((p) => p.name === 'Walkthrough test bag');
if (!item) throw new Error('seed product missing');

// Enough to clear the ₦5,000 payout minimum, so the tail of the path is
// reachable in the same run.
const QTY = Number(process.env.QTY) || 3;

/*
 * Wallet checks are deltas, not absolutes.
 *
 * A second run finds the first run's money still sitting there, and an
 * assertion that available is zero would fail on a wallet that is working
 * perfectly. What matters is what THIS order moved.
 */
const before = (await call('/wallet/me', { token: seller })).json.data.wallet;
const placed = await call('/orders', {
  method: 'POST',
  token: buyer,
  body: {
    items: [{ productId: item._id, quantity: QTY }],
    contactName: 'Walkthrough Buyer',
    contactPhone: '08000000000',
    deliveryAddress: '1 Test Road',
    deliveryState: 'Lagos',
  },
});
const order = placed.json?.data?.order;
ok('order placed', !!order, order ? `₦${order.totalAmount}` : JSON.stringify(placed.json).slice(0, 140));
if (!order) process.exit(1);

// ── 2. Charge a real test card ──────────────────────────────────────────────
const kobo = Math.round(order.totalAmount * 100);
// Paystack refuses the .test TLD our seed accounts use. The address here is
// only the payer's on Paystack's side — our verify keys off the metadata, not
// the email — so a deliverable-looking one is all that is required.
let charge = await paystack('/charge', {
  email: 'walkthrough.buyer@gmail.com',
  amount: kobo,
  card: CARD,
  // What /payments/initialize would have attached. /payments/verify reads this
  // to know which order was paid for.
  metadata: { type: 'order', entityId: order._id },
});

// Test cards walk a PIN then an OTP. Each step returns the next.
if (charge.data?.status === 'send_pin') {
  charge = await paystack('/charge/submit_pin', { pin: PIN, reference: charge.data.reference });
}
if (charge.data?.status === 'send_otp') {
  charge = await paystack('/charge/submit_otp', { otp: OTP, reference: charge.data.reference });
}
ok('card charged', charge.data?.status === 'success', charge.data?.status ?? charge.message);

const reference = charge.data?.reference;
if (!reference) process.exit(1);

// ── 3. Our own verify marks it paid and holds escrow ────────────────────────
const verified = await call(`/payments/verify?reference=${reference}`);
ok('payment verified', verified.json?.data?.status === 'success', JSON.stringify(verified.json).slice(0, 140));

const paid = (await call(`/orders/${order._id}`, { token: buyer })).json.data.order;
ok('order reads as paid', paid.paymentStatus === 'paid', paid.paymentStatus);

const wallet1 = (await call('/wallet/me', { token: seller })).json.data.wallet;
ok('the charge landed in escrow', wallet1.pendingBalance - before.pendingBalance === kobo,
  `pending moved by ${wallet1.pendingBalance - before.pendingBalance}, expected ${kobo}`);
ok('none of it is withdrawable yet', wallet1.availableBalance === before.availableBalance,
  `available moved by ${wallet1.availableBalance - before.availableBalance}`);

const escrow = (await call('/wallet/me/escrow', { token: seller })).json.data.entries;
ok('an escrow entry is held', escrow.length >= 1, `${escrow.length} held`);

// ── 4. The supplier moves it along ──────────────────────────────────────────
const confirmed = await call(`/orders/${order._id}/status`, {
  method: 'PATCH', token: seller, body: { status: 'confirmed' },
});
ok('supplier accepts', confirmed.ok, JSON.stringify(confirmed.json).slice(0, 120));

const shipped = await call(`/orders/${order._id}/status`, {
  method: 'PATCH', token: seller, body: { status: 'shipped' },
});
ok('supplier ships', shipped.ok, JSON.stringify(shipped.json).slice(0, 120));

// ── 5. Delivery takes both of them ──────────────────────────────────────────
const sellerSide = await call(`/orders/${order._id}/approve-delivery`, { method: 'POST', token: seller, body: {} });
ok('supplier confirms delivery', sellerSide.ok);
const halfway = (await call(`/orders/${order._id}`, { token: buyer })).json.data.order;
ok('one approval is not enough', halfway.status === 'shipped', `status is ${halfway.status}`);

const buyerSide = await call(`/orders/${order._id}/approve-delivery`, { method: 'POST', token: buyer, body: {} });
ok('buyer confirms receipt', buyerSide.ok);
const done = (await call(`/orders/${order._id}`, { token: buyer })).json.data.order;
ok('both approvals complete it', done.status === 'delivered', `status is ${done.status}`);

// ── 6. Escrow releases into the wallet ──────────────────────────────────────
const wallet2 = (await call('/wallet/me', { token: seller })).json.data.wallet;
const credited =
  wallet2.holdingBalance + wallet2.availableBalance - (before.holdingBalance + before.availableBalance);

ok('escrow released this order', wallet2.pendingBalance === before.pendingBalance,
  `pending moved by ${wallet2.pendingBalance - before.pendingBalance}`);
ok('the seller was credited', credited > 0, `credited ${credited} kobo`);
ok('the platform took its fee', credited < kobo,
  `credited ${credited} of ${kobo} — fee ${kobo - credited}`);

const ledger = (await call('/wallet/me/transactions', { token: seller })).json.data.transactions;
ok('the ledger recorded it', ledger.length > 0, `${ledger.length} rows: ${ledger.map((r) => r.type).join(', ')}`);

const stillHeld = (await call('/wallet/me/escrow', { token: seller })).json.data.entries;
ok('this order is no longer held', stillHeld.length < escrow.length || stillHeld.length === 0,
  `${stillHeld.length} still held`);

// ── 7. Sold count only moves on delivery ────────────────────────────────────
const after = (await call(`/products/${item._id}`)).json.data.product;
ok('sold count credited on delivery', after.soldCount >= QTY, `soldCount ${after.soldCount}`);

console.log(
  failures
    ? `\n${failures} check(s) failed.`
    : '\nThe whole money path works: charge, escrow, dual approval, release, credit.'
);
console.log(
  `\nSeller wallet — holding ${wallet2.holdingBalance} kobo, available ${wallet2.availableBalance} kobo.` +
    `\nPayouts need the ${wallet2.holdHours}h hold to clear first, which is a cron, not a bug.`
);
process.exit(failures ? 1 : 0);
