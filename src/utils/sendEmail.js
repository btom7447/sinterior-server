import { Resend } from 'resend';
import config from '../config/env.js';

const resend = config.RESEND_API_KEY ? new Resend(config.RESEND_API_KEY) : null;

const FROM_ADDRESS = config.EMAIL_FROM || 'Sintherior <noreply@sintherior.com>';

/**
 * Send a transactional email via Resend.
 * Falls back to console logging in development when no API key is set.
 */
export const sendEmail = async ({ to, subject, html }) => {
  if (!resend) {
    console.log(`[EMAIL] (no RESEND_API_KEY — skipping send)`);
    console.log(`  To: ${to}`);
    console.log(`  Subject: ${subject}`);
    console.log(`  Body: ${html.slice(0, 200)}...`);
    return null;
  }

  const { data, error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to,
    subject,
    html,
  });

  if (error) {
    console.error('[EMAIL] Failed to send:', error);
    throw new Error(`Email send failed: ${error.message}`);
  }

  return data;
};
