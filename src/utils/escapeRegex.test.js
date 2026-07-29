import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import escapeRegex from './escapeRegex.js';

describe('escapeRegex', () => {
  test('leaves an ordinary name alone', () => {
    assert.equal(escapeRegex('Adeola'), 'Adeola');
  });

  test('a wildcard search matches literally instead of matching everything', () => {
    const pattern = new RegExp(escapeRegex('.*'), 'i');
    assert.equal(pattern.test('Adeola Okafor'), false);
    assert.equal(pattern.test('who typed .* here'), true);
  });

  test('a nested quantifier cannot be built out of user input', () => {
    const pattern = new RegExp(escapeRegex('(a+)+b'), 'i');
    // If this compiled as a real pattern it would take exponential time on this
    // input. Escaped, it is a plain string comparison and returns immediately.
    assert.equal(pattern.test('a'.repeat(40)), false);
  });

  test('escapes every character that means something in a pattern', () => {
    for (const char of '.*+?^${}()|[]\\') {
      const pattern = new RegExp(escapeRegex(char));
      assert.equal(pattern.test(char), true, `${char} should match itself`);
    }
  });

  test('does not throw on input that would otherwise be an invalid pattern', () => {
    assert.doesNotThrow(() => new RegExp(escapeRegex('A. (Tunde) [')));
  });
});
