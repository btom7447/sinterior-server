import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { anyStock, findSku, priceLine, skuKeyFor, tieredPrice } from './pricing.js';

const tiles = {
  price: 8900,
  quantity: 700,
  priceTiers: [
    { minQty: 50, price: 8400 },
    { minQty: 200, price: 7900 },
  ],
  skus: [
    { key: 'Finish:Matt|Size:600x600', options: { Size: '600x600', Finish: 'Matt' }, price: 8900, quantity: 400 },
    { key: 'Finish:Gloss|Size:600x600', options: { Size: '600x600', Finish: 'Gloss' }, price: 9400, quantity: 0 },
    { key: 'Finish:Matt|Size:300x600', options: { Size: '300x600', Finish: 'Matt' }, price: 5600, quantity: 300 },
  ],
};

const cement = { price: 9800, quantity: 480 };

describe('skuKeyFor', () => {
  test('is stable regardless of the order options arrive in', () => {
    // Without sorting, two identical orders decrement two different stock rows
    // and one of them drifts negative.
    assert.equal(
      skuKeyFor({ Size: '600x600', Finish: 'Matt' }),
      skuKeyFor({ Finish: 'Matt', Size: '600x600' })
    );
  });

  test('trims what people typed', () => {
    assert.equal(skuKeyFor({ ' Size ': ' 600x600 ' }), 'Size:600x600');
  });

  test('accepts a Map, which is what Mongoose hands back', () => {
    assert.equal(skuKeyFor(new Map([['Size', '600x600']])), 'Size:600x600');
  });

  test('ignores half-filled pairs rather than keying on them', () => {
    assert.equal(skuKeyFor({ Size: '', Finish: 'Matt' }), 'Finish:Matt');
  });

  test('nothing selected is an empty key, not a crash', () => {
    assert.equal(skuKeyFor(null), '');
    assert.equal(skuKeyFor({}), '');
  });
});

describe('findSku', () => {
  test('finds the chosen combination', () => {
    const sku = findSku(tiles, { Size: '600x600', Finish: 'Matt' });
    assert.equal(sku.quantity, 400);
  });

  test('returns null for a product with no variants', () => {
    // The ordinary case. Most listings are one undifferentiated thing.
    assert.equal(findSku(cement, { Size: 'big' }), null);
  });

  test('returns null when the combination does not exist', () => {
    assert.equal(findSku(tiles, { Size: '900x900', Finish: 'Matt' }), null);
  });
});

describe('tieredPrice', () => {
  test('charges the base price below every tier', () => {
    assert.equal(tieredPrice(8900, tiles.priceTiers, 10), 8900);
  });

  test('applies a tier once its quantity is reached', () => {
    assert.equal(tieredPrice(8900, tiles.priceTiers, 50), 8400);
    assert.equal(tieredPrice(8900, tiles.priceTiers, 199), 8400);
    assert.equal(tieredPrice(8900, tiles.priceTiers, 200), 7900);
  });

  test('takes the cheapest applicable tier, not the last one listed', () => {
    // A supplier entering tiers out of order still charges what they meant.
    const jumbled = [
      { minQty: 200, price: 7900 },
      { minQty: 50, price: 8400 },
    ];
    assert.equal(tieredPrice(8900, jumbled, 300), 7900);
  });

  test('ignores a tier that costs more than the base', () => {
    // Bulk that costs more per unit punishes somebody for buying more.
    assert.equal(tieredPrice(8900, [{ minQty: 10, price: 9500 }], 100), 8900);
  });

  test('ignores malformed tiers rather than pricing from them', () => {
    const junk = [
      { minQty: 'ten', price: 100 },
      { minQty: 10, price: null },
      { minQty: 0, price: 1 },
      { minQty: 10, price: -5 },
    ];
    assert.equal(tieredPrice(8900, junk, 100), 8900);
  });

  test('survives no tiers at all', () => {
    assert.equal(tieredPrice(9800, undefined, 500), 9800);
    assert.equal(tieredPrice(9800, [], 500), 9800);
  });

  test('never returns NaN beside a pay button', () => {
    assert.equal(tieredPrice(undefined, [], 5), 0);
    assert.equal(tieredPrice('abc', [], 5), 0);
  });
});

describe('priceLine', () => {
  test('a plain product prices and stocks from itself', () => {
    const line = priceLine({ product: cement, quantity: 10 });
    assert.equal(line.unitPrice, 9800);
    assert.equal(line.stockPath, 'product');
    assert.equal(line.available, 480);
    assert.equal(line.skuKey, null);
  });

  test('a variant prices and stocks from the variant', () => {
    const line = priceLine({
      product: tiles,
      quantity: 5,
      options: { Size: '300x600', Finish: 'Matt' },
    });
    assert.equal(line.unitPrice, 5600, 'the small tile is its own price, not a delta');
    assert.equal(line.stockPath, 'sku');
    assert.equal(line.available, 300);
  });

  test('tiers still apply on top of a variant', () => {
    // Buying forty of the large size is still buying forty.
    const line = priceLine({
      product: tiles,
      quantity: 250,
      options: { Size: '600x600', Finish: 'Matt' },
    });
    assert.equal(line.unitPrice, 7900);
  });

  test('a variant priced above a tier still gets the tier', () => {
    const line = priceLine({
      product: tiles,
      quantity: 60,
      options: { Size: '600x600', Finish: 'Gloss' },
    });
    assert.equal(line.unitPrice, 8400);
  });

  test('an unknown combination falls back to the product rather than failing', () => {
    const line = priceLine({ product: tiles, quantity: 1, options: { Size: 'enormous' } });
    assert.equal(line.unitPrice, 8900);
    assert.equal(line.stockPath, 'product');
  });
});

describe('anyStock', () => {
  test('a plain product is in stock when it has some', () => {
    assert.equal(anyStock(cement), true);
    assert.equal(anyStock({ price: 1, quantity: 0 }), false);
  });

  test('one sold-out variant does not hide the others', () => {
    assert.equal(anyStock(tiles), true);
  });

  test('every variant sold out means sold out', () => {
    assert.equal(anyStock({ skus: [{ quantity: 0 }, { quantity: 0 }] }), false);
  });
});

describe('pre-orders', () => {
  const preorder = {
    price: 465000,
    quantity: 0,
    inStock: false,
    fulfilment: 'preorder',
    preorderWeeksMin: 4,
    preorderWeeksMax: 6,
  };

  test('is sellable with nothing in stock — that is the whole point', () => {
    // Counting it against stock would mean the only listings that can never be
    // ordered are exactly the ones that exist to be ordered in advance.
    assert.equal(anyStock(preorder), true);
  });

  test('is sellable even when every variant reads zero', () => {
    assert.equal(
      anyStock({ ...preorder, skus: [{ quantity: 0 }, { quantity: 0 }] }),
      true
    );
  });

  test('reports no availability ceiling', () => {
    const line = priceLine({ product: preorder, quantity: 40 });
    assert.equal(line.available, undefined, 'a ceiling of 0 would block the order');
    assert.equal(line.preorder, true);
  });

  test('still prices, and still takes bulk tiers', () => {
    const line = priceLine({
      product: { ...preorder, priceTiers: [{ minQty: 10, price: 440000 }] },
      quantity: 12,
    });
    assert.equal(line.unitPrice, 440000);
  });

  test('a stocked product is not marked as one', () => {
    assert.equal(priceLine({ product: cement, quantity: 1 }).preorder, false);
    assert.equal(anyStock({ ...cement, quantity: 0 }), false);
  });
});
