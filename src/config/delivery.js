/**
 * Who has been signed off for delivery, and by whom.
 *
 * An order can span two suppliers. Before this existed, confirmation was a
 * single boolean on the order: the first supplier to mark their half delivered
 * flipped it, and the escrow release then paid out every held entry on the
 * order — including the supplier who had shipped nothing. The buyer's
 * protection on that half was gone and nobody was told.
 *
 * Pure and in config for the same reason line pricing is: it decides who gets
 * paid, and a rule about somebody's money should be testable without a database
 * or an HTTP request.
 */

/** Compare two ids that may be ObjectIds, populated docs, or strings. */
const idOf = (ref) => {
  if (!ref) return null;
  if (typeof ref === 'string') return ref;
  if (ref._id) return String(ref._id);
  return String(ref);
};

const includes = (list, id) => (list ?? []).some((entry) => idOf(entry) === idOf(id));

/** Every distinct supplier with a line on this order. */
export function suppliersOn(items) {
  const seen = new Set();
  const out = [];
  for (const item of items ?? []) {
    const id = idOf(item?.supplierId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * The suppliers both sides have confirmed.
 *
 * These, and only these, are the ones whose escrow may be released. A supplier
 * who says they delivered is not enough — the buyer has to have received it —
 * and a buyer confirming receipt of one supplier's goods says nothing about
 * another's.
 */
export function settledSuppliers({ items, supplierApprovals, buyerApprovals }) {
  return suppliersOn(items).filter(
    (id) => includes(supplierApprovals, id) && includes(buyerApprovals, id)
  );
}

/**
 * Whether the whole order is accounted for.
 *
 * Drives the order-level `delivered` status and the two summary flags every
 * client already reads. On a single-supplier order — most of them — this is
 * exactly the behaviour the booleans always had.
 */
export function fullyDelivered({ items, supplierApprovals, buyerApprovals }) {
  const suppliers = suppliersOn(items);
  if (!suppliers.length) return false;
  return settledSuppliers({ items, supplierApprovals, buyerApprovals }).length === suppliers.length;
}
