import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import cors from 'cors';
import mongoSanitize from 'express-mongo-sanitize';
import hpp from 'hpp';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';

import config from './config/env.js';
import { generalLimiter } from './middleware/rateLimiter.js';
import errorHandler from './middleware/errorHandler.js';
import AppError from './utils/AppError.js';

// ── Route imports ─────────────────────────────────────────────────────────────
import authRoutes from './routes/auth.routes.js';
import profileRoutes from './routes/profile.routes.js';
import artisanRoutes from './routes/artisan.routes.js';
import productRoutes from './routes/product.routes.js';
import propertyRoutes from './routes/property.routes.js';
import orderRoutes from './routes/order.routes.js';
import chatRoutes from './routes/chat.routes.js';
import notificationRoutes from './routes/notification.routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// ── 1. Security headers ───────────────────────────────────────────────────────
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow serving upload images cross-origin
  })
);

// ── 2. CORS ───────────────────────────────────────────────────────────────────
app.use(
  cors({
    origin: config.CLIENT_URL,
    credentials: true,              // allow cookies (refresh token)
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Handle preflight requests
app.options('*', cors());

// ── 3. Request parsing ────────────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());

// ── 4. Security — sanitize & parameter pollution ──────────────────────────────
// Strip MongoDB operators ($where, $gt, etc.) from req.body / req.params / req.query
app.use(mongoSanitize());

// Prevent HTTP parameter pollution (keeps the last duplicate query param)
app.use(hpp());

// ── 5. HTTP request logging ───────────────────────────────────────────────────
app.use(morgan(config.isProd ? 'combined' : 'dev'));

// ── 6. Response compression ───────────────────────────────────────────────────
app.use(compression());

// ── 7. General rate limiter on all API routes ─────────────────────────────────
app.use('/api', generalLimiter);

// ── 8. Static file serving for uploads ───────────────────────────────────────
// Files are served at /uploads/<filename>
app.use(
  '/uploads',
  express.static(path.resolve(__dirname, '../uploads'), {
    maxAge: '7d',
    etag: true,
  })
);

// ── 9. Health check ───────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    environment: config.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

// ── 10. API routes ────────────────────────────────────────────────────────────
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/profiles', profileRoutes);
app.use('/api/v1/artisans', artisanRoutes);
app.use('/api/v1/products', productRoutes);
app.use('/api/v1/properties', propertyRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/chat', chatRoutes);
app.use('/api/v1/notifications', notificationRoutes);

// ── 11. 404 — catch-all for unmatched routes ──────────────────────────────────
app.use((req, _res, next) => {
  next(new AppError(`Route ${req.method} ${req.originalUrl} not found.`, 404));
});

// ── 12. Global error handler (must be last, must have 4 args) ─────────────────
app.use(errorHandler);

export default app;
