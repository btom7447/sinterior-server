import config from '../config/env.js';

const PAYSTACK_BASE = 'https://api.paystack.co';

const headers = () => ({
  Authorization: `Bearer ${config.PAYSTACK_SECRET_KEY}`,
  'Content-Type': 'application/json',
});

/**
 * Initialize a Paystack transaction.
 * @param {{ email: string, amount: number, reference: string, metadata?: object, callback_url?: string }} params
 * @returns {{ authorization_url: string, access_code: string, reference: string }}
 */
export const initializeTransaction = async ({ email, amount, reference, metadata, callback_url }) => {
  const res = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      email,
      amount: Math.round(amount * 100), // Paystack expects kobo
      reference,
      metadata,
      callback_url,
    }),
  });
  const data = await res.json();
  if (!data.status) throw new Error(data.message || 'Failed to initialize Paystack transaction');
  return data.data;
};

/**
 * Verify a Paystack transaction by reference.
 * @param {string} reference
 */
export const verifyTransaction = async (reference) => {
  const res = await fetch(`${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: headers(),
  });
  const data = await res.json();
  if (!data.status) throw new Error(data.message || 'Failed to verify transaction');
  return data.data;
};

// ── Banks + transfers (used by the payout flow) ─────────────────────────────

/** List Nigerian banks. Cached at the route layer. */
export const listBanks = async () => {
  const res = await fetch(`${PAYSTACK_BASE}/bank?country=nigeria`, { headers: headers() });
  const data = await res.json();
  if (!data.status) throw new Error(data.message || 'Failed to fetch banks');
  return data.data;
};

/** Verify an account number → returns the registered account name. */
export const resolveAccount = async ({ accountNumber, bankCode }) => {
  const params = new URLSearchParams({ account_number: accountNumber, bank_code: bankCode });
  const res = await fetch(`${PAYSTACK_BASE}/bank/resolve?${params.toString()}`, {
    headers: headers(),
  });
  const data = await res.json();
  if (!data.status) throw new Error(data.message || 'Could not verify account');
  return data.data; // { account_number, account_name, bank_id }
};

/** Create a Paystack transfer recipient — reusable handle for future transfers. */
export const createTransferRecipient = async ({ name, accountNumber, bankCode }) => {
  const res = await fetch(`${PAYSTACK_BASE}/transferrecipient`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      type: 'nuban',
      name,
      account_number: accountNumber,
      bank_code: bankCode,
      currency: 'NGN',
    }),
  });
  const data = await res.json();
  if (!data.status) throw new Error(data.message || 'Failed to create transfer recipient');
  return data.data; // { recipient_code, ... }
};

/**
 * Refund a charge to the buyer's original payment method. Optionally partial.
 * `amount` (kobo) — omit to refund the full charge.
 */
export const refundCharge = async ({ transactionReference, amount, reason }) => {
  const body = { transaction: transactionReference };
  if (amount) body.amount = amount;
  if (reason) body.merchant_note = reason;
  const res = await fetch(`${PAYSTACK_BASE}/refund`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.status) throw new Error(data.message || 'Failed to issue refund');
  return data.data;
};

/**
 * Initiate a transfer to a recipient. `amount` is in kobo (already an integer).
 * Paystack settles asynchronously — listen for transfer.success / transfer.failed
 * webhooks to determine final state.
 */
export const initiateTransfer = async ({ amount, recipientCode, reference, reason }) => {
  const res = await fetch(`${PAYSTACK_BASE}/transfer`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      source: 'balance',
      amount, // already kobo
      recipient: recipientCode,
      reference,
      reason: reason || 'Sintherior payout',
    }),
  });
  const data = await res.json();
  if (!data.status) throw new Error(data.message || 'Failed to initiate transfer');
  return data.data; // { transfer_code, reference, status, ... }
};
