import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLabelStabilityEvidence } from '../src/services/labelStabilityEvidence.js';

const program = {
  id: 'program-1', formulation_version_id: 'version-1', name: 'Ambient program', status: 'completed',
  storage_conditions: [{ id: 'ambient', label: 'Ambient', temperature_c: 25 }],
  timepoints_days: [0, 30, 90], replicates_per_timepoint: 1,
  parameters: [{ key: 'ph', label: 'pH', source: 'measurements', unit: 'pH', lower: 2.8, upper: 3.5 }],
};
const observations = [0, 30, 90].map(day => ({
  id: `observation-${day}`, program_id: program.id, formulation_version_id: 'version-1', condition_id: 'ambient',
  timepoint_days: day, replicate: 1, values: { ph: 3.2 },
}));

test('label evidence distinguishes observed coverage from completed passing coverage', () => {
  const incomplete = buildLabelStabilityEvidence({
    formulationVersionId: 'version-1', requestedShelfLifeMonths: 3,
    programs: [{ ...program, status: 'running' }], observations,
  });
  assert.equal(incomplete.observed_coverage_days, 90);
  assert.equal(incomplete.validated_coverage_days, 0);
  assert.equal(incomplete.status, 'not_substantiated');
  assert.equal(incomplete.review_gate.status, 'blocked');

  const complete = buildLabelStabilityEvidence({
    formulationVersionId: 'version-1', requestedShelfLifeMonths: 3, programs: [program], observations,
  });
  assert.equal(complete.validated_coverage_days, 90);
  assert.equal(complete.status, 'substantiated');
  assert.equal(complete.review_gate.status, 'eligible_after_regulatory_review');
  assert.deepEqual(complete.evidence_refs.observation_ids, observations.map(item => item.id));
});

test('label evidence never combines another formulation version or a failed program', () => {
  const failedObservations = observations.map(item => item.timepoint_days === 90 ? { ...item, values: { ph: 3.8 } } : item);
  const result = buildLabelStabilityEvidence({
    formulationVersionId: 'version-1', requestedShelfLifeMonths: 2, programs: [program, { ...program, id: 'other', formulation_version_id: 'version-2' }],
    observations: [...failedObservations, { ...observations[2], id: 'other-observation', program_id: 'other', formulation_version_id: 'version-2', timepoint_days: 365 }],
  });
  assert.equal(result.observed_coverage_days, 90);
  assert.equal(result.validated_coverage_days, 0);
  assert.equal(result.status, 'not_substantiated');
  assert.equal(result.gap_days, 60);
});

test('unavailable stability storage blocks review without pretending the evidence set is empty', () => {
  const result = buildLabelStabilityEvidence({
    formulationVersionId: 'version-1', requestedShelfLifeMonths: 1,
    programs: [program], observations, evidenceStorageAvailable: false,
  });
  assert.equal(result.status, 'evidence_storage_unavailable');
  assert.equal(result.review_gate.status, 'blocked');
  assert.match(result.review_gate.reason, /unavailable/i);
});
