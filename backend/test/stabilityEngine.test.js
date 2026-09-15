import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeStabilityProgram } from '../src/services/stabilityEngine.js';

const program = {
  id: 'program-1', formulation_version_id: 'form-1', replicates_per_timepoint: 1, timepoints_days: [0, 30, 90],
  storage_conditions: [{ id: 'ambient', label: 'Ambient', temperature_c: 25, light_exposure: 'dark' }],
  parameters: [
    { key: 'ph', label: 'pH', source: 'measurements', unit: 'pH', lower: 2.8, upper: 3.5, max_change_from_baseline: 0.2 },
    { key: 'turbidity', label: 'Turbidity', source: 'measurements', unit: 'NTU', upper: 20 },
  ],
};

test('stability analysis calculates deterministic trends and never extrapolates shelf life', () => {
  const observations = [
    { id: 'o1', condition_id: 'ambient', timepoint_days: 0, replicate: 1, values: { ph: 3.2, turbidity: 5 } },
    { id: 'o2', condition_id: 'ambient', timepoint_days: 30, replicate: 1, values: { ph: 3.1, turbidity: 8 } },
  ];
  const result = analyzeStabilityProgram(program, observations);
  assert.equal(result.overall_status, 'in_progress');
  assert.equal(result.conditions[0].parameters[0].trend.slope_per_30_days, -0.1);
  assert.equal(result.conditions[0].parameters[0].status, 'pass_to_date');
  assert.equal(result.extrapolation.performed, false);
  assert.match(result.conclusion, /incomplete/i);
});

test('stability analysis flags the first observed limit failure and evaluates an approved specification', () => {
  const observations = [
    { id: 'o1', condition_id: 'ambient', timepoint_days: 0, replicate: 1, values: { ph: 3.2, turbidity: 5 } },
    { id: 'o2', condition_id: 'ambient', timepoint_days: 30, replicate: 1, values: { ph: 2.9, turbidity: 25 } },
    { id: 'o3', condition_id: 'ambient', timepoint_days: 90, replicate: 1, values: { ph: 2.7, turbidity: 30 } },
  ];
  const specification = { id: 'spec-1', version: 1, status: 'approved', limits: [{ key: 'ph', label: 'Finished pH', source: 'measurements', unit: 'pH', lower: 2.8, upper: 3.5 }] };
  const result = analyzeStabilityProgram(program, observations, specification);
  assert.equal(result.overall_status, 'fail');
  assert.equal(result.conditions[0].parameters[0].first_observed_failure_day, 30);
  assert.equal(result.specification.limits[0].failed_observations, 1);
  assert.equal(result.specification.limits[0].status, 'fail');
});
