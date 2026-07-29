/**
 * Mentions are the one place in the comment system where a client tells the
 * server who to notify. These pin down the limits on that.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_MENTIONS, normaliseMentionIds } from './comments.js';

// Stands in for mongoose.isValidObjectId: 24 hex characters.
const looksLikeId = (id) => /^[a-f0-9]{24}$/i.test(id);
const id = (n) => String(n).padStart(24, '0');

describe('normaliseMentionIds', () => {
  test('keeps well-formed ids in the order they were given', () => {
    assert.deepEqual(normaliseMentionIds([id(1), id(2)], looksLikeId), [id(1), id(2)]);
  });

  test('drops anything that is not an id, rather than passing it to the query', () => {
    assert.deepEqual(normaliseMentionIds(['not-an-id', id(1), ''], looksLikeId), [id(1)]);
  });

  test('naming the same person twice notifies them once', () => {
    assert.deepEqual(normaliseMentionIds([id(1), id(1), id(1)], looksLikeId), [id(1)]);
  });

  test('caps a long list', () => {
    const many = Array.from({ length: 200 }, (_, i) => id(i + 1));
    assert.equal(normaliseMentionIds(many, looksLikeId).length, MAX_MENTIONS);
  });

  test('dedupes before capping, so repeats cannot squeeze out real people', () => {
    // Nine copies of one id followed by two other people. Capping first would
    // return one distinct person; deduping first returns three.
    const padded = [...Array(9).fill(id(1)), id(2), id(3)];
    assert.deepEqual(normaliseMentionIds(padded, looksLikeId), [id(1), id(2), id(3)]);
  });

  test('survives the shapes a hostile client would actually send', () => {
    assert.deepEqual(normaliseMentionIds(undefined, looksLikeId), []);
    assert.deepEqual(normaliseMentionIds(null, looksLikeId), []);
    assert.deepEqual(normaliseMentionIds('not-an-array', looksLikeId), []);
    assert.deepEqual(normaliseMentionIds([{ $ne: null }, [id(1)]], looksLikeId), []);
  });
});
