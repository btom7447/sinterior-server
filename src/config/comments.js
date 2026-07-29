/**
 * Comment rules that are worth stating once and testing.
 *
 * Mentions are the abuse surface in a comment system: the client says who to
 * notify, and a client can say anything. Everything here exists to make one
 * comment cost at most a bounded, sane number of notifications.
 */

/** Nobody should be able to buzz the whole directory from a single sentence. */
export const MAX_MENTIONS = 10;

/**
 * Clean a client-supplied mention list before it becomes notifications.
 *
 * Deduped so naming someone twice does not notify them twice, filtered so a
 * malformed id cannot reach the database layer, and capped last — the cap has
 * to come after the dedupe or ten copies of one id would fill it and squeeze
 * out the nine real people in the comment.
 *
 * @param raw          whatever arrived in the request body
 * @param isValidId    id-shape check, injected so this stays free of mongoose
 */
export function normaliseMentionIds(raw, isValidId) {
  if (!Array.isArray(raw)) return [];

  return [...new Set(raw.filter((id) => typeof id === 'string' || typeof id === 'number').map(String))]
    .filter((id) => isValidId(id))
    .slice(0, MAX_MENTIONS);
}
