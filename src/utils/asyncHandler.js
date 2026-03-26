/**
 * Wraps an async Express route handler so that any rejected promise
 * is forwarded to Express's next() error handler automatically.
 *
 * Usage:
 *   router.get('/route', asyncHandler(async (req, res, next) => { ... }))
 *
 * @param {Function} fn - Async route handler (req, res, next) => Promise
 * @returns {Function} Express middleware
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export default asyncHandler;
