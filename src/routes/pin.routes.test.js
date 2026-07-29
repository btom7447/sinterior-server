/**
 * Pin routes mix literal paths with a `/:id` wildcard, and Express matches in
 * registration order. A literal registered after the wildcard is never reached
 * — it does not error, it just quietly resolves to getPin with an id of
 * "comments", which reads as "pin not found" and looks like a data problem.
 *
 * The file already carries a comment warning about this. These make it fail
 * loudly instead.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./pin.routes.js', import.meta.url), 'utf8');
const at = (path) => source.indexOf(`'${path}'`);

describe('route ordering against the /:id wildcard', () => {
  const wildcard = at('/:id');

  test('the wildcard is actually registered', () => {
    assert.ok(wildcard > -1, "expected a '/:id' route to exist");
  });

  for (const literal of [
    '/taxonomy',
    '/feed',
    '/comments/:commentId',
    '/comments/:commentId/replies',
    '/comments/:commentId/like',
  ]) {
    test(`${literal} is registered before /:id`, () => {
      const found = at(literal);
      assert.ok(found > -1, `${literal} should exist`);
      assert.ok(found < wildcard, `${literal} would be swallowed by /:id`);
    });
  }
});

describe('what the new comment and report routes require', () => {
  /** The line a path is declared on, so its middleware can be read. */
  const lineFor = (path) =>
    source.split('\n').find((line) => line.includes(`'${path}'`)) ?? '';

  test('reading comments and replies works without a token', () => {
    // optionalAuth, not protect: a signed-out reader still gets the thread,
    // and a signed-in one additionally gets likedByMe.
    for (const path of ['/:id/comments', '/comments/:commentId/replies']) {
      const line = lineFor(path);
      assert.match(line, /optionalAuth/, `${path} should read publicly`);
      assert.doesNotMatch(line, /\bprotect\b/, `${path} should not require a token`);
    }
  });

  test('every write to a comment requires a token', () => {
    for (const path of ['/:id/comments', '/comments/:commentId/like', '/comments/:commentId']) {
      const writes = source
        .split('\n')
        .filter((line) => line.includes(`'${path}'`) && /router\.(post|delete|patch)/.test(line));
      assert.ok(writes.length > 0, `${path} should have a write route`);
      for (const line of writes) {
        assert.match(line, /\bprotect\b/, `${line.trim()} is unauthenticated`);
      }
    }
  });

  test('reporting requires a token', () => {
    const line = lineFor('/:id/report');
    assert.ok(line, 'a report route should exist');
    assert.match(line, /\bprotect\b/, 'anonymous reports would be unmoderatable noise');
  });
});
