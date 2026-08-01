import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CATEGORIES, isValidSubcategory, SUBCATEGORIES } from './catalogue.js';

describe('catalogue', () => {
  test('every category carries subcategories', () => {
    for (const category of CATEGORIES) {
      assert.ok(SUBCATEGORIES[category].length >= 3, `${category} is too thin to be a level`);
    }
  });

  test('accepts a subcategory that belongs to its category', () => {
    assert.equal(isValidSubcategory('Tiles & Flooring', 'Porcelain'), true);
  });

  test('refuses one borrowed from another category', () => {
    // Otherwise the second-level rail offers a filter that matches nothing.
    assert.equal(isValidSubcategory('Cement', 'Porcelain'), false);
  });

  test('refuses free text, which is how three spellings of one word appear', () => {
    assert.equal(isValidSubcategory('Tiles & Flooring', 'porcelain tiles'), false);
    assert.equal(isValidSubcategory('Tiles & Flooring', 'Porcelian'), false);
  });

  test('no subcategory at all is fine — most listings have none yet', () => {
    assert.equal(isValidSubcategory('Cement', undefined), true);
    assert.equal(isValidSubcategory('Cement', ''), true);
  });

  test('an unknown category accepts nothing', () => {
    assert.equal(isValidSubcategory('Spaceships', 'Warp core'), false);
  });

  test('no subcategory is repeated inside a category', () => {
    for (const [category, list] of Object.entries(SUBCATEGORIES)) {
      assert.equal(new Set(list).size, list.length, `${category} repeats one`);
    }
  });
});
