/**
 * Custom operational error class.
 * Operational errors are expected errors we can handle gracefully
 * (e.g., invalid input, not found, unauthorised).
 * Programming errors should be allowed to crash the process.
 */
class AppError extends Error {
  /**
   * @param {string} message  - Human-readable error message sent to the client
   * @param {number} statusCode - HTTP status code (4xx or 5xx)
   */
  constructor(message, statusCode) {
    super(message);

    this.statusCode = statusCode;
    // 'fail' for client errors (4xx), 'error' for server errors (5xx)
    this.status = String(statusCode).startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;

    // Capture stack trace, excluding the constructor call from the trace
    Error.captureStackTrace(this, this.constructor);
  }
}

export default AppError;
