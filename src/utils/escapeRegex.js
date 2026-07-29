/**
 * Make user text safe to put inside a RegExp.
 *
 * Search boxes feed straight into regexes here, and unescaped input is two bugs
 * at once: `.*` turns a name lookup into a full collection scan, and a nested
 * quantifier like `(a+)+b` can hang the event loop from a text field. Both are
 * reachable by anyone with a keyboard.
 */
export default function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
