/**
 * The tail of the money path: hold expiry, then a payout.
 *
 * The 24-hour hold is a cron, so waiting for it in real time is not a test.
 * The holding rows are backdated and the real job is run — the same function
 * production calls hourly — rather than moving the balance by hand, which
 * would prove nothing about the code that actually does it.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Profile from '../models/Profile.js';
import Wallet from '../models/Wallet.js';
import WalletTransaction from '../models/WalletTransaction.js';
import { runExpireHoldPeriod } from './src/jobs/expireHoldPeriod.js';

dotenv.config({ path: '.env.local', override: true });
await mongoose.connect(process.env.MONGO_URI);
if (mongoose.connection.name !== 'sinterior-dev') throw new Error('dev database only');

const API = 'http://localhost:5000/api/v1';
let failures = 0;
const ok = (label, pass, detail = '') => {
  console.log(`${pass ? '  OK  ' : ' FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures += 1;
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

const login = await call('/auth/login', {
  method: 'POST',
  body: { email: 'walkthrough-seller@sintherior.test', password: 'Password@123' },
});
const seller = login.json?.data?.accessToken;
if (!seller) throw new Error('could not sign in as the seller');

const profile = await Profile.findOne({ fullName: 'Walkthrough Seller' });
const wallet = await Wallet.findOne({ profileId: profile._id });
console.log(`seller wallet — holding ${wallet.holdingBalance}, available ${wallet.availableBalance}\n`);

// ── 1. Make the hold due, then run the real cron ────────────────────────────
const backdated = await WalletTransaction.updateMany(
  { walletId: wallet._id, bucket: 'holding', availableAt: { $ne: null } },
  { $set: { availableAt: new Date(Date.now() - 60 * 60 * 1000) } }
);
console.log(`backdated ${backdated.modifiedCount} holding row(s)`);

const promoted = await runExpireHoldPeriod();
ok('the hold-expiry cron promoted something', promoted > 0, `${promoted} entries`);

const afterCron = (await call('/wallet/me', { token: seller })).json.data.wallet;
ok('the money is withdrawable now', afterCron.availableBalance > 0, `available ${afterCron.availableBalance}`);
ok('holding emptied', afterCron.holdingBalance === 0, `holding ${afterCron.holdingBalance}`);

// ── 2. A bank account to pay into ───────────────────────────────────────────
// Paystack test mode resolves this pair to a test account name.
const existing = (await call('/bank-accounts/me', { token: seller })).json.data.accounts;
let account = existing?.[0];

if (!account) {
  const resolved = await call('/banks/resolve?accountNumber=0000000000&bankCode=057', { token: seller });
  ok('the bank resolved the account name', !!resolved.json?.data?.accountName,
    resolved.json?.data?.accountName ?? JSON.stringify(resolved.json).slice(0, 120));

  const saved = await call('/bank-accounts', {
    method: 'POST',
    token: seller,
    body: { accountNumber: '0000000000', bankCode: '057', bankName: 'Zenith Bank' },
  });
  ok('bank account saved', saved.ok, JSON.stringify(saved.json).slice(0, 140));
  account = saved.json?.data?.account ?? (await call('/bank-accounts/me', { token: seller })).json.data.accounts?.[0];
}

if (!account) {
  console.log('\nno bank account — cannot test the payout itself');
  process.exit(1);
}

// ── 3. Ask for the money ────────────────────────────────────────────────────
const before = (await call('/wallet/me', { token: seller })).json.data.wallet;
const amount = before.availableBalance;

const requested = await call('/payouts', {
  method: 'POST',
  token: seller,
  body: { amount, bankAccountId: account._id },
});
ok('payout requested', requested.ok, JSON.stringify(requested.json).slice(0, 160));

const after = (await call('/wallet/me', { token: seller })).json.data.wallet;
ok('the balance was debited', after.availableBalance === 0, `available ${after.availableBalance}`);

const payouts = (await call('/payouts/me', { token: seller })).json.data.payouts;
ok('the request is on file', payouts.length > 0, payouts.map((p) => `${p.amount} ${p.status}`).join(', '));

// ── 4. And it cannot be asked for twice ─────────────────────────────────────
const again = await call('/payouts', {
  method: 'POST',
  token: seller,
  body: { amount, bankAccountId: account._id },
});
ok('a second request on an empty balance is refused', !again.ok,
  again.ok ? 'IT WAS ALLOWED' : (again.json?.message ?? '').slice(0, 90));

console.log(failures ? `\n${failures} check(s) failed.` : '\nHold expiry and payout both work.');
await mongoose.disconnect();
process.exit(failures ? 1 : 0);
