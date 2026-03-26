import jwt from 'jsonwebtoken';
import config from '../config/env.js';
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';

/**
 * protect — verifies the JWT access token from the Authorization header.
 * Attaches { id, role } to req.user on success.
 * Throws 401 for missing, invalid, or expired tokens.
 */
export const protect = asyncHandler(async (req, _res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AppError('Access token is required. Please log in.', 401);
  }

  const token = authHeader.split(' ')[1];

  if (!token) {
    throw new AppError('Access token is missing.', 401);
  }

  // jwt.verify throws JsonWebTokenError or TokenExpiredError — handled in errorHandler
  const decoded = jwt.verify(token, config.JWT_ACCESS_SECRET);

  // Attach minimal user info — controllers fetch full data if needed
  req.user = {
    id: decoded.id,
    role: decoded.role,
  };

  next();
});

/**
 * restrictTo — factory that returns middleware restricting access to specific roles.
 *
 * @param {...string} roles - Allowed roles (e.g., 'admin', 'supplier')
 * @returns {import('express').RequestHandler}
 *
 * Usage: router.delete('/:id', protect, restrictTo('admin', 'supplier'), handler)
 */
export const restrictTo = (...roles) =>
  asyncHandler(async (req, _res, next) => {
    if (!req.user) {
      throw new AppError('You must be logged in.', 401);
    }

    if (!roles.includes(req.user.role)) {
      throw new AppError(
        `Access denied. This action requires one of these roles: ${roles.join(', ')}.`,
        403
      );
    }

    next();
  });
