const SENSORY_ATTRIBUTES = Object.freeze([
  { key: 'appearance', label: 'Appearance' },
  { key: 'aroma', label: 'Aroma' },
  { key: 'taste', label: 'Taste' },
  { key: 'mouthfeel', label: 'Mouthfeel' },
  { key: 'overall_acceptance', label: 'Overall acceptance' },
]);

const T_CRITICAL_95 = Object.freeze([
  0, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262,
  2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093,
  2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045,
  2.042,
]);

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function quantile(sortedValues, percentile) {
  if (sortedValues.length === 0) return null;
  if (sortedValues.length === 1) return sortedValues[0];
  const position = (sortedValues.length - 1) * percentile;
  const lower = Math.floor(position);
  const fraction = position - lower;
  return sortedValues[lower] + (sortedValues[lower + 1] - sortedValues[lower]) * fraction;
}

function tCritical95(degreesOfFreedom) {
  if (degreesOfFreedom <= 0) return null;
  if (degreesOfFreedom <= 30) return T_CRITICAL_95[degreesOfFreedom];
  const z = 1.959963984540054;
  const df = degreesOfFreedom;
  return z
    + ((z ** 3) + z) / (4 * df)
    + ((5 * (z ** 5)) + (16 * (z ** 3)) + (3 * z)) / (96 * (df ** 2))
    + ((3 * (z ** 7)) + (19 * (z ** 5)) + (17 * (z ** 3)) - (15 * z)) / (384 * (df ** 3));
}

function summarizeAttribute(results, attribute) {
  const observations = results
    .map(result => ({
      result_id: result.id,
      batch_code: result.batch_code || null,
      tested_at: result.tested_at,
      value: result.sensory?.[attribute.key],
    }))
    .filter(item => Number.isFinite(item.value));
  const values = observations.map(item => item.value).sort((a, b) => a - b);
  const count = values.length;
  const mean = count ? values.reduce((sum, value) => sum + value, 0) / count : null;
  const variance = count > 1
    ? values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (count - 1)
    : null;
  const standardDeviation = variance === null ? null : Math.sqrt(variance);
  const q1 = quantile(values, 0.25);
  const q3 = quantile(values, 0.75);
  const iqr = q1 === null || q3 === null ? null : q3 - q1;
  const lowerFence = count >= 4 ? q1 - (1.5 * iqr) : null;
  const upperFence = count >= 4 ? q3 + (1.5 * iqr) : null;
  const outliers = lowerFence === null ? [] : observations
    .filter(item => item.value < lowerFence || item.value > upperFence)
    .map(item => ({
      result_id: item.result_id,
      batch_code: item.batch_code,
      tested_at: item.tested_at,
      value: round(item.value),
      reason: `Outside the 1.5×IQR range (${round(lowerFence)}–${round(upperFence)})`,
    }));
  const degreesOfFreedom = count - 1;
  const critical = tCritical95(degreesOfFreedom);
  const margin = standardDeviation === null ? null : critical * standardDeviation / Math.sqrt(count);
  const bins = [
    { label: '0–<2', min: 0, max: 2 },
    { label: '2–<4', min: 2, max: 4 },
    { label: '4–<6', min: 4, max: 6 },
    { label: '6–<8', min: 6, max: 8 },
    { label: '8–10', min: 8, max: 10.000001 },
  ];

  return {
    key: attribute.key,
    label: attribute.label,
    count,
    missing: results.length - count,
    mean: round(mean),
    median: round(quantile(values, 0.5)),
    standard_deviation: round(standardDeviation),
    minimum: count ? round(values[0]) : null,
    maximum: count ? round(values.at(-1)) : null,
    confidence_interval_95: margin === null ? null : {
      lower: round(Math.max(0, mean - margin)),
      upper: round(Math.min(10, mean + margin)),
    },
    distribution: bins.map(bin => ({
      label: bin.label,
      count: values.filter(value => value >= bin.min && value < bin.max).length,
    })),
    outliers,
  };
}

function summarizeResult(result) {
  const scores = SENSORY_ATTRIBUTES
    .map(attribute => result.sensory?.[attribute.key])
    .filter(Number.isFinite);
  return {
    result_id: result.id,
    batch_code: result.batch_code || null,
    tested_at: result.tested_at,
    composite_score: scores.length
      ? round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
      : null,
    completed_attributes: scores.length,
    total_attributes: SENSORY_ATTRIBUTES.length,
    scores: Object.fromEntries(SENSORY_ATTRIBUTES.map(attribute => [
      attribute.key,
      Number.isFinite(result.sensory?.[attribute.key]) ? result.sensory[attribute.key] : null,
    ])),
  };
}

export function analyzeSensoryResults(results = []) {
  const validResults = results.filter(result => result && typeof result === 'object');
  const attributes = SENSORY_ATTRIBUTES.map(attribute => summarizeAttribute(validResults, attribute));
  const observations = validResults.map(summarizeResult);
  const observedScores = attributes.reduce((sum, attribute) => sum + attribute.count, 0);
  const expectedScores = validResults.length * SENSORY_ATTRIBUTES.length;
  const rankedBatches = observations
    .filter(item => item.composite_score !== null)
    .sort((a, b) => b.composite_score - a.composite_score || new Date(b.tested_at) - new Date(a.tested_at));
  const outlierCount = attributes.reduce((sum, attribute) => sum + attribute.outliers.length, 0);
  const warnings = [
    {
      code: 'aggregate_batch_scores',
      message: 'These analytics treat each saved laboratory result as one batch-level observation; they are not panelist-level sensory statistics.',
    },
  ];
  if (validResults.length === 0) warnings.push({ code: 'no_data', message: 'Add sensory results to calculate analytics.' });
  else if (validResults.length < 5) warnings.push({ code: 'small_sample', message: 'Fewer than five observations are available; estimates and confidence intervals are unstable.' });
  if (observedScores < expectedScores) warnings.push({ code: 'missing_scores', message: `${expectedScores - observedScores} sensory score(s) are missing.` });
  if (outlierCount > 0) warnings.push({ code: 'outliers_detected', message: `${outlierCount} explainable statistical outlier flag(s) require review.` });

  return {
    methodology: {
      observation_unit: 'laboratory_result',
      score_range: { minimum: 0, maximum: 10 },
      confidence_interval: 'Two-sided 95% Student t interval around the arithmetic mean; bounded to the 0–10 scale.',
      standard_deviation: 'Sample standard deviation (n−1 denominator).',
      outlier_rule: 'Tukey fences: values below Q1−1.5×IQR or above Q3+1.5×IQR; evaluated only with at least four observations.',
      composite_score: 'Unweighted arithmetic mean of the available sensory attributes for a laboratory result.',
    },
    coverage: {
      result_count: validResults.length,
      observed_scores: observedScores,
      expected_scores: expectedScores,
      completion_percent: expectedScores ? round((observedScores / expectedScores) * 100, 1) : 0,
    },
    attributes,
    ranked_batches: rankedBatches,
    trend: observations
      .filter(item => item.composite_score !== null)
      .sort((a, b) => new Date(a.tested_at) - new Date(b.tested_at)),
    warnings,
  };
}

export { SENSORY_ATTRIBUTES };
