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

test('independent-groups ANOVA helper remains numerically stable but is not used for repeated panels', () => {
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

test('complete balanced studies use panelist-blocked inference and preserve descriptive analytics', () => {
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
  const inference = analysis.anova.find(item => item.attribute_key === 'overall_liking').result;
  assert.equal(inference.method, 'randomized_complete_block_anova');
  assert.equal(inference.design, 'complete_balanced_repeated_measures');
  assert.equal(inference.valid_for_inference, true);
  assert.equal(inference.significant_at_0_05, true);
  assert.equal(inference.friedman.method, 'friedman_test');
  assert.equal(inference.friedman.valid_for_inference, true);
  assert.ok(analysis.correlations.some(item => item.row === 'sweetness' && item.column === 'overall_liking' && item.value > 0.9));
  assert.equal(new Set(analysis.segments.map(item => item.segment)).size, 2);
  assert.ok(analysis.quality.flags.some(flag => flag.type === 'rapid_completion'));
});

test('known complete-block dataset produces the expected Friedman statistic and effect size', () => {
  const threeSampleStudy = {
    ...study,
    attributes: [{ key: 'overall_liking', label: 'Overall liking', category: 'overall' }],
    samples: [
      { id: 'a', sample_code: 'A', blind_code: '101', label: 'A' },
      { id: 'b', sample_code: 'B', blind_code: '202', label: 'B' },
      { id: 'c', sample_code: 'C', blind_code: '303', label: 'C' },
    ],
  };
  const rows = [[8, 6, 7], [7, 5, 6], [9, 6, 8], [6, 4, 5], [8, 5, 7]];
  const responses = rows.map((values, index) => ({
    id: `known-${index}`, panelist_code: `K-${index}`,
    samples: threeSampleStudy.samples.map((sample, sampleIndex) => ({ sample_id: sample.id, scores: { overall_liking: values[sampleIndex] } })),
  }));
  const result = analyzeSensoryStudy(threeSampleStudy, responses).anova[0].result;
  assert.equal(result.valid_for_inference, true);
  assert.equal(result.friedman.statistic, 10);
  assert.equal(result.friedman.p_value, 0.00674);
  assert.deepEqual(result.friedman.effect_size, { name: 'kendalls_w', value: 1 });
  assert.equal(result.friedman.significant_at_0_05, true);
});

test('incomplete repeated measures remain descriptive without a p-value or significance claim', () => {
  const responses = [response(1, 8, 4), response(2, 9, 5), response(3, 8, 4)];
  responses[2].samples = responses[2].samples.filter(sample => sample.sample_id === 'control');
  const analysis = analyzeSensoryStudy(study, responses);
  const result = analysis.anova.find(item => item.attribute_key === 'overall_liking').result;
  assert.equal(result.method, 'descriptive_only');
  assert.equal(result.design, 'incomplete_or_unbalanced_repeated_measures');
  assert.equal(result.valid_for_inference, false);
  assert.equal(result.statistic, null);
  assert.equal(result.p_value, null);
  assert.equal(result.significant_at_0_05, false);
  assert.match(result.reason, /mixed-effects model/i);
});

test('a very small complete panel does not publish an inferential p-value', () => {
  const analysis = analyzeSensoryStudy(study, [response(1, 8, 4), response(2, 9, 5), response(3, 8, 4)]);
  const result = analysis.anova.find(item => item.attribute_key === 'overall_liking').result;
  assert.equal(result.method, 'randomized_complete_block_anova');
  assert.equal(result.design, 'complete_balanced_repeated_measures');
  assert.equal(result.valid_for_inference, false);
  assert.equal(result.p_value, null);
  assert.equal(result.significant_at_0_05, false);
  assert.match(result.reason, /too few/i);
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
