import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeProductionTrial, evaluateQcRelease } from '../src/services/industrialQualityEngine.js';

test('production trial analysis calculates yield, losses and process exceptions', () => {
  const analysis = analyzeProductionTrial({ id: 'trial', planned_batch_size_liters: 1000, reference_batch_size_liters: 20, saleable_output_liters: 940, rejected_output_liters: 20, process_parameters: [{ key: 'temperature', label: 'Pasteurization', unit: '°C', lower: 82, upper: 86, actual: 84 }] });
  assert.equal(analysis.mass_balance.yield_percent, 94);
  assert.equal(analysis.mass_balance.unaccounted_loss_liters, 40);
  assert.equal(analysis.mass_balance.scale_factor, 50);
  assert.equal(analysis.status, 'within_recorded_controls');
});

test('QC disposition is deterministic from approved limits and laboratory evidence', () => {
  const spec = { id: 'spec', version: 2, status: 'approved', limits: [{ key: 'ph', label: 'pH', unit: 'pH', source: 'measurements', lower: 2.8, upper: 3.5 }] };
  assert.equal(evaluateQcRelease(spec, [{ id: 'lab-1', measurements: { ph: 3.2 } }]).disposition, 'eligible_for_release');
  assert.equal(evaluateQcRelease(spec, [{ id: 'lab-2', measurements: { ph: 3.8 } }]).disposition, 'out_of_specification');
  assert.equal(evaluateQcRelease(spec, [{ id: 'lab-3', measurements: {} }]).disposition, 'hold');
});
