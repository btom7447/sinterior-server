import AppError from '../utils/AppError.js';

// ── Specific error transformers ───────────────────────────────────────────────

/** Mongoose invalid ObjectId */
const handleCastError = (err) =>
  new AppError(`Invalid value for field '${err.path}': ${err.value}`, 400);

/** Mongoose schema validation failures */
const handleValidationError = (err) => {
  const messages = Object.values(err.errors).map((e) => e.message);
  return new AppError(`Validation error: ${messages.join('. ')}`, 400);
};

/** MongoDB duplicate key (unique index violation) */
const handleDuplicateKey = (err) => {
  const field = Object.keys(err.keyValue || {})[0] || 'field';
  const value = err.keyValue ? err.keyValue[field] : '';
  return new AppError(
    `Duplicate value for '${field}'${value ? `: "${value}"` : ''}. Please use a different value.`,
    409
  );
};

/** JWT signature mismatch or malformed token */
const handleJWTError = () => new AppError('Invalid token. Please log in again.', 401);

/** JWT expired */
const handleJWTExpired = () =>
  new AppError('Token expired. Please log in again.', 401);

// ── Response helpers ──────────────────────────────────────────────────────────

const sendDevError = (err, res) => {
  res.status(err.statusCode || 500).json({
    status: err.status || 'error',
    message: err.message,
    stack: err.stack,
    error: err,
  });
};

const sendProdError = (err, res) => {
  if (err.isOperational) {
    // Trusted, operational error — safe to expose details
    res.status(err.statusCode).json({
      status: err.status,
      message: err.message,
    });
  } else {
    // Programming or unknown error — don't leak internals
    console.error('[ERROR] Unexpected:', err);
    res.status(500).json({
      status: 'error',
      message: 'Something went wrong. Please try again later.',
    });
  }
};

// ── Global error handler ──────────────────────────────────────────────────────

/**
 * Express global error handler (must have 4 parameters).
 * Register this LAST in app.js after all routes.
 */
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  // For known Mongoose/JWT errors, transform into an AppError.
  // For everything else (AppError, unknown), pass err through — Object.assign
  // would silently drop .message since Error.message is non-enumerable.
  let error = err;

  if (err.name === 'CastError') error = handleCastError(err);
  else if (err.name === 'ValidationError') error = handleValidationError(err);
  else if (err.code === 11000) error = handleDuplicateKey(err);
  else if (err.name === 'JsonWebTokenError') error = handleJWTError();
  else if (err.name === 'TokenExpiredError') error = handleJWTExpired();

  if (process.env.NODE_ENV === 'development') {
    sendDevError(error, res);
    return;
  }

  sendProdError(error, res);
};

export default errorHandler;
