/**
 * pinSync.service.js — keeps derived pins in lockstep with their sources.
 *
 * One pin per Product/Property (its first image) — fanning out every gallery
 * image would flood the feed with near-duplicates; the pin links back to the
 * full listing. Upserts are idempotent via the (sourceType, sourceRef,
 * sourceIndex) unique index, so these functions double as the backfill
 * primitives and can be re-run at any time.
 *
 * Callers must treat sync as best-effort: failures are logged, never thrown,
 * so a pin problem can never fail a product/property mutation.
 */
import Pin from '../models/Pin.js';
import { bandForAmount } from '../config/taxonomy.js';

// Product.category → pin trade id. Ambiguous categories map to null on purpose.
const PRODUCT_CATEGORY_TRADE = {
  'Lightings & Electrical': 'electrical',
  Panels: 'acp',
  Wallpaper: 'wall-decoration',
  Walls: 'wall-decoration',
  Cement: 'masonry',
  'Steel & Iron': 'metalwork',
  'Tiles & Flooring': 'flooring',
  Paints: 'painting',
  'Roofing & Ceiling': 'roofing',
  'Smart Home': 'electrical',
  Furniture: 'carpentry',
  Plumbing: 'plumbing',
  Aggregates: 'masonry',
  'Wood & Timber': 'carpentry',
};

// Prices are stored in whole naira (see payment.controller.js) — bands want kobo.
const nairaToBand = (naira) => (typeof naira === 'number' ? bandForAmount(Math.round(naira * 100)) : null);

export async function syncProductPin(product) {
  try {
    const image = product.images?.[0];
    if (!image) {
      await removePinsForSource('product', product._id);
      return;
    }
    await Pin.findOneAndUpdate(
      { sourceType: 'product', sourceRef: product._id, sourceIndex: 0 },
      {
        $set: {
          author: product.supplierId,
          mediaType: 'image',
          mediaUrl: image,
          title: product.name,
          caption: product.description?.slice(0, 1000) || '',
          'taxonomy.trade': PRODUCT_CATEGORY_TRADE[product.category] || null,
          'taxonomy.budgetBand': nairaToBand(product.price),
          // Out-of-stock listings shouldn't surface as buyable inspiration.
          status: product.inStock ? 'active' : 'hidden',
        },
      },
      { upsert: true, setDefaultsOnInsert: true }
    );
  } catch (err) {
    console.error(`[PinSync] product ${product?._id}: ${err.message}`);
  }
}

export async function syncPropertyPin(property) {
  try {
    const image = property.images?.[0];
    if (!image) {
      await removePinsForSource('property', property._id);
      return;
    }
    await Pin.findOneAndUpdate(
      { sourceType: 'property', sourceRef: property._id, sourceIndex: 0 },
      {
        $set: {
          author: property.supplierId,
          mediaType: 'image',
          mediaUrl: image,
          title: property.title,
          caption: property.description?.slice(0, 1000) || '',
          'taxonomy.room': 'whole-home',
          'taxonomy.budgetBand': nairaToBand(property.price),
          status: 'active',
        },
      },
      { upsert: true, setDefaultsOnInsert: true }
    );
  } catch (err) {
    console.error(`[PinSync] property ${property?._id}: ${err.message}`);
  }
}

/** Soft-remove all derived pins for a deleted source. */
export async function removePinsForSource(sourceType, sourceRef) {
  try {
    await Pin.updateMany({ sourceType, sourceRef }, { $set: { status: 'removed' } });
  } catch (err) {
    console.error(`[PinSync] remove ${sourceType} ${sourceRef}: ${err.message}`);
  }
}

export default { syncProductPin, syncPropertyPin, removePinsForSource };
