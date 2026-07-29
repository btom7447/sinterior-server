/**
 * The tag deriver decides what every pin is findable under, runs unattended
 * over the whole collection in a backfill, and is a pile of regular expressions
 * built from a hand-written list. That combination is exactly where a silent
 * mistake is most expensive, so these tests pin down the behaviour that is easy
 * to break by editing the vocabulary.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { deriveTags, sanitizeTags, VOCABULARY, TAG_IDS } from './vocabulary.js';

describe('deriveTags', () => {
  test('reads terms out of a realistic caption', () => {
    const tags = deriveTags(
      'POP ceiling and cove lights in a Lekki duplex',
      'Gypsum board with LED strips. Modern finish.'
    );
    assert.ok(tags.includes('pop'));
    assert.ok(tags.includes('lekki'));
    assert.ok(tags.includes('gypsum'));
    assert.ok(tags.includes('modern'));
  });

  test('matches on word boundaries, so "vi" inside "vinyl" is not Victoria Island', () => {
    const tags = deriveTags('Vinyl flooring throughout');
    assert.ok(tags.includes('vinyl'));
    assert.ok(!tags.includes('victoria-island'));
  });

  test('prefers the longest phrase, so "victoria island" beats any word inside it', () => {
    assert.ok(deriveTags('An office on Victoria Island').includes('victoria-island'));
  });

  test('is case and punctuation insensitive', () => {
    assert.deepEqual(deriveTags('P.O.P CEILING!'), deriveTags('pop ceiling'));
  });

  test('returns nothing rather than guessing', () => {
    assert.deepEqual(deriveTags('Nothing in here matches at all'), []);
    assert.deepEqual(deriveTags(''), []);
    assert.deepEqual(deriveTags(undefined, null), []);
  });

  test('never emits a tag twice', () => {
    const tags = deriveTags('tiles tiles tiling porcelain ceramic');
    assert.equal(new Set(tags).size, tags.length);
  });

  test('caps output so one keyword-stuffed caption cannot carry ten tags', () => {
    const stuffed = VOCABULARY.map((v) => v.match[0]).join(' ');
    assert.ok(deriveTags(stuffed).length <= 10);
  });

  test('only ever emits ids the vocabulary declares', () => {
    const stuffed = VOCABULARY.map((v) => v.match[0]).join(' ');
    for (const tag of deriveTags(stuffed)) assert.ok(TAG_IDS.includes(tag));
  });
});

describe('sanitizeTags', () => {
  test('drops anything not in the vocabulary', () => {
    assert.deepEqual(sanitizeTags(['pop', 'not-a-real-tag', 'lekki']), ['pop', 'lekki']);
  });

  test('dedupes and survives junk input', () => {
    assert.deepEqual(sanitizeTags(['pop', 'pop']), ['pop']);
    assert.deepEqual(sanitizeTags(null), []);
    assert.deepEqual(sanitizeTags('pop'), []);
  });
});

describe('the vocabulary itself', () => {
  test('has no duplicate ids', () => {
    assert.equal(new Set(TAG_IDS).size, TAG_IDS.length, 'two entries share an id');
  });

  test('every entry has at least one matcher phrase', () => {
    for (const entry of VOCABULARY) {
      assert.ok(entry.match?.length, `${entry.id} has no phrases to match on`);
      assert.ok(entry.label, `${entry.id} has no label`);
      assert.ok(['material', 'style', 'place'].includes(entry.group), `${entry.id} has a bad group`);
    }
  });

  test('no phrase is claimed by two different tags', () => {
    const owner = new Map();
    for (const entry of VOCABULARY) {
      for (const phrase of entry.match) {
        const seen = owner.get(phrase.toLowerCase());
        assert.ok(!seen, `"${phrase}" is claimed by both ${seen} and ${entry.id}`);
        owner.set(phrase.toLowerCase(), entry.id);
      }
    }
  });
});
