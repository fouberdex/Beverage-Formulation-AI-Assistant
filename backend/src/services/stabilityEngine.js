export const STABILITY_ENGINE_VERSION = '1.0.0';

const round = (value, digits = 6) => Number(Number(value).toFixed(digits));

function regression(points) {
  if (points.length < 2) return { status: 'insufficient_data', slope_per_day: null, intercept: null, r_squared: null };
  const meanX = points.reduce((sum, item) => sum + item.day, 0) / points.length;
  const meanY = points.reduce((sum, item) => sum + item.value, 0) / points.length;
  const denominator = points.reduce((sum, item) => sum + (item.day - meanX) ** 2, 0);
  if (denominator === 0) return { status: 'insufficient_time_range', slope_per_day: null, intercept: null, r_squared: null };
  const slope = points.reduce((sum, item) => sum + (item.day - meanX) * (item.value - meanY), 0) / denominator;
  const intercept = meanY - slope * meanX;
  const residual = points.reduce((sum, item) => sum + (item.value - (intercept + slope * item.day)) ** 2, 0);
  const total = points.reduce((sum, item) => sum + (item.value - meanY) ** 2, 0);
  return { status: 'fitted', slope_per_day: round(slope), slope_per_30_days: round(slope * 30), intercept: round(intercept), r_squared: total === 0 ? 1 : round(1 - residual / total) };
}

function assess(value, baseline, parameter) {
  const failures = [];
  if (parameter.lower !== undefined && value < parameter.lower) failures.push(`below ${parameter.lower} ${parameter.unit}`);
  if (parameter.upper !== undefined && value > parameter.upper) failures.push(`above ${parameter.upper} ${parameter.unit}`);
  const absoluteChange = baseline === null ? null : value - baseline;
  if (parameter.max_change_from_baseline !== undefined && absoluteChange !== null && Math.abs(absoluteChange) > parameter.max_change_from_baseline) failures.push(`change exceeds ±${parameter.max_change_from_baseline} ${parameter.unit}`);
  return { status: failures.length ? 'fail' : 'pass', failures, absolute_change_from_baseline: absoluteChange === null ? null : round(absoluteChange), percent_change_from_baseline: baseline ? round(absoluteChange / baseline * 100) : null };
}

export function analyzeStabilityProgram(program, observations = [], specification = null) {
  const conditionResults = program.storage_conditions.map(condition => {
    const conditionObservations = observations.filter(item => item.condition_id === condition.id);
    const parameters = program.parameters.map(parameter => {
      const points = conditionObservations.filter(item => Number.isFinite(item.values?.[parameter.key]))
        .map(item => ({ day: item.timepoint_days, value: Number(item.values[parameter.key]), observation_id: item.id, laboratory_result_id: item.laboratory_result_id }))
        .sort((a, b) => a.day - b.day);
      const baselinePoint = points[0] || null; const baseline = baselinePoint?.value ?? null;
      const assessed = points.map(point => ({ ...point, ...assess(point.value, baseline, parameter) }));
      const firstFailure = assessed.find(point => point.status === 'fail') || null;
      return { key: parameter.key, label: parameter.label, unit: parameter.unit, baseline, baseline_day: baselinePoint?.day ?? null, points: assessed, trend: regression(points), first_observed_failure_day: firstFailure?.day ?? null, status: firstFailure ? 'fail' : points.length ? 'pass_to_date' : 'no_data' };
    });
    const expected = program.timepoints_days.length * (program.replicates_per_timepoint || 1);
    const observedSlots = new Set(conditionObservations.map(item => `${item.timepoint_days}:${item.replicate || 1}`));
    return { ...condition, expected_observations: expected, recorded_observations: conditionObservations.length, completion_percent: round(Math.min(100, observedSlots.size / expected * 100), 2), status: parameters.some(item => item.status === 'fail') ? 'fail' : conditionObservations.length >= expected ? 'complete_pass' : 'in_progress', parameters };
  });
  const specificationAssessment = specification ? specification.limits.map(limit => {
    const matching = observations.filter(item => Number.isFinite(item.values?.[limit.key]));
    const failures = matching.filter(item => assess(Number(item.values[limit.key]), null, limit).status === 'fail');
    return { key: limit.key, label: limit.label, evaluated_observations: matching.length, failed_observations: failures.length, status: failures.length ? 'fail' : matching.length ? 'pass_to_date' : 'not_evaluable' };
  }) : [];
  const failed = conditionResults.some(item => item.status === 'fail');
  const complete = conditionResults.length > 0 && conditionResults.every(item => item.status === 'complete_pass');
  return {
    engine_version: STABILITY_ENGINE_VERSION,
    program_id: program.id,
    formulation_version_id: program.formulation_version_id,
    observation_count: observations.length,
    overall_status: failed ? 'fail' : complete ? 'complete_pass' : observations.length ? 'in_progress' : 'no_data',
    conditions: conditionResults,
    specification: specification ? { id: specification.id, version: specification.version, status: specification.status, limits: specificationAssessment } : null,
    conclusion: failed ? 'At least one observed result is outside a declared acceptance limit.' : complete ? 'All scheduled observations are recorded and pass the declared limits.' : 'The program is incomplete; no unmeasured shelf-life claim is made.',
    extrapolation: { performed: false, reason: 'Shelf-life is never extrapolated automatically from this screening trend.' },
  };
}
