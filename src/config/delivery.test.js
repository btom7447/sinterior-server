import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { fullyDelivered, settledSuppliers, suppliersOn } from './delivery.js';

const ALPHA = '6a6d4572de8d07c764156bd5';
const BETA = '69d8ea183ba0b06f6ee60bc8';

const split = [
  { supplierId: ALPHA, quantity: 1 },
  { supplierId: BETA, quantity: 2 },
];
const single = [{ supplierId: ALPHA, quantity: 1 }];

describe('suppliersOn', () => {
  test('lists each supplier once, however many lines they have', () => {
    const items = [{ supplierId: ALPHA }, { supplierId: ALPHA }, { supplierId: BETA }];
    assert.deepEqual(suppliersOn(items), [ALPHA, BETA]);
  });

  test('reads through a populated ref', () => {
    // The order is sometimes fetched with suppliers populated, and a populated
    // ref compared as a string is the bug that has bitten this codebase before.
    assert.deepEqual(suppliersOn([{ supplierId: { _id: ALPHA, fullName: 'Maroda' } }]), [ALPHA]);
  });

  test('survives an empty or missing item list', () => {
    assert.deepEqual(suppliersOn([]), []);
    assert.deepEqual(suppliersOn(undefined), []);
  });
});

describe('settledSuppliers', () => {
  test('nobody is settled on a fresh order', () => {
    assert.deepEqual(
      settledSuppliers({ items: split, supplierApprovals: [], buyerApprovals: [] }),
      []
    );
  });

  test('a supplier saying they delivered is not enough on its own', () => {
    // Escrow exists precisely so the seller's word is not the last word.
    assert.deepEqual(
      settledSuppliers({ items: split, supplierApprovals: [ALPHA], buyerApprovals: [] }),
      []
    );
  });

  test('the buyer confirming is not enough on its own either', () => {
    assert.deepEqual(
      settledSuppliers({ items: split, supplierApprovals: [], buyerApprovals: [ALPHA] }),
      []
    );
  });

  test('settles only the supplier both sides agree on', () => {
    // The bug this replaced: one supplier confirming released the whole
    // order's escrow, paying a co-supplier who had shipped nothing.
    assert.deepEqual(
      settledSuppliers({ items: split, supplierApprovals: [ALPHA], buyerApprovals: [ALPHA] }),
      [ALPHA]
    );
  });

  test('a buyer confirming everything still does not pay a supplier who has not shipped', () => {
    assert.deepEqual(
      settledSuppliers({ items: split, supplierApprovals: [ALPHA], buyerApprovals: [ALPHA, BETA] }),
      [ALPHA]
    );
  });

  test('settles both once both are agreed', () => {
    assert.deepEqual(
      settledSuppliers({
        items: split,
        supplierApprovals: [ALPHA, BETA],
        buyerApprovals: [ALPHA, BETA],
      }),
      [ALPHA, BETA]
    );
  });

  test('ignores an approval for a supplier who is not on the order', () => {
    const stranger = '6a09862bc322c9c310bd3acf';
    assert.deepEqual(
      settledSuppliers({
        items: single,
        supplierApprovals: [stranger],
        buyerApprovals: [stranger],
      }),
      []
    );
  });
});

describe('fullyDelivered', () => {
  test('a single-supplier order behaves exactly as the old booleans did', () => {
    assert.equal(
      fullyDelivered({ items: single, supplierApprovals: [ALPHA], buyerApprovals: [ALPHA] }),
      true
    );
  });

  test('a split order is not delivered until every supplier is settled', () => {
    assert.equal(
      fullyDelivered({ items: split, supplierApprovals: [ALPHA], buyerApprovals: [ALPHA] }),
      false
    );
    assert.equal(
      fullyDelivered({
        items: split,
        supplierApprovals: [ALPHA, BETA],
        buyerApprovals: [ALPHA, BETA],
      }),
      true
    );
  });

  test('an order with no items is never delivered', () => {
    // Guards the empty-array case, where "every supplier agreed" is vacuously
    // true and would mark a nonsense order complete.
    assert.equal(fullyDelivered({ items: [], supplierApprovals: [], buyerApprovals: [] }), false);
  });
});
