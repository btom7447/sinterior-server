/**
 * Transactional email templates.
 *
 * All templates return `{ subject, html }` and share a common branded wrapper
 * so design stays consistent. `html` is intentionally inline-styled — email
 * clients ignore <style> blocks and classes.
 */

import config from '../config/env.js';

const BRAND = {
  name: 'Sintherior',
  primary: '#1a1a1a',
  muted: '#6b7280',
  success: '#16a34a',
  danger: '#dc2626',
  bg: '#f5f5f4',
  card: '#ffffff',
  border: '#e5e7eb',
};

const naira = (n) => `₦${Number(n || 0).toLocaleString('en-NG')}`;

const formatDate = (d) => {
  if (!d) return '—';
  const date = new Date(d);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-NG', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

const shortId = (id) =>
  id ? String(id).slice(-8).toUpperCase() : '';

/**
 * Branded wrapper. Every email uses this layout.
 * @param {object} opts
 * @param {string} opts.preheader - Hidden snippet shown in inbox previews
 * @param {string} opts.title     - Big heading at top of the email body
 * @param {string} opts.body      - Inner HTML (already styled)
 * @param {{label:string,url:string}=} opts.cta  - Optional primary button
 */
const wrap = ({ preheader = '', title, body, cta }) => `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${title}</title>
  </head>
  <body style="margin:0;padding:0;background:${BRAND.bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${BRAND.primary};">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preheader}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:${BRAND.card};border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
            <tr>
              <td style="padding:32px 32px 16px 32px;">
                <div style="font-weight:700;font-size:20px;letter-spacing:-0.01em;color:${BRAND.primary};">${BRAND.name}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px;">
                <div style="height:1px;background:${BRAND.border};"></div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 8px 32px;">
                <h1 style="margin:0 0 12px 0;font-size:22px;font-weight:700;letter-spacing:-0.01em;color:${BRAND.primary};">${title}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 24px 32px;font-size:15px;line-height:1.6;color:${BRAND.primary};">
                ${body}
              </td>
            </tr>
            ${
              cta
                ? `<tr>
              <td style="padding:0 32px 32px 32px;" align="left">
                <a href="${cta.url}" style="display:inline-block;padding:12px 24px;background:${BRAND.primary};color:#ffffff;text-decoration:none;border-radius:10px;font-weight:600;font-size:14px;">${cta.label}</a>
              </td>
            </tr>`
                : ''
            }
            <tr>
              <td style="padding:0 32px;">
                <div style="height:1px;background:${BRAND.border};"></div>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 32px 32px;font-size:12px;color:${BRAND.muted};line-height:1.5;">
                You're receiving this email because of activity on your
                ${BRAND.name} account. If this wasn't you, please
                <a href="${config.CLIENT_APP_URL}/help" style="color:${BRAND.muted};text-decoration:underline;">contact support</a>.
                <br /><br />
                © ${new Date().getFullYear()} ${BRAND.name}. All rights reserved.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

const kv = (label, value) => `
  <tr>
    <td style="padding:8px 0;color:${BRAND.muted};font-size:13px;width:40%;">${label}</td>
    <td style="padding:8px 0;color:${BRAND.primary};font-size:14px;font-weight:500;">${value}</td>
  </tr>
`;

const table = (rows) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${BRAND.border};margin-top:16px;">
    ${rows}
  </table>
`;

// ── AUTH ─────────────────────────────────────────────────────────────────────

export const emailVerification = ({ verifyUrl }) => ({
  subject: 'Verify your Sintherior account',
  html: wrap({
    preheader: 'Confirm your email to get started on Sintherior.',
    title: 'Welcome to Sintherior',
    body: `
      <p style="margin:0 0 12px 0;">Thanks for signing up. Please verify your email address to unlock your account.</p>
      <p style="margin:0 0 12px 0;color:${BRAND.muted};font-size:13px;">This link expires in 24 hours.</p>
    `,
    cta: { label: 'Verify email', url: verifyUrl },
  }),
});

export const passwordReset = ({ resetUrl }) => ({
  subject: 'Reset your Sintherior password',
  html: wrap({
    preheader: 'Reset your Sintherior password.',
    title: 'Password reset',
    body: `
      <p style="margin:0 0 12px 0;">You requested a password reset for your Sintherior account. Click the button below to set a new password.</p>
      <p style="margin:0 0 12px 0;color:${BRAND.muted};font-size:13px;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
    `,
    cta: { label: 'Reset password', url: resetUrl },
  }),
});

// ── ORDERS ───────────────────────────────────────────────────────────────────

export const orderPlacedClient = ({ order, buyerName }) => {
  const itemRows = order.items
    .map(
      (i) => `
      <tr>
        <td style="padding:8px 0;color:${BRAND.primary};font-size:14px;">${i.name} × ${i.quantity}</td>
        <td style="padding:8px 0;color:${BRAND.primary};font-size:14px;text-align:right;">${naira(i.priceAtOrder * i.quantity)}</td>
      </tr>`
    )
    .join('');
  return {
    subject: `Order #${shortId(order._id)} confirmed`,
    html: wrap({
      preheader: `Your order for ${naira(order.totalAmount)} has been received.`,
      title: 'Order confirmed',
      body: `
        <p style="margin:0 0 12px 0;">Hi ${buyerName || 'there'}, thanks for your order. We're processing it now and will notify you on every status change.</p>
        ${table(
          kv('Order ID', `#${shortId(order._id)}`) +
            kv('Total', `<strong>${naira(order.totalAmount)}</strong>`) +
            kv('Payment', order.paymentMethod || '—') +
            kv('Delivery', order.deliveryAddress || '—')
        )}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;border-top:1px solid ${BRAND.border};">
          ${itemRows}
        </table>
      `,
      cta: { label: 'View order', url: `${config.CLIENT_APP_URL}/dashboard/orders` },
    }),
  };
};

export const orderPlacedSupplier = ({ order, supplierItems, buyerName }) => {
  const subtotal = supplierItems.reduce((s, i) => s + i.priceAtOrder * i.quantity, 0);
  const itemRows = supplierItems
    .map(
      (i) => `
      <tr>
        <td style="padding:8px 0;color:${BRAND.primary};font-size:14px;">${i.name} × ${i.quantity}</td>
        <td style="padding:8px 0;color:${BRAND.primary};font-size:14px;text-align:right;">${naira(i.priceAtOrder * i.quantity)}</td>
      </tr>`
    )
    .join('');
  return {
    subject: `New order received — ${naira(subtotal)}`,
    html: wrap({
      preheader: `${buyerName} placed an order worth ${naira(subtotal)}.`,
      title: 'You have a new order',
      body: `
        <p style="margin:0 0 12px 0;"><strong>${buyerName || 'A client'}</strong> just placed an order containing your products. Confirm it in your dashboard to start fulfilment.</p>
        ${table(
          kv('Order ID', `#${shortId(order._id)}`) +
            kv('Your subtotal', `<strong>${naira(subtotal)}</strong>`) +
            kv('Delivery city', order.city || '—')
        )}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;border-top:1px solid ${BRAND.border};">
          ${itemRows}
        </table>
      `,
      cta: { label: 'Review order', url: `${config.CLIENT_APP_URL}/dashboard/orders` },
    }),
  };
};

export const orderStatusChanged = ({ order, status }) => {
  const label = {
    confirmed: 'Your order has been confirmed',
    shipped: 'Your order is on the way',
    delivered: 'Your order has been delivered',
    cancelled: 'Your order has been cancelled',
  }[status] || `Order ${status}`;

  return {
    subject: `Order #${shortId(order._id)} — ${status}`,
    html: wrap({
      preheader: `Order #${shortId(order._id)} is now ${status}.`,
      title: label,
      body: `
        ${table(
          kv('Order ID', `#${shortId(order._id)}`) +
            kv('Status', `<strong style="text-transform:capitalize;">${status}</strong>`) +
            kv('Total', naira(order.totalAmount))
        )}
      `,
      cta: { label: 'View order', url: `${config.CLIENT_APP_URL}/dashboard/orders` },
    }),
  };
};

// ── JOBS (hiring artisans) ───────────────────────────────────────────────────

export const jobCreatedArtisan = ({ job, clientName }) => ({
  subject: `New job request — ${job.title}`,
  html: wrap({
    preheader: `${clientName} wants to hire you for "${job.title}".`,
    title: 'You have a new job request',
    body: `
      <p style="margin:0 0 12px 0;"><strong>${clientName || 'A client'}</strong> sent you a new job request. Review the details and respond from your dashboard.</p>
      ${table(
        kv('Title', job.title) +
          kv('Budget', job.budget ? naira(job.budget) : 'Not specified') +
          kv('Location', job.location || '—') +
          kv('Start', formatDate(job.startDate))
      )}
      ${
        job.description
          ? `<p style="margin:16px 0 0 0;padding:12px 14px;background:${BRAND.bg};border-radius:8px;font-size:14px;color:${BRAND.primary};">${job.description}</p>`
          : ''
      }
    `,
    cta: { label: 'Respond to request', url: `${config.CLIENT_APP_URL}/dashboard/jobs` },
  }),
});

export const jobStatusChanged = ({ job, status, actorName }) => {
  const label = {
    accepted: 'Your job request was accepted',
    in_progress: 'Work has started on your job',
    completed: 'Your job has been marked complete',
    cancelled: 'Your job has been cancelled',
  }[status] || `Job ${status.replace('_', ' ')}`;

  return {
    subject: `Job "${job.title}" — ${status.replace('_', ' ')}`,
    html: wrap({
      preheader: `Job "${job.title}" is now ${status.replace('_', ' ')}.`,
      title: label,
      body: `
        <p style="margin:0 0 12px 0;">${actorName || 'The other party'} updated the status of this job.</p>
        ${table(
          kv('Title', job.title) +
            kv('Status', `<strong style="text-transform:capitalize;">${status.replace('_', ' ')}</strong>`) +
            (job.budget ? kv('Budget', naira(job.budget)) : '')
        )}
      `,
      cta: { label: 'View job', url: `${config.CLIENT_APP_URL}/dashboard/jobs` },
    }),
  };
};

// ── APPOINTMENTS ─────────────────────────────────────────────────────────────

export const appointmentBooked = ({ appointment, recipientRole, clientName, artisanName }) => {
  const other = recipientRole === 'artisan' ? clientName : artisanName;
  const intro =
    recipientRole === 'artisan'
      ? `${other || 'A client'} booked an appointment with you.`
      : `Your appointment with ${other || 'the artisan'} is confirmed.`;

  return {
    subject: `Appointment: ${appointment.title}`,
    html: wrap({
      preheader: intro,
      title: 'Appointment scheduled',
      body: `
        <p style="margin:0 0 12px 0;">${intro}</p>
        ${table(
          kv('Title', appointment.title) +
            kv('Date', formatDate(appointment.date)) +
            kv('Time', appointment.time || '—') +
            kv('Location', appointment.location || '—')
        )}
        ${
          appointment.description
            ? `<p style="margin:16px 0 0 0;padding:12px 14px;background:${BRAND.bg};border-radius:8px;font-size:14px;">${appointment.description}</p>`
            : ''
        }
      `,
      cta: { label: 'View appointments', url: `${config.CLIENT_APP_URL}/dashboard/appointments` },
    }),
  };
};

// ── PAYMENTS ─────────────────────────────────────────────────────────────────

export const paymentReceiptOrder = ({ order }) => ({
  subject: `Payment received — ${naira(order.totalAmount)}`,
  html: wrap({
    preheader: `We received your payment of ${naira(order.totalAmount)}.`,
    title: 'Payment successful',
    body: `
      <p style="margin:0 0 12px 0;">Thanks — your payment has been received and your order is now being processed.</p>
      ${table(
        kv('Order ID', `#${shortId(order._id)}`) +
          kv('Amount', `<strong>${naira(order.totalAmount)}</strong>`) +
          kv('Method', 'Card Payment')
      )}
    `,
    cta: { label: 'View order', url: `${config.CLIENT_APP_URL}/dashboard/orders` },
  }),
});

export const paymentReceiptJob = ({ job }) => ({
  subject: `Payment received for "${job.title}"`,
  html: wrap({
    preheader: `Your payment of ${naira(job.budget)} has been received.`,
    title: 'Payment successful',
    body: `
      <p style="margin:0 0 12px 0;">Your payment for this job has been received. The artisan has been notified and can now begin work.</p>
      ${table(
        kv('Job', job.title) +
          kv('Amount', `<strong>${naira(job.budget)}</strong>`) +
          kv('Method', 'Card Payment')
      )}
    `,
    cta: { label: 'View job', url: `${config.CLIENT_APP_URL}/dashboard/jobs` },
  }),
});

// ── REVIEWS ──────────────────────────────────────────────────────────────────

export const newReview = ({ review, reviewerName }) => {
  const stars = '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating);
  return {
    subject: `New ${review.rating}-star review from ${reviewerName || 'a client'}`,
    html: wrap({
      preheader: `${reviewerName || 'A client'} left you a ${review.rating}-star review.`,
      title: 'You received a new review',
      body: `
        <p style="margin:0 0 12px 0;"><strong>${reviewerName || 'A client'}</strong> just rated their experience working with you.</p>
        <p style="margin:12px 0;font-size:22px;letter-spacing:2px;color:#f59e0b;">${stars}</p>
        ${
          review.comment
            ? `<p style="margin:12px 0 0 0;padding:12px 14px;background:${BRAND.bg};border-radius:8px;font-size:14px;line-height:1.6;">“${review.comment}”</p>`
            : ''
        }
      `,
      cta: { label: 'View reviews', url: `${config.CLIENT_APP_URL}/dashboard/reviews` },
    }),
  };
};
