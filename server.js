/**
 * server.js — Entry point
 *
 * Responsibilities:
 *  1. Import config (validates env vars — throws early if invalid)
 *  2. Connect to MongoDB
 *  3. Create the HTTP server and start listening
 *  4. Handle graceful shutdown on SIGTERM / SIGINT
 */

import http from 'http';
import mongoose from 'mongoose';

// Config must be imported first so env validation runs before anything else
import config from './src/config/env.js';
import connectDB from './src/config/db.js';
import app from './src/app.js';

// ── Uncaught exception guard ──────────────────────────────────────────────────
// Must be registered BEFORE any async code runs
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception — shutting down:', err.message);
  console.error(err.stack);
  process.exit(1);
});

// ── Create HTTP server ────────────────────────────────────────────────────────
const server = http.createServer(app);

// ── Graceful shutdown ─────────────────────────────────────────────────────────
const shutdown = async (signal) => {
  console.log(`\n[Server] ${signal} received — starting graceful shutdown…`);

  // Stop accepting new connections
  server.close(async (err) => {
    if (err) {
      console.error('[Server] Error while closing HTTP server:', err.message);
      process.exit(1);
    }

    console.log('[Server] HTTP server closed.');

    try {
      await mongoose.connection.close();
      console.log('[MongoDB] Connection closed.');
      process.exit(0);
    } catch (mongoErr) {
      console.error('[MongoDB] Error closing connection:', mongoErr.message);
      process.exit(1);
    }
  });

  // Force-kill if graceful shutdown takes longer than 15 seconds
  setTimeout(() => {
    console.error('[Server] Graceful shutdown timed out — force exiting.');
    process.exit(1);
  }, 15_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ── Unhandled promise rejection guard ────────────────────────────────────────
process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection at:', promise, '— reason:', reason);
  // Give the server a chance to finish in-flight requests before exiting
  shutdown('unhandledRejection');
});

// ── Boot sequence ─────────────────────────────────────────────────────────────
const boot = async () => {
  await connectDB();

  server.listen(config.PORT, () => {
    console.log(
      `[Server] Sinterior API running in ${config.NODE_ENV} mode on port ${config.PORT}`
    );
    console.log(`[Server] Health check → http://localhost:${config.PORT}/health`);
  });
};

boot();
