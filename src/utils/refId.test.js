import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isSameRef, refId } from './refId.js';

/** Stands in for an ObjectId: an object whose toString is its hex value. */
const oid = (hex) => ({ toString: () => hex });

const HEX = '69ebd26e350f517f9afebcd4';

describe('refId', () => {
  test('reads a plain id', () => {
    assert.equal(refId(oid(HEX)), HEX);
  });

  test('reads through a populated document', () => {
    // The whole point: this is what a .populate() upstream turns the ref into.
    assert.equal(refId({ _id: oid(HEX), fullName: 'Dangote Depot' }), HEX);
  });

  test('accepts a bare string', () => {
    assert.equal(refId(HEX), HEX);
  });

  test('returns null for nothing rather than the string "null"', () => {
    // A deleted product leaves a null ref. "null" === "null" would match, which
    // on a supplier comparison would hand someone else's order over.
    assert.equal(refId(null), null);
    assert.equal(refId(undefined), null);
  });
});

describe('isSameRef', () => {
  test('matches a populated ref against a plain one', () => {
    assert.equal(isSameRef({ _id: oid(HEX) }, oid(HEX)), true);
  });

  test('does not match different ids', () => {
    assert.equal(isSameRef(oid(HEX), oid('aaaaaaaaaaaaaaaaaaaaaaaa')), false);
  });

  test('two absent refs are not the same ref', () => {
    assert.equal(isSameRef(null, null), false, 'nothing must never authorise anything');
  });
});
