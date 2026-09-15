import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDoeDesign, generateDoeDesign } from '../src/services/doeEngine.js';

const input = {
  type: 'full_factorial', center_points: 1, replicates: 1,
  factors: [
    { key: 'acid', label: 'Citric acid', low: 0.1, high: 0.3, unit: '%' },
    { key: 'temperature', label: 'Pasteurization temperature', low: 75, high: 85, unit: '°C' },
  ],
  responses: [{ key: 'liking', label: 'Overall liking', goal: 'maximize', unit: '/10' }],
};

test('DOE generation is deterministic, signed and includes factorial plus centre runs', () => {
  const first = generateDoeDesign(input); const second = generateDoeDesign(input);
  assert.equal(first.signature, second.signature);
  assert.deepEqual(first.runs.map(run => run.factor_settings), second.runs.map(run => run.factor_settings));
  assert.equal(first.run_count, 5);
  assert.deepEqual(first.runs[4].factor_settings, {
    acid: { coded: 0, value: 0.2, unit: '%' },
    temperature: { coded: 0, value: 80, unit: '°C' },
  });
});

test('DOE analysis fits recorded results and recommends only an unexecuted design run', () => {
  const design = generateDoeDesign(input);
  const batches = design.runs.slice(0, 4).map((run, index) => ({
    id: `batch-${index}`, doe_run_id: run.id, response_values: { liking: 6 + 0.8 * run.factor_settings.acid.coded + 0.3 * run.factor_settings.temperature.coded },
  }));
  const result = analyzeDoeDesign(design, batches);
  assert.equal(result.models.liking.status, 'fitted');
  assert.ok(result.models.liking.diagnostics.r_squared > 0.99);
  assert.equal(result.next_run.run_id, design.runs[4].id);
  assert.equal(result.next_run.basis, 'fitted_recorded_data');
  assert.equal(result.applicability.inferential_claims_allowed, false);
});
