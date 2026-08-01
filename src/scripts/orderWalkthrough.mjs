/**
 * Walk an order as far as it goes without a live payment.
 *
 *   BUYER_EMAIL=... BUYER_PASSWORD=... node src/scripts/orderWalkthrough.mjs
 *
 * Creates a real order against production and cancels it, so it is safe to run
 * repeatedly — but it does touch live stock between those two steps.
 *
 * Everything up to the Paystack sheet, and everything after it that does not
 * depend on money having moved, driven through the real API against production.
 * The payment itself is the one step that needs a human and a card, so it is
 * called out rather than faked.
 *
 * Buys against a variant deliberately, because that is the path with the most
 * to get wrong: the price must come from the chosen row, and the stock must
 * leave that row and no other.
 */
const API = 'https://api.sintherior.com/api/v1';

const BUYER = { email: process.env.BUYER_EMAIL, password: process.env.BUYER_PASSWORD };
if (!BUYER.email || !BUYER.password) throw new Error('set BUYER_EMAIL and BUYER_PASSWORD');

const call = async (path, { method = 'GET', token, body } = {}) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
};

const check = (label, pass, detail = '') => {
  console.log(`${pass ? '  OK  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
  return pass;
};

let failures = 0;
const expect = (label, pass, detail) => {
  if (!check(label, pass, detail)) failures += 1;
};

// ── Sign in ─────────────────────────────────────────────────────────────────
const login = await call('/auth/login', { method: 'POST', body: BUYER });
const token = login.json?.data?.accessToken;
if (!token) throw new Error(`could not sign in: ${JSON.stringify(login.json).slice(0, 200)}`);
console.log(`signed in as ${BUYER.email}\n`);

// ── Find the variant listing ────────────────────────────────────────────────
const list = await call('/products?limit=100');
const products = Array.isArray(list.json.data) ? list.json.data : list.json.data.products;
const tile = products.find((p) => p.skus?.length >= 2);
if (!tile) throw new Error('no listing with variants to test against');

const full = (await call(`/products/${tile._id}`)).json.data.product;
const cheap = [...full.skus].filter((s) => s.quantity > 0).sort((a, b) => a.price - b.price)[0];
const options = cheap.options;
const before = cheap.quantity;

console.log(`product: ${full.name}`);
console.log(`variant: ${Object.values(options).join(' / ')} at ₦${cheap.price}, ${before} in stock\n`);

// ── 1. check-stock prices the variant, not the product ──────────────────────
const QTY = 2;
const stock = await call('/products/check-stock', {
  method: 'POST',
  body: { items: [{ productId: full._id, quantity: QTY, selectedSpecs: options }] },
});
const row = stock.json?.data?.results?.[0];
expect('check-stock quotes the variant price', row?.price === cheap.price, `got ₦${row?.price}, expected ₦${cheap.price}`);
expect('check-stock reports the variant stock', row?.availableQuantity === before, `got ${row?.availableQuantity}`);

// ── 2. The order prices from the variant and takes from its row ─────────────
const placed = await call('/orders', {
  method: 'POST',
  token,
  body: {
    items: [{ productId: full._id, quantity: QTY, selectedSpecs: options }],
    contactName: 'Walkthrough',
    contactPhone: '08000000000',
    deliveryAddress: 'Test run — cancel me',
    deliveryState: 'Lagos',
  },
});
const order = placed.json?.data?.order;
expect('order created', placed.ok && !!order, placed.ok ? '' : JSON.stringify(placed.json).slice(0, 160));
if (!order) process.exit(1);

const line = order.items[0];
expect('line priced from the variant', line.priceAtOrder === cheap.price, `got ₦${line.priceAtOrder}`);
expect('line records which variant', !!line.skuKey, line.skuKey ?? 'no skuKey');
expect('total is price times quantity', order.totalAmount === cheap.price * QTY, `got ₦${order.totalAmount}`);
expect('starts unpaid', order.paymentStatus === 'pending', order.paymentStatus);

// ── 3. Stock left the right row ─────────────────────────────────────────────
const afterOrder = (await call(`/products/${full._id}`)).json.data.product;
const sameRow = afterOrder.skus.find((s) => s.key === cheap.key);
const others = afterOrder.skus.filter((s) => s.key !== cheap.key);
expect('the chosen variant lost the stock', sameRow.quantity === before - QTY, `${before} → ${sameRow.quantity}`);
expect(
  'no other variant was touched',
  others.every((s) => s.quantity === full.skus.find((o) => o.key === s.key).quantity)
);

// ── 4. Cancelling gives it back ─────────────────────────────────────────────
const cancelled = await call(`/orders/${order._id}/status`, {
  method: 'PATCH',
  token,
  body: { status: 'cancelled', reason: 'End-to-end walkthrough' },
});
expect('buyer can cancel an unpaid order', cancelled.ok, JSON.stringify(cancelled.json).slice(0, 120));

const afterCancel = (await call(`/products/${full._id}`)).json.data.product;
const restored = afterCancel.skus.find((s) => s.key === cheap.key);
expect('cancelling returns the stock', restored.quantity === before, `${sameRow.quantity} → ${restored.quantity}, expected ${before}`);

console.log(
  failures
    ? `\n${failures} check(s) failed.`
    : '\nEvery step up to payment behaves correctly.'
);
console.log(
  '\nStill needs a human: the Paystack sheet, and everything downstream of it —\n' +
    'escrow hold, supplier confirm/ship, both delivery approvals, escrow release,\n' +
    'the wallet credit, and the payout. Swap Paystack to test keys before running it.'
);
process.exit(failures ? 1 : 0);
