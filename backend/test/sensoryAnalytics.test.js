import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSensoryResults } from '../src/services/sensoryAnalytics.js';

function result(id, taste, sensory = {}) {
  return {
    id,
    batch_code: `B-${id}`,
    tested_at: `2026-08-${String(Number(id) + 1).padStart(2, '0')}T00:00:00.000Z`,
    sensory: { taste, ...sensory },
  };
}

test('sensory analytics reports honest empty-state coverage and limitations', () => {
  const analysis = analyzeSensoryResults([]);
  assert.deepEqual(analysis.coverage, {
    result_count: 0,
    observed_scores: 0,
    expected_scores: 0,
    completion_percent: 0,
  });
  assert.ok(analysis.warnings.some(item => item.code === 'aggregate_batch_scores'));
  assert.ok(analysis.warnings.some(item => item.code === 'no_data'));
});

test('sensory analytics calculates descriptive statistics and t confidence intervals', () => {
  const analysis = analyzeSensoryResults([
    result('1', 6), result('2', 7), result('3', 8), result('4', 9),
  ]);
  const taste = analysis.attributes.find(attribute => attribute.key === 'taste');
  assert.equal(taste.count, 4);
  assert.equal(taste.mean, 7.5);
  assert.equal(taste.median, 7.5);
  assert.equal(taste.standard_deviation, 1.29);
  assert.deepEqual(taste.confidence_interval_95, { lower: 5.45, upper: 9.55 });
  assert.equal(taste.distribution.reduce((sum, bin) => sum + bin.count, 0), 4);
});

test('sensory analytics flags Tukey outliers without deleting observations', () => {
  const analysis = analyzeSensoryResults([
    result('1', 5, { aroma: 6 }),
    result('2', 5, { aroma: 6 }),
    result('3', 5, { aroma: 6 }),
    result('4', 10, { aroma: 6 }),
  ]);
  const taste = analysis.attributes.find(attribute => attribute.key === 'taste');
  assert.equal(taste.count, 4);
  assert.equal(taste.outliers.length, 1);
  assert.equal(taste.outliers[0].value, 10);
  assert.match(taste.outliers[0].reason, /1.5×IQR/);
  assert.ok(analysis.warnings.some(item => item.code === 'outliers_detected'));
});

test('sensory analytics tracks missing values and ranks batches by available scores', () => {
  const analysis = analyzeSensoryResults([
    result('1', 5, { aroma: 7 }),
    result('2', 8, { aroma: 8, appearance: 9 }),
  ]);
  assert.equal(analysis.coverage.observed_scores, 5);
  assert.equal(analysis.coverage.expected_scores, 10);
  assert.equal(analysis.coverage.completion_percent, 50);
  assert.equal(analysis.ranked_batches[0].result_id, '2');
  assert.equal(analysis.ranked_batches[0].composite_score, 8.33);
  assert.ok(analysis.warnings.some(item => item.code === 'missing_scores'));
});
