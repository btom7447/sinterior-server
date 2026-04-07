import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../');

// Load env file based on environment:
//  - Production (Render/cloud): vars are injected directly — no file needed
//  - Development: .env.local takes precedence over .env
// dotenv silently ignores missing files, so this is always safe.
dotenv.config({ path: path.join(root, '.env.local') });
dotenv.config({ path: path.join(root, '.env') });

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';

// ── Required variables ───────────────────────────────────────────────────────
const REQUIRED = ['MONGO_URI', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];

const missing = REQUIRED.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(
    `\n[FATAL] Missing required environment variables: ${missing.join(', ')}\n` +
    `  → In development: add them to .env.local\n` +
    `  → In production (Render): add them in Dashboard → Environment\n`
  );
  process.exit(1);
}

// ── Parsed & validated config ────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '5000', 10);

const config = Object.freeze({
  NODE_ENV,
  isProd,
  PORT,
  // CORS allow-list. May be a single URL or a comma-separated list — do NOT
  // use this value to build links (e.g. email redirects); use CLIENT_APP_URL.
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:3000',

  // Canonical public URL of the frontend. Single value, used for email links
  // and external redirects so they always point at one domain regardless of
  // how many origins CORS accepts.
  CLIENT_APP_URL:
    process.env.CLIENT_APP_URL ||
    (process.env.NODE_ENV === 'production'
      ? 'https://www.sintherior.com'
      : (process.env.CLIENT_URL || 'http://localhost:3000').split(',')[0].trim()),

  SERVER_URL: process.env.SERVER_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`,

  MONGO_URI: process.env.MONGO_URI,

  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
  JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '7d',

  UPLOAD_DIR: process.env.UPLOAD_DIR || 'uploads',
  MAX_FILE_SIZE_MB: parseInt(process.env.MAX_FILE_SIZE_MB || '5', 10),

  RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),   // 15 min
  RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX || '500', 10),                 // 500 req / 15 min
  AUTH_RATE_LIMIT_MAX: parseInt(process.env.AUTH_RATE_LIMIT_MAX || (isProd ? '30' : '100'), 10), // auth: 30 prod, 100 dev

  RESEND_API_KEY: process.env.RESEND_API_KEY || '',
  EMAIL_FROM: process.env.EMAIL_FROM || 'Sintherior <noreply@sintherior.com>',

  PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY || '',
  PAYSTACK_PUBLIC_KEY: process.env.PAYSTACK_PUBLIC_KEY || '',
});

export default config;
