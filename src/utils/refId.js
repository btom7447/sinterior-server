/**
 * The id behind a reference, whether or not it has been populated.
 *
 * A Mongoose ref is an ObjectId until someone adds a .populate() upstream, at
 * which point it becomes a document — and `doc.toString()` returns the
 * document, not its id. So `item.supplierId.toString() === profileId` silently
 * stops matching, and the failure lands wherever that comparison was doing
 * work: authorisation refusing a supplier their own order, or an escrow split
 * grouping every line under one key.
 *
 * Two of the call sites route money. Reading through this means adding a
 * populate somewhere cannot quietly change who gets paid.
 */
export function refId(ref) {
  if (!ref) return null;
  return (ref._id ?? ref).toString();
}

/** Whether a ref points at the given id. */
export function isSameRef(ref, id) {
  const left = refId(ref);
  return !!left && left === refId(id);
}
