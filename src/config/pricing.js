/**
 * What a line of an order actually costs.
 *
 * Three things can decide the price of one product now: the base price, the
 * variant somebody chose, and how many they are buying. This module is the only
 * place that resolves them, and it is pure so the arithmetic can be tested
 * without a database — everything downstream (escrow splits, supplier payouts,
 * the buyer's card) is derived from what it returns.
 *
 * Two rules run through all of it. Absolute prices, never deltas: a "+₦500 for
 * the large one" compounds badly against a tier discount and nobody can predict
 * the result. And the cheapest applicable price wins, because a buyer who
 * qualifies for a bulk rate and is charged the single-unit rate has been
 * overcharged, which is worse than any rounding question.
 */

/**
 * A number, or null.
 *
 * Number() is too forgiving to price from: Number(null) is 0, Number('') is 0,
 * Number(true) is 1, Number([]) is 0. Every one of those would be accepted by a
 * plain isFinite check and would set a price nobody typed — a null tier price
 * silently becoming zero gives the goods away.
 */
function num(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean' || Array.isArray(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * The canonical key for a chosen combination of options.
 *
 * Sorted by option name so { Size, Finish } and { Finish, Size } are the same
 * SKU. Without that, two identical orders could decrement two different stock
 * rows and one of them would drift negative.
 */
export function skuKeyFor(options) {
  if (!options) return '';
  const entries = options instanceof Map ? [...options.entries()] : Object.entries(options);
  return entries
    .filter(([name, value]) => name && value)
    .map(([name, value]) => [String(name).trim(), String(value).trim()])
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, value]) => `${name}:${value}`)
    .join('|');
}

/**
 * Find the SKU a buyer selected.
 *
 * Returns null when the product has no SKUs, which is the ordinary case — most
 * listings are one undifferentiated thing and must keep working untouched.
 */
export function findSku(product, options) {
  const skus = product?.skus ?? [];
  if (!skus.length) return null;

  const key = skuKeyFor(options);
  if (!key) return null;

  return skus.find((s) => s.key === key) ?? null;
}

/**
 * The unit price for a quantity, given the tiers.
 *
 * Tiers are "this price from this quantity upward". The best applicable one
 * wins rather than the last one listed, so a supplier who enters them out of
 * order still charges what they meant. A tier above the base price is ignored:
 * bulk that costs more per unit is a mistake, and honouring it would punish
 * somebody for buying more.
 */
export function tieredPrice(basePrice, tiers, quantity) {
  const base = num(basePrice);
  if (base === null || base < 0) return 0;

  const qty = num(quantity);
  if (qty === null || qty < 1) return base;

  let best = base;
  for (const tier of tiers ?? []) {
    const minQty = num(tier?.minQty);
    const price = num(tier?.price);
    if (minQty === null || price === null) continue;
    if (minQty < 1 || price < 0) continue;
    if (qty >= minQty && price < best) best = price;
  }
  return best;
}

/**
 * Everything an order line needs: what it costs, what stock it draws from, and
 * what to record about the choice.
 *
 * `stockPath` tells the caller which counter to decrement — the SKU's own, or
 * the product's. Getting that wrong oversells one and strands the other.
 */
export function priceLine({ product, quantity, options }) {
  const sku = findSku(product, options);

  // A variant's price stands on its own. Tiers still apply to it: buying forty
  // of the large size is still buying forty.
  const variantPrice = sku ? num(sku.price) : null;
  const basePrice = variantPrice ?? product?.price;
  const unitPrice = tieredPrice(basePrice, product?.priceTiers, quantity);

  const available = num(sku ? sku.quantity : product?.quantity);

  return {
    unitPrice,
    /** Null when the listing has no variants, which is most of them. */
    skuKey: sku ? sku.key : null,
    selectedOptions: sku ? sku.options : undefined,
    available: available ?? undefined,
    stockPath: sku ? 'sku' : 'product',
    /** The supplier's own code for this exact thing, when they set one. */
    sku: sku?.sku ?? product?.sku ?? null,
  };
}

/**
 * Whether a product can be bought at all right now.
 *
 * A listing with variants is out of stock only when every variant is — one
 * sold-out colour must not hide the other four.
 */
export function anyStock(product) {
  const skus = product?.skus ?? [];
  if (skus.length) return skus.some((s) => Number(s.quantity) > 0);
  return Number(product?.quantity) > 0;
}
