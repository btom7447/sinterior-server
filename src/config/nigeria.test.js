import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCoverage, resolveState, allRecognised, NIGERIAN_STATES } from './nigeria.js';

test('there are 36 states and the FCT', () => {
  assert.equal(NIGERIAN_STATES.length, 37);
});

test('resolveState accepts the spellings people actually use', () => {
  assert.equal(resolveState('lagos'), 'Lagos');
  assert.equal(resolveState('Lagos State'), 'Lagos');
  assert.equal(resolveState('  LAGOS  '), 'Lagos');
  assert.equal(resolveState('Abuja'), 'FCT Abuja');
  assert.equal(resolveState('FCT'), 'FCT Abuja');
  assert.equal(resolveState('Federal Capital Territory'), 'FCT Abuja');
  assert.equal(resolveState('akwa ibom'), 'Akwa Ibom');
  assert.equal(resolveState('Port Harcourt'), 'Rivers');
});

test('resolveState refuses to guess', () => {
  // The whole point: a near-miss must not silently become a real state and
  // quote somebody the wrong delivery fee.
  assert.equal(resolveState('Lagoss'), null);
  assert.equal(resolveState('Nowhere'), null);
  assert.equal(resolveState(''), null);
  assert.equal(resolveState(null), null);
  assert.equal(resolveState(undefined), null);
});

test('parseCoverage splits the shapes the free-text box allowed', () => {
  assert.deepEqual(parseCoverage('Lagos'), ['Lagos']);
  assert.deepEqual(parseCoverage('Lagos, Ogun, Oyo'), ['Lagos', 'Ogun', 'Oyo']);
  assert.deepEqual(parseCoverage('Lagos and Ogun'), ['Lagos', 'Ogun']);
  assert.deepEqual(parseCoverage('Lagos/Ogun'), ['Lagos', 'Ogun']);
  assert.deepEqual(parseCoverage('Lagos; Ogun | Oyo'), ['Lagos', 'Ogun', 'Oyo']);
  assert.deepEqual(parseCoverage('Abuja, FCT'), ['FCT Abuja']); // one place, two names
});

test('parseCoverage canonicalises while splitting', () => {
  assert.deepEqual(parseCoverage('lagos state, abuja'), ['Lagos', 'FCT Abuja']);
});

test('parseCoverage keeps what it cannot recognise', () => {
  // Losing this silently during a migration is worse than carrying a value the
  // picker cannot highlight — the supplier told us something.
  assert.deepEqual(parseCoverage('South West'), ['South West']);
  assert.deepEqual(parseCoverage('Lagos, South West'), ['Lagos', 'South West']);
});

test('parseCoverage is idempotent and accepts arrays', () => {
  assert.deepEqual(parseCoverage(['Lagos', 'Ogun']), ['Lagos', 'Ogun']);
  assert.deepEqual(parseCoverage(parseCoverage('Lagos, Ogun')), ['Lagos', 'Ogun']);
  assert.deepEqual(parseCoverage(['Lagos, Ogun', 'Oyo']), ['Lagos', 'Ogun', 'Oyo']);
});

test('parseCoverage handles nothing at all', () => {
  assert.deepEqual(parseCoverage(''), []);
  assert.deepEqual(parseCoverage(null), []);
  assert.deepEqual(parseCoverage(undefined), []);
  assert.deepEqual(parseCoverage('   '), []);
  assert.deepEqual(parseCoverage(','), []);
});

test('parseCoverage does not repeat a state written twice', () => {
  assert.deepEqual(parseCoverage('Lagos, lagos, Lagos State'), ['Lagos']);
});

test('allRecognised separates clean data from data needing a human', () => {
  assert.equal(allRecognised(['Lagos', 'Ogun']), true);
  assert.equal(allRecognised(['Lagos', 'South West']), false);
  assert.equal(allRecognised([]), true);
});
