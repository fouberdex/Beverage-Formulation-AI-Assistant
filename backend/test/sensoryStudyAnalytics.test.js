import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSensoryStudy, calculateAnova, fSurvivalProbability } from '../src/services/sensoryStudyAnalytics.js';

const study = {
  id: 'study-1', scale_min: 0, scale_max: 10,
  attributes: [
    { key: 'sweetness', label: 'Sweetness', category: 'taste' },
    { key: 'overall_liking', label: 'Overall liking', category: 'overall' },
  ],
  samples: [
    { id: 'control', sample_code: 'CTRL', blind_code: '314', label: 'Control' },
    { id: 'candidate', sample_code: 'CAND', blind_code: '729', label: 'Candidate' },
  ],
};

function response(index, controlLiking, candidateLiking, options = {}) {
  return {
    id: `response-${index}`,
    panelist_code: `P-${index}`,
    segment: index % 2 ? 'Frequent' : 'Occasional',
    session: { duration_seconds: options.duration_seconds || 300 },
    samples: [
      { sample_id: 'control', scores: { sweetness: 7, overall_liking: controlLiking }, jar: { sweetness: 0 } },
      { sample_id: 'candidate', scores: { sweetness: 4, overall_liking: candidateLiking }, jar: { sweetness: options.candidate_jar ?? -1 } },
    ],
  };
}

test('ANOVA reports a strong between-sample signal with effect size', () => {
  const result = calculateAnova([
    { values: [8, 8, 9, 9] },
    { values: [4, 4, 5, 5] },
  ]);
  assert.ok(result.f_statistic > 50);
  assert.ok(result.p_value < 0.001);
  assert.equal(result.significant_at_0_05, true);
  assert.ok(result.eta_squared > 0.8);
  assert.ok(fSurvivalProbability(result.f_statistic, result.df_between, result.df_within) < 0.001);
});

test('study analytics produce profiles, rankings, correlations, segments and diagnostics', () => {
  const responses = [
    response(1, 8, 4), response(2, 9, 5), response(3, 8, 4), response(4, 9, 5),
    response(5, 8, 4), response(6, 9, 5), response(7, 8, 4), response(8, 9, 5),
    response(9, 8, 4), response(10, 9, 5, { duration_seconds: 30 }),
  ];
  const analysis = analyzeSensoryStudy(study, responses);
  assert.equal(analysis.coverage.response_count, 10);
  assert.equal(analysis.coverage.evaluation_count, 20);
  assert.equal(analysis.coverage.score_completion_percent, 100);
  assert.equal(analysis.ranking[0].sample_id, 'control');
  assert.equal(analysis.samples.find(sample => sample.sample_id === 'control').overall.mean, 8.5);
  assert.equal(analysis.anova.find(item => item.attribute_key === 'overall_liking').result.significant_at_0_05, true);
  assert.ok(analysis.correlations.some(item => item.row === 'sweetness' && item.column === 'overall_liking' && item.value > 0.9));
  assert.equal(new Set(analysis.segments.map(item => item.segment)).size, 2);
  assert.ok(analysis.quality.flags.some(flag => flag.type === 'rapid_completion'));
});

test('JAR penalty with no JAR comparison group remains non-actionable', () => {
  const responses = Array.from({ length: 10 }, (_, index) => response(index + 1, 8, 4, { candidate_jar: -1 }));
  const analysis = analyzeSensoryStudy(study, responses);
  const penalty = analysis.jar_penalty.find(item => item.sample_id === 'candidate' && item.dimension === 'sweetness' && item.direction === 'too_low');
  assert.equal(penalty.count, 10);
  assert.equal(penalty.percent, 100);
  // No candidate respondents selected JAR, so the penalty cannot be estimated
  // and must not be presented as actionable.
  assert.equal(penalty.mean_drop, null);
  assert.equal(penalty.actionable, false);
});
