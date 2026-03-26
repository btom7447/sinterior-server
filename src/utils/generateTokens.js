import jwt from 'jsonwebtoken';
import config from '../config/env.js';

// Refresh token cookie lifetime in milliseconds (7 days)
const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Generate a short-lived JWT access token.
 *
 * @param {{ id: string, role: string }} payload
 * @returns {string} Signed JWT
 */
export const generateAccessToken = (payload) => {
  return jwt.sign(payload, config.JWT_ACCESS_SECRET, {
    expiresIn: config.JWT_ACCESS_EXPIRES_IN,
  });
};

/**
 * Generate a long-lived JWT refresh token.
 *
 * @param {{ id: string, role: string }} payload
 * @returns {string} Signed JWT
 */
export const generateRefreshToken = (payload) => {
  return jwt.sign(payload, config.JWT_REFRESH_SECRET, {
    expiresIn: config.JWT_REFRESH_EXPIRES_IN,
  });
};

/**
 * Attach the refresh token as a secure, httpOnly cookie on the response.
 *
 * @param {import('express').Response} res
 * @param {string} token - Signed refresh JWT
 */
export const setRefreshCookie = (res, token) => {
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: config.isProd,       // HTTPS only in production
    sameSite: 'strict',
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
    path: '/',
  });
};

/**
 * Clear the refresh token cookie from the response.
 *
 * @param {import('express').Response} res
 */
export const clearRefreshCookie = (res) => {
  res.clearCookie('refreshToken', {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'strict',
    path: '/',
  });
};
