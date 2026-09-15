import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectDevelopmentState, selectTargetFormulationVersion } from '../src/services/projectStateEngine.js';

const project = { id: 'p1', brief_status: 'validated' };

test('target formulation selection prefers an approved version under active evaluation', () => {
  const formulations = [
    { id: 'f1', version: 1, status: 'approved' },
    { id: 'f2', version: 2, status: 'approved' },
    { id: 'f3', version: 3, status: 'draft' },
  ];
  assert.equal(selectTargetFormulationVersion({ formulations, experimental_plans: [{ id: 'e1', formulation_version_id: 'f1', status: 'running' }] }).id, 'f1');
  assert.equal(selectTargetFormulationVersion({ formulations }).id, 'f2');
  assert.equal(selectTargetFormulationVersion({ formulations, production_trials: [{ id: 't1', formulation_version_id: 'f3', status: 'running' }] }).id, 'f2');
});

test('development state never combines evidence from different formulation versions', () => {
  const state = buildProjectDevelopmentState(project, {
    formulations: [{ id: 'f1', version: 1, status: 'approved' }, { id: 'f2', version: 2, status: 'approved' }],
    experimental_plans: [{ id: 'e2', formulation_version_id: 'f2', status: 'running' }],
    pilot_batches: [{ id: 'b1', formulation_version_id: 'f1', status: 'completed' }],
    laboratory_results: [{ id: 'l1', formulation_version_id: 'f1' }],
    sensory_studies: [{ id: 's1', formulation_version_ids: ['f1'], status: 'completed' }],
    stability_programs: [{ id: 'st1', formulation_version_id: 'f1', status: 'completed' }],
    decisions: [{ id: 'd1', formulation_version_id: 'f1', outcome: 'go' }],
    product_specifications: [{ id: 'sp1', formulation_version_id: 'f1', status: 'approved' }],
    packaging_configurations: [{ id: 'pk1', formulation_version_id: 'f1', status: 'approved' }],
    production_trials: [{ id: 't1', formulation_version_id: 'f1', status: 'completed' }],
    qc_releases: [{ id: 'q1', production_trial_id: 't1', specification_id: 'sp1', laboratory_result_ids: ['l1'], disposition: 'released' }],
  });
  assert.equal(state.target_formulation_version_id, 'f2');
  assert.deepEqual(state.evidence_chain.laboratory_results, []);
  assert.deepEqual(state.evidence_chain.qc_releases, []);
  assert.equal(state.current_stage, 'pilot');
  assert.equal(state.next_controlled_action.key, 'pilot_evidence');
  assert.equal(state.release_eligible, false);
  assert.notEqual(state.readiness.status, 'evidence_complete');
});

test('release eligibility requires a coherent exact-version chain and ignores unrelated quality events', () => {
  const state = buildProjectDevelopmentState(project, {
    formulations: [{ id: 'f2', version: 2, status: 'approved' }, { id: 'f1', version: 1, status: 'approved' }],
    experimental_plans: [{ id: 'e2', formulation_version_id: 'f2', status: 'completed' }],
    pilot_batches: [{ id: 'b2', formulation_version_id: 'f2', status: 'completed' }],
    laboratory_results: [{ id: 'l2', formulation_version_id: 'f2' }],
    sensory_studies: [{ id: 's2', formulation_version_ids: ['f2'], status: 'completed' }],
    stability_programs: [{ id: 'st2', formulation_version_id: 'f2', status: 'completed' }],
    decisions: [{ id: 'd2', formulation_version_id: 'f2', outcome: 'go' }],
    product_specifications: [{ id: 'sp2', formulation_version_id: 'f2', status: 'approved' }],
    packaging_configurations: [{ id: 'pk2', formulation_version_id: 'f2', status: 'approved' }],
    production_trials: [{ id: 't2', formulation_version_id: 'f2', status: 'completed' }, { id: 't1', formulation_version_id: 'f1', status: 'completed' }],
    quality_events: [{ id: 'qe1', production_trial_id: 't1', status: 'open', severity: 'critical', event_type: 'deviation', title: 'Unrelated v1 event' }],
  });
  assert.equal(state.target_formulation_version_id, 'f2');
  assert.equal(state.release_eligible, true);
  assert.equal(state.current_stage, 'qc_release');
  assert.deepEqual(state.blockers, []);
});

