import { resolveUploads } from './resolveUrl.js';

/**
 * Send a successful JSON response.
 *
 * @param {import('express').Response} res
 * @param {*}      data        - Payload to return
 * @param {string} message     - Human-readable success message
 * @param {number} statusCode  - HTTP status code (default 200)
 */
export const sendSuccess = (res, data, message = 'Success', statusCode = 200) => {
  res.status(statusCode).json({
    status: 'success',
    message,
    data: resolveUploads(data),
  });
};

/**
 * Send a paginated JSON response.
 *
 * @param {import('express').Response} res
 * @param {Array}  data        - Array of result items
 * @param {Object} pagination  - Pagination meta produced by buildPaginationMeta()
 * @param {string} message     - Human-readable success message
 */
export const sendPaginated = (res, data, pagination, message = 'Success') => {
  res.status(200).json({
    status: 'success',
    message,
    pagination,
    data: resolveUploads(data),
  });
};
