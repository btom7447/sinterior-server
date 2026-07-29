/**
 * The skill-category mapping is what let a backfill write a trade onto 13 live
 * pins. If it drifts from the client's category list, pins silently get the
 * wrong trade or none at all, and nothing anywhere raises its voice.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TRADES, ROOMS, TRADE_BY_SKILL_CATEGORY, tradeForSkillCategory } from './taxonomy.js';

describe('tradeForSkillCategory', () => {
  test('accepts a display name, which is what the client writes', () => {
    assert.equal(tradeForSkillCategory('Painting & Finishing'), 'painting');
    assert.equal(tradeForSkillCategory('Electrical & Lighting'), 'electrical');
    assert.equal(tradeForSkillCategory('Flooring & Tiling'), 'flooring');
  });

  test('accepts an id, which is what older records wrote', () => {
    assert.equal(tradeForSkillCategory('wall-decoration'), 'wall-decoration');
    assert.equal(tradeForSkillCategory('carpentry'), 'carpentry');
  });

  test('tolerates case and stray whitespace', () => {
    assert.equal(tradeForSkillCategory('  painting & finishing  '), 'painting');
  });

  test('returns null rather than guessing', () => {
    assert.equal(tradeForSkillCategory('Underwater Basket Weaving'), null);
    assert.equal(tradeForSkillCategory(''), null);
    assert.equal(tradeForSkillCategory(null), null);
    assert.equal(tradeForSkillCategory(42), null);
  });
});

describe('the taxonomy itself', () => {
  test('every mapped category resolves to a real trade', () => {
    for (const [name, trade] of Object.entries(TRADE_BY_SKILL_CATEGORY)) {
      assert.ok(TRADES.includes(trade), `"${name}" maps to "${trade}", which is not a trade`);
    }
  });

  test('every trade has a category that maps to it, so none is unreachable', () => {
    const mapped = new Set(Object.values(TRADE_BY_SKILL_CATEGORY));
    for (const trade of TRADES) {
      assert.ok(mapped.has(trade), `no skill category maps to "${trade}"`);
    }
  });

  test('ids are unique and url-safe, since they travel in route params', () => {
    assert.equal(new Set(TRADES).size, TRADES.length);
    assert.equal(new Set(ROOMS).size, ROOMS.length);
    for (const id of [...TRADES, ...ROOMS]) {
      assert.match(id, /^[a-z0-9-]+$/, `"${id}" is not safe in a URL`);
    }
  });

  test('"all" is not a trade, because the topic route uses it to mean any trade', () => {
    assert.ok(!TRADES.includes('all'));
  });
});
