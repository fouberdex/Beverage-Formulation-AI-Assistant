import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProductPassport, structuredWorkspaceSearch } from '../src/services/productPassportEngine.js';
import { buildProjectDevelopmentState } from '../src/services/projectStateEngine.js';

test('product passport calculates readiness and exact evidence links deterministically', () => {
  const project = { id:'p1',code:'RD-1',name:'Citrus',stage:'industrialization',status:'active',brief_status:'validated',target_market:'Algeria',beverage_category:'soft drink' };
  const trace = {
    formulations:[{id:'f1',code:'F-1',name:'Citrus',version:2,status:'approved'}],
    experimental_plans:[{id:'e1',formulation_version_id:'f1',name:'Pilot plan',status:'ready'}],
    pilot_batches:[{id:'b1',experimental_plan_id:'e1',formulation_version_id:'f1',batch_code:'P-1',status:'completed'}],
    laboratory_results:[{id:'l1',formulation_version_id:'f1',batch_code:'LAB-1'}],
    sensory_studies:[{id:'s1',name:'Consumer',status:'completed',formulation_version_ids:['f1']}],
    stability_programs:[{id:'st1',formulation_version_id:'f1',name:'Ambient',status:'completed'}],
    decisions:[{id:'d1',formulation_version_id:'f1',title:'Release candidate',outcome:'go'}],
    product_specifications:[{id:'sp1',formulation_version_id:'f1',name:'Finished',version:1,status:'approved'}],
    specification_approvals:[{id:'spa1',specification_id:'sp1',outcome:'approved'}],
    packaging_configurations:[{id:'pk1',formulation_version_id:'f1',name:'PET',version:1,status:'approved'}],
    production_trials:[{id:'t1',formulation_version_id:'f1',packaging_configuration_id:'pk1',batch_code:'T-1',status:'completed'}],
    qc_releases:[{id:'q1',production_trial_id:'t1',specification_id:'sp1',laboratory_result_ids:['l1'],disposition:'released'}],
    quality_events:[], capa_actions:[],
  };
  const state = buildProjectDevelopmentState(project, trace);
  const passport = buildProductPassport(project, trace, state);
  assert.equal(passport.engine_version, '2.0.0');
  assert.equal(passport.formulation_version_id, 'f1');
  assert.equal(passport.formulation_version, 2);
  assert.equal(passport.readiness.status, 'evidence_complete');
  assert.equal(passport.readiness.score_percent, 100);
  assert.ok(passport.readiness.gates.every(gate => gate.status === 'pass' && typeof gate.explanation === 'string'));
  assert.deepEqual(passport.evidence_chain.specification_approvals, ['spa1']);
  assert.ok(passport.graph.edges.some(edge => edge.from === 'laboratory_result:l1' && edge.to === 'qc_release:q1' && edge.relation === 'evidence_for'));
});

test('product passport excludes evidence belonging to other formulation versions', () => {
  const project = { id:'p1',code:'RD-1',name:'Citrus',stage:'laboratory',status:'active',brief_status:'validated',target_market:'Algeria',beverage_category:'soft drink' };
  const trace = {
    formulations:[
      {id:'f1',code:'F-1',name:'Citrus',version:1,status:'approved'},
      {id:'f2',code:'F-1',name:'Citrus',version:2,status:'approved'},
      {id:'f3',code:'F-1',name:'Citrus',version:3,status:'draft'},
    ],
    experimental_plans:[{id:'e2',formulation_version_id:'f2',name:'Active v2',status:'running'}],
    laboratory_results:[{id:'l1',formulation_version_id:'f1',batch_code:'LAB-v1'}],
    sensory_studies:[{id:'s2',name:'Sensory v2',status:'completed',formulation_version_ids:['f2']}],
    product_specifications:[{id:'sp3',formulation_version_id:'f3',name:'Spec v3',version:1,status:'approved'}],
    specification_approvals:[{id:'spa3',specification_id:'sp3',outcome:'approved'}],
    packaging_configurations:[{id:'pk1',formulation_version_id:'f1',name:'PET v1',version:1,status:'approved'}],
    production_trials:[], qc_releases:[], quality_events:[], capa_actions:[],
  };
  const state = buildProjectDevelopmentState(project, trace);
  const passport = buildProductPassport(project, trace, state);
  const graphIds = passport.graph.nodes.map(node => node.id);
  assert.equal(passport.formulation_version_id, 'f2');
  assert.equal(passport.readiness.status, 'in_progress');
  assert.equal(passport.summary.formulations, 1);
  assert.equal(passport.summary.sensory_studies, 1);
  assert.equal(passport.summary.laboratory_results, 0);
  assert.equal(passport.summary.product_specifications, 0);
  assert.equal(passport.summary.specification_approvals, 0);
  assert.ok(graphIds.includes('formulation:f2'));
  assert.ok(graphIds.includes('sensory_study:s2'));
  assert.ok(!graphIds.includes('formulation:f1'));
  assert.ok(!graphIds.includes('formulation:f3'));
  assert.ok(!graphIds.includes('laboratory_result:l1'));
  assert.ok(!graphIds.includes('product_specification:sp3'));
  assert.equal(passport.readiness.gates.find(gate => gate.key === 'laboratory_evidence').status, 'missing');
});

test('structured search requires every term and returns only sanitized records', () => {
  const records=[{id:'1',type:'formulation',title:'Citrus launch formula',subtitle:'F-001',project_id:'p1'},{id:'2',type:'document',title:'Berry specification',subtitle:'Citrus unrelated',project_id:'p2'}];
  const result=structuredWorkspaceSearch('citrus launch',records);
  assert.deepEqual(result.map(item=>item.id),['1']);
  assert.equal(result[0].payload, undefined);
});
