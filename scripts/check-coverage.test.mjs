import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { calculateCoverage } from './check-coverage.mjs';

const webFile = path.resolve('web.ts');
const apiFile = path.resolve('api.ts');
const sharedFile = path.resolve('shared.ts');
const report = (files) => ({
  total: {
    lines: Object.values(files).reduce((sum, entry) => ({
      covered: sum.covered + entry.lines.covered,
      total: sum.total + entry.lines.total,
    }), { covered: 0, total: 0 }),
  },
  ...files,
});
const lines = (covered, total) => ({ lines: { covered, total } });

test('aggregates covered and total lines rather than averaging report percentages', () => {
  const reports = [report({ [webFile]: lines(9, 10) }), report({ [apiFile]: lines(6, 10), [sharedFile]: lines(1, 1) })];
  const result = calculateCoverage(reports, [webFile, apiFile, sharedFile]);
  assert.equal(result.covered, 16);
  assert.equal(result.total, 21);
  assert.equal(result.passed, false);
});

test('passes at the exact threshold and fails below it', () => {
  assert.equal(calculateCoverage([report({ [webFile]: lines(8, 10) }), report({ [apiFile]: lines(0, 0) })], [webFile, apiFile]).passed, true);
  assert.equal(calculateCoverage([report({ [webFile]: lines(79, 100) }), report({ [apiFile]: lines(0, 0) })], [webFile, apiFile]).passed, false);
});

test('fails closed for missing reports, missing source, malformed counts, duplicates, and empty totals', () => {
  assert.throws(() => calculateCoverage([report({ [webFile]: lines(1, 1) })], [webFile]));
  assert.throws(() => calculateCoverage([report({ [webFile]: lines(1, 1) }), report({})], [webFile, apiFile]));
  assert.throws(() => calculateCoverage([report({ [webFile]: lines(2, 1) }), report({})], [webFile]));
  assert.throws(() => calculateCoverage([report({ [webFile]: lines(1, 1) }), report({ [webFile]: lines(1, 1) })], [webFile]));
  assert.throws(() => calculateCoverage([report({ [webFile]: lines(0, 0) }), report({})], [webFile]));
  assert.throws(() => calculateCoverage([{ total: {}, [webFile]: lines(1, 1) }, report({})], [webFile]));
  assert.throws(() => calculateCoverage([{ total: { lines: { covered: 1, total: 2 } }, [webFile]: lines(1, 1) }, report({})], [webFile]));
});