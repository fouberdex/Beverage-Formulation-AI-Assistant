export const INDUSTRIAL_QUALITY_ENGINE_VERSION = '1.0.0';
const round = (value, digits = 3) => Number(Number(value).toFixed(digits));

export function analyzeProductionTrial(trial) {
  const planned = Number(trial.planned_batch_size_liters || 0);
  const output = Number(trial.saleable_output_liters || 0);
  const rejected = Number(trial.rejected_output_liters || 0);
  const accounted = output + rejected;
  const processParameters = (trial.process_parameters || []).map(parameter => {
    const actual = Number(parameter.actual);
    const passes = Number.isFinite(actual) && (parameter.lower === undefined || actual >= parameter.lower) && (parameter.upper === undefined || actual <= parameter.upper);
    return { ...parameter, actual, status: passes ? 'pass' : 'fail' };
  });
  const warnings = [];
  if (planned > 0 && accounted > planned * 1.02) warnings.push('Recorded saleable and rejected output exceeds planned batch input by more than 2%.');
  if (processParameters.some(item => item.status === 'fail')) warnings.push('At least one critical process parameter is outside its signed range.');
  return {
    engine_version: INDUSTRIAL_QUALITY_ENGINE_VERSION,
    production_trial_id: trial.id,
    mass_balance: {
      planned_batch_size_liters: planned,
      saleable_output_liters: output,
      rejected_output_liters: rejected,
      unaccounted_loss_liters: round(Math.max(0, planned - accounted)),
      yield_percent: planned ? round(output / planned * 100, 2) : 0,
      reject_percent: planned ? round(rejected / planned * 100, 2) : 0,
      scale_factor: Number(trial.reference_batch_size_liters) > 0 ? round(planned / trial.reference_batch_size_liters, 2) : null,
    },
    process_parameters: processParameters,
    status: warnings.length ? 'review_required' : 'within_recorded_controls',
    warnings,
  };
}

export function evaluateQcRelease(specification, laboratoryResults) {
  if (!specification || specification.status !== 'approved') return { engine_version: INDUSTRIAL_QUALITY_ENGINE_VERSION, disposition: 'hold', reason: 'An approved product specification is required.', checks: [] };
  const checks = specification.limits.map(limit => {
    const observations = laboratoryResults.map(result => ({ laboratory_result_id: result.id, value: result[limit.source]?.[limit.key] })).filter(item => Number.isFinite(item.value));
    const failures = observations.filter(item => (limit.lower !== undefined && item.value < limit.lower) || (limit.upper !== undefined && item.value > limit.upper));
    return { key: limit.key, label: limit.label, unit: limit.unit, lower: limit.lower ?? null, upper: limit.upper ?? null, observation_count: observations.length, observations, failure_count: failures.length, status: observations.length === 0 ? 'not_evaluated' : failures.length ? 'fail' : 'pass' };
  });
  const disposition = checks.some(item => item.status === 'fail') ? 'out_of_specification' : checks.some(item => item.status === 'not_evaluated') ? 'hold' : 'eligible_for_release';
  return { engine_version: INDUSTRIAL_QUALITY_ENGINE_VERSION, specification_id: specification.id, specification_version: specification.version, laboratory_result_count: laboratoryResults.length, disposition, reason: disposition === 'eligible_for_release' ? 'Every approved specification limit was evaluated and passed.' : disposition === 'out_of_specification' ? 'At least one observed value failed an approved limit.' : 'At least one approved limit has no laboratory observation.', checks };
}
