import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { anyStock, isPreorder } from './pricing.js';

/**
 * Stock on a listing with variants lives per SKU; the product-level count is a
 * summary of it. Reading the summary instead of the rows is how a listing whose
 * every variant is in stock gets marked sold out — and how a client that never
 * rendered the variant table overwrites the sum with its single quantity box.
 */
describe('anyStock', () => {
  test('a plain product goes by its own count', () => {
    assert.equal(anyStock({ quantity: 4 }), true);
    assert.equal(anyStock({ quantity: 0 }), false);
  });

  test('a listing with variants goes by the rows, not the summary', () => {
    // The product row says zero and every variant has stock. Trusting the
    // summary here takes a sellable listing off the shop.
    assert.equal(anyStock({ quantity: 0, skus: [{ quantity: 5 }, { quantity: 2 }] }), true);
  });

  test('sold out only when every variant is', () => {
    assert.equal(anyStock({ quantity: 99, skus: [{ quantity: 0 }, { quantity: 0 }] }), false);
  });

  test('one variant left keeps the listing alive', () => {
    // A sold-out colour must not hide the ones still on the shelf.
    assert.equal(anyStock({ quantity: 0, skus: [{ quantity: 0 }, { quantity: 1 }] }), true);
  });

  test('a pre-order is in stock whatever the counts say', () => {
    // It exists to be ordered before it exists. Deriving stock from a count
    // nobody keeps would switch off the only listing type that cannot have one.
    assert.equal(isPreorder({ fulfilment: 'preorder' }), true);
    assert.equal(anyStock({ fulfilment: 'preorder', quantity: 0, skus: [{ quantity: 0 }] }), true);
  });

  test('missing counts are not stock', () => {
    assert.equal(anyStock({}), false);
    assert.equal(anyStock({ skus: [] }), false);
    assert.equal(anyStock({ skus: [{}] }), false);
  });
});

/** The summary the shop grid and the supplier's list both read. */
describe('variant total', () => {
  const total = (skus) => skus.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);

  test('is the sum of the rows', () => {
    assert.equal(total([{ quantity: 5 }, { quantity: 2 }, { quantity: 0 }]), 7);
  });

  test('survives a row with no count at all', () => {
    assert.equal(total([{ quantity: 3 }, {}]), 3);
  });
});