test('only an explicit target-version rework decision requires reformulation', () => {
  const state = buildProjectDevelopmentState(project, {
    formulations: [{ id: 'f2', version: 2, status: 'approved' }],
    experimental_plans: [{ id: 'e2', formulation_version_id: 'f2', status: 'running' }],
    pilot_batches: [{ id: 'b2', formulation_version_id: 'f2', status: 'rejected' }],
    decisions: [{ id: 'd2', formulation_version_id: 'f2', outcome: 'rework', rationale: 'Revise the acid system before another trial.' }],
  });
  assert.equal(state.reformulation_required.required, true);
  assert.equal(state.reformulation_required.trigger, 'explicit_rework_decision');
  assert.equal(state.reformulation_required.recommended_path, 'formulation_review');
  assert.deepEqual(state.reformulation_required.entity_ids, ['d2']);
  assert.equal(state.current_stage, 'formulation_review');
  assert.equal(state.next_controlled_action.key, 'reformulation_review');
  assert.ok(state.blockers.some(item => item.code === 'REFORMULATION_REQUIRED' && item.entity_id === 'd2'));
});

test('a rejected pilot or packaging warning does not automatically require reformulation', () => {
  const rejectedPilot = buildProjectDevelopmentState(project, {
    formulations: [{ id: 'f2', version: 2, status: 'approved' }],
    experimental_plans: [{ id: 'e2', formulation_version_id: 'f2', status: 'running' }],
    pilot_batches: [{ id: 'b2', formulation_version_id: 'f2', status: 'rejected' }],
  });
  assert.equal(rejectedPilot.reformulation_required.required, false);
  assert.equal(rejectedPilot.reformulation_required.trigger, 'pilot_rejection');
  assert.equal(rejectedPilot.reformulation_required.recommended_path, 'pilot_investigation');

  const packagingWarning = buildProjectDevelopmentState(project, {
    formulations: [{ id: 'f2', version: 2, status: 'approved' }],
    packaging_configurations: [{ id: 'pk2', formulation_version_id: 'f2', status: 'draft', analysis: { readiness: 'review_required', warnings: ['Stability coverage is insufficient.'] } }],
  });
  assert.equal(packagingWarning.reformulation_required.required, false);
  assert.equal(packagingWarning.reformulation_required.trigger, 'packaging_issue');
  assert.equal(packagingWarning.reformulation_required.recommended_path, 'packaging_review');
});

test('an observed stability limit failure blocks progression without inventing a reformulation decision', () => {
  const state = buildProjectDevelopmentState(project, {
    formulations: [{ id: 'f2', version: 2, status: 'approved' }],
    stability_programs: [{
      id: 'st2', formulation_version_id: 'f2', name: 'Ambient study', status: 'completed',
      storage_conditions: [{ id: 'ambient', label: 'Ambient', temperature_c: 25 }],
      timepoints_days: [0, 30], replicates_per_timepoint: 1,
      parameters: [{ key: 'ph', label: 'pH', unit: 'pH', lower: 2.8, upper: 3.5 }],
    }],
    stability_observations: [
      { id: 'o1', program_id: 'st2', formulation_version_id: 'f2', condition_id: 'ambient', timepoint_days: 0, replicate: 1, values: { ph: 3.2 } },
      { id: 'o2', program_id: 'st2', formulation_version_id: 'f2', condition_id: 'ambient', timepoint_days: 30, replicate: 1, values: { ph: 3.7 } },
    ],
  });
  assert.equal(state.reformulation_required.required, false);
  assert.equal(state.reformulation_required.trigger, 'stability_failure');
  assert.equal(state.reformulation_required.recommended_path, 'stability_investigation');
  assert.equal(state.current_stage, 'stability');
  assert.equal(state.next_controlled_action.key, 'stability_review');
  assert.equal(state.readiness.gates.find(item => item.key === 'stability_evidence').status, 'missing');
  assert.ok(state.blockers.some(item => item.code === 'STABILITY_LIMIT_FAILURE' && item.entity_id === 'st2'));
});
