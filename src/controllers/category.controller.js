import Category from '../models/Category.js';
import Product from '../models/Product.js';
import AppError from '../utils/AppError.js';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { invalidateCatalogue } from '../services/catalogue.service.js';

// ── GET /api/v1/categories ───────────────────────────────────────────────────
/**
 * The shelves, in the order an admin put them.
 *
 * Public and unauthenticated: it is the shop's own furniture, and the app needs
 * it before anybody signs in. Inactive shelves are omitted unless an admin asks
 * for them, since the whole point of inactive is that shoppers do not see it.
 */
export const listCategories = asyncHandler(async (req, res) => {
  const all = req.query.all === 'true' && req.user?.role === 'admin';
  const filter = all ? {} : { isActive: true };

  const categories = await Category.find(filter).sort({ order: 1, name: 1 }).lean();

  sendSuccess(res, { categories }, 'Categories retrieved.');
});

// ── POST /api/v1/categories ──────────────────────────────────────────────────
export const createCategory = asyncHandler(async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) throw new AppError('A category needs a name.', 400);

  const clash = await Category.findOne({ name: new RegExp(`^${name}$`, 'i') });
  if (clash) throw new AppError(`"${name}" already exists.`, 409);

  // Placed last by default, so a new shelf never silently displaces one that
  // has been earning its position.
  const last = await Category.findOne().sort({ order: -1 }).select('order').lean();

  const category = await Category.create({
    name,
    image: req.body?.image || null,
    subcategories: normaliseSubs(req.body?.subcategories),
    order: req.body?.order ?? (last?.order ?? 0) + 1,
  });

  invalidateCatalogue();
  sendSuccess(res, { category }, 'Category created.', 201);
});

// ── PATCH /api/v1/categories/:id ─────────────────────────────────────────────
export const updateCategory = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) throw new AppError('Category not found.', 404);

  const nextName = req.body?.name !== undefined ? String(req.body.name).trim() : null;

  /*
   * Renaming has to carry the listings with it.
   *
   * Products store their category as a string rather than a reference, so a
   * rename without this leaves every listing filed under a shelf that no longer
   * exists — they vanish from the shop while still being perfectly saleable,
   * and nothing anywhere reports an error.
   */
  if (nextName && nextName !== category.name) {
    const clash = await Category.findOne({
      _id: { $ne: category._id },
      name: new RegExp(`^${nextName}$`, 'i'),
    });
    if (clash) throw new AppError(`"${nextName}" already exists.`, 409);

    await Product.updateMany({ category: category.name }, { $set: { category: nextName } });
    category.name = nextName;
  }

  if (req.body?.image !== undefined) category.image = req.body.image || null;
  if (req.body?.order !== undefined) category.order = Number(req.body.order) || 0;
  if (req.body?.isActive !== undefined) category.isActive = !!req.body.isActive;

  if (req.body?.subcategories !== undefined) {
    const next = normaliseSubs(req.body.subcategories);

    /*
     * A removed subcategory leaves its products unfiled rather than lost.
     *
     * Clearing the field is deliberate: the alternative is a listing pointing at
     * a second level that is no longer offered, which the filter rail can never
     * match and the buyer can never reach.
     */
    const kept = new Set(next.map((sub) => sub.name));
    const gone = category.subcategories
      .map((sub) => sub.name)
      .filter((name) => !kept.has(name));

    if (gone.length) {
      await Product.updateMany(
        { category: category.name, subcategory: { $in: gone } },
        { $unset: { subcategory: '' } }
      );
    }
    category.subcategories = next;
  }

  await category.save();
  invalidateCatalogue();
  sendSuccess(res, { category }, 'Category updated.');
});

// ── DELETE /api/v1/categories/:id ────────────────────────────────────────────
/**
 * Hidden, not removed.
 *
 * Deleting the row would orphan every product filed under the name. Refusing
 * outright would leave an admin unable to retire a shelf they no longer stock.
 * Hiding does both jobs, and says how many listings went with it.
 */
export const deactivateCategory = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) throw new AppError('Category not found.', 404);

  const affected = await Product.countDocuments({ category: category.name, isActive: true });

  category.isActive = false;
  await category.save();
  invalidateCatalogue();

  sendSuccess(
    res,
    { category, affected },
    affected
      ? `Category hidden. ${affected} listing${affected === 1 ? '' : 's'} are no longer browsable under it.`
      : 'Category hidden.'
  );
});

/** Trimmed, deduped, and never empty strings. */
function normaliseSubs(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of raw) {
    const name = String(typeof entry === 'string' ? entry : entry?.name ?? '').trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ name, isActive: entry?.isActive !== false });
  }
  return out;
}
