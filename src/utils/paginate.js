/**
 * Parse pagination parameters from an Express query object.
 *
 * @param {Object} query - req.query
 * @returns {{ page: number, limit: number, skip: number }}
 */
export const getPagination = (query) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

/**
 * Build pagination metadata to include in the API response.
 *
 * @param {number} total  - Total number of matching documents
 * @param {number} page   - Current page number
 * @param {number} limit  - Items per page
 * @returns {{ total: number, page: number, limit: number, pages: number, hasNext: boolean, hasPrev: boolean }}
 */
export const buildPaginationMeta = (total, page, limit) => {
  const pages = Math.ceil(total / limit) || 1;
  return {
    total,
    page,
    limit,
    pages,
    hasNext: page < pages,
    hasPrev: page > 1,
  };
};
