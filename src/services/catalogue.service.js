import Category from '../models/Category.js';
import { SUBCATEGORIES, isValidSubcategory as isValidStatic } from '../config/catalogue.js';

/**
 * The category list, cached, for the paths that only need to ask a question of it.
 *
 * Validating a subcategory on every product write is a database round trip for a
 * list of fifteen strings that changes a few times a year. Cached for a minute:
 * long enough that a bulk import does not hammer it, short enough that an admin
 * who adds a shelf and immediately files something under it is not told their own
 * subcategory does not exist.
 */
const TTL_MS = 60_000;

let cache = null;
let cachedAt = 0;

/** Forget the cache — called by the controller whenever a category changes. */
export function invalidateCatalogue() {
  cache = null;
  cachedAt = 0;
}

async function load() {
  const fresh = cache && Date.now() - cachedAt < TTL_MS;
  if (fresh) return cache;

  // Sorted here rather than at the call site, because the insertion order of the
  // object below is what categoryNames() hands back as the rail's order.
  const rows = await Category.find({ isActive: true })
    .select('name subcategories order')
    .sort({ order: 1, name: 1 })
    .lean();

  /*
   * An empty collection falls back to the hardcoded list.
   *
   * This matters on a database that has not been seeded yet — including the test
   * databases and any local checkout — where an empty result would otherwise mean
   * "no subcategory is ever valid", quietly stripping the field from every
   * product written until somebody noticed.
   */
  if (!rows.length) {
    cache = SUBCATEGORIES;
  } else {
    cache = Object.fromEntries(
      rows.map((row) => [
        row.name,
        (row.subcategories ?? []).filter((sub) => sub.isActive !== false).map((sub) => sub.name),
      ])
    );
  }

  cachedAt = Date.now();
  return cache;
}

/** Whether a subcategory belongs to the category it was filed under. */
export async function isValidSubcategory(category, subcategory) {
  if (!subcategory) return true;
  try {
    const map = await load();
    const list = map[category];
    return Array.isArray(list) && list.includes(subcategory);
  } catch {
    // A catalogue read failing should not take a product write down with it.
    return isValidStatic(category, subcategory);
  }
}

/**
 * Whether a category is one the shop actually offers.
 *
 * Used as the Product schema's validator. It replaced a hardcoded enum, which
 * meant a category an admin created could never have anything filed under it —
 * every save failed with "not a valid category" naming a category that visibly
 * existed. Cached, so this costs nothing on the common path.
 */
export async function isValidCategory(name) {
  if (!name) return false;
  try {
    const map = await load();
    return Object.hasOwn(map, name);
  } catch {
    // A catalogue read failing must not reject an otherwise valid product;
    // the static list is the same fifteen names the enum used to hold.
    return Object.hasOwn(SUBCATEGORIES, name);
  }
}

/** The active category names, in the order an admin arranged them. */
export async function categoryNames() {
  const map = await load();
  return Object.keys(map);
}
