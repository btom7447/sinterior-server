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
