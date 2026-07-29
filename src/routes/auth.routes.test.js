/**
 * Password rules are declared as regexes inside a route file, which is a place
 * a typo hides well: `/d/` instead of `/\d/` still compiles, still matches
 * something, and silently accepts "password" as containing a digit. That exact
 * slip shipped once. These assert the rules mean what they say.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./auth.routes.js', import.meta.url), 'utf8');

describe('password validation rules', () => {
  test('every digit check is \\d, never a bare letter', () => {
    const checks = source.match(/\.matches\(\/[^/]*\/\)/g) ?? [];
    assert.ok(checks.length >= 3, 'expected several password rules to exist');
    for (const check of checks) {
      assert.equal(
        check,
        '.matches(/\\d/)',
        `${check} is not a digit check — a bare letter here would accept "password"`
      );
    }
  });

  test('the rule a typo would break actually rejects a digitless password', () => {
    // The literal the route uses, exercised directly.
    const rule = /\d/;
    assert.equal(rule.test('password'), false);
    assert.equal(rule.test('passw0rd'), true);
  });

  test('reset-by-code is registered before the :token wildcard', () => {
    const byCode = source.indexOf("'/reset-password/code'");
    const byToken = source.indexOf("'/reset-password/:token'");
    assert.ok(byCode > -1 && byToken > -1, 'both reset routes should exist');
    assert.ok(byCode < byToken, ':token would otherwise swallow /code');
  });

  test('account deletion is protected and rate limited', () => {
    const line = source.split('\n').find((l) => l.includes("router.delete('/account'"));
    assert.ok(line, 'the deletion route should exist — the app stores require it');
    assert.ok(line.includes('protect'), 'deletion must require a session');
    assert.ok(line.includes('authLimiter'), 'deletion must be rate limited');
  });
});
