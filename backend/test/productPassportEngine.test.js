import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProductPassport, structuredWorkspaceSearch } from '../src/services/productPassportEngine.js';

test('product passport calculates readiness and exact evidence links deterministically', () => {
  const passport = buildProductPassport({ id:'p1',code:'RD-1',name:'Citrus',stage:'industrialization',status:'active',brief_status:'validated',target_market:'Algeria',beverage_category:'soft drink' }, {
    formulations:[{id:'f1',code:'F-1',name:'Citrus',version:2,status:'approved'}], laboratory_results:[{id:'l1',formulation_version_id:'f1',batch_code:'LAB-1'}], sensory_studies:[{id:'s1',name:'Consumer',status:'completed',formulation_version_ids:['f1']}],
    pilot_batches:[{id:'b1',experimental_plan_id:'e1',formulation_version_id:'f1',batch_code:'P-1',status:'completed'}], product_specifications:[{id:'sp1',formulation_version_id:'f1',name:'Finished',version:1,status:'approved'}], packaging_configurations:[{id:'pk1',formulation_version_id:'f1',name:'PET',version:1,status:'approved'}],
    production_trials:[{id:'t1',formulation_version_id:'f1',packaging_configuration_id:'pk1',batch_code:'T-1',status:'completed'}], qc_releases:[{id:'q1',production_trial_id:'t1',specification_id:'sp1',laboratory_result_ids:['l1'],disposition:'released'}], quality_events:[],
  });
  assert.equal(passport.readiness.status, 'evidence_complete');
  assert.equal(passport.readiness.score_percent, 100);
  assert.ok(passport.graph.edges.some(edge => edge.from === 'laboratory_result:l1' && edge.to === 'qc_release:q1' && edge.relation === 'evidence_for'));
});

test('structured search requires every term and returns only sanitized records', () => {
  const records=[{id:'1',type:'formulation',title:'Citrus launch formula',subtitle:'F-001',project_id:'p1'},{id:'2',type:'document',title:'Berry specification',subtitle:'Citrus unrelated',project_id:'p2'}];
  const result=structuredWorkspaceSearch('citrus launch',records);
  assert.deepEqual(result.map(item=>item.id),['1']);
  assert.equal(result[0].payload, undefined);
});
