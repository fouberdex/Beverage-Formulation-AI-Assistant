import { buildProjectDevelopmentState } from './projectStateEngine.js';

export const PRODUCT_PASSPORT_ENGINE_VERSION = '2.0.0';

const list = (trace, key) => Array.isArray(trace?.[key]) ? trace[key] : [];
const nodeId = (type, id) => `${type}:${id}`;
const idSet = values => new Set(Array.isArray(values) ? values : []);

const gateExplanations = {
  validated_brief: 'The structured R&D brief is validated for this project.',
  approved_formulation: 'The selected target formulation version is approved and controlled.',
  experimental_plan: 'At least one non-cancelled experimental plan references the selected version.',
  pilot_evidence: 'At least one completed pilot batch references the selected version.',
  laboratory_evidence: 'Laboratory results explicitly reference the selected version.',
  sensory_evidence: 'At least one completed sensory study includes the selected version.',
  stability_evidence: 'At least one completed stability program references the selected version.',
  go_decision: 'A recorded Go decision explicitly references the selected version.',
  approved_specification: 'An approved product specification references the selected version.',
  approved_packaging: 'An approved packaging configuration references the selected version.',
  completed_scale_up: 'A completed production trial references the selected version.',
  released_qc: 'A released QC decision references a target-version trial, specification and laboratory evidence only.',
  quality_clearance: 'No unresolved quality event, CAPA, adverse QC disposition or cross-version QC evidence blocks this version.',
};

function exactRecords(trace, evidenceChain, key) {
  const allowed = idSet(evidenceChain[key]);
  return list(trace, key).filter(item => allowed.has(item.id));
}

export function buildProductPassport(project, inputTraceability, inputDevelopmentState) {
  const trace = inputTraceability || {};
  const developmentState = inputDevelopmentState || buildProjectDevelopmentState(project, trace);
  const evidenceChain = developmentState.evidence_chain || {};
  const targetId = developmentState.target_formulation_version_id;
  const target = list(trace, 'formulations').find(item => item.id === targetId) || null;
  const exact = key => exactRecords(trace, evidenceChain, key);
  const records = {
    formulations: target ? [target] : [],
    experimental_plans: exact('experimental_plans'),
    pilot_batches: exact('pilot_batches'),
    laboratory_results: exact('laboratory_results'),
    sensory_studies: exact('sensory_studies'),
    stability_programs: exact('stability_programs'),
    stability_observations: exact('stability_observations'),
    decisions: exact('decisions'),
    product_specifications: exact('product_specifications'),
    documents: exact('documents'),
    packaging_configurations: exact('packaging_configurations'),
    production_trials: exact('production_trials'),
    qc_releases: exact('qc_releases'),
    quality_events: exact('quality_events'),
    capa_actions: exact('capa_actions'),
  };
  const specificationIds = idSet(records.product_specifications.map(item => item.id));
  records.specification_approvals = list(trace, 'specification_approvals').filter(item => specificationIds.has(item.specification_id));

  const nodes = [{ id: nodeId('project', project.id), entity_type: 'project', entity_id: project.id, label: `${project.code} · ${project.name}`, status: project.status }];
  const edges = [];
  const includedNodes = new Set(nodes.map(item => item.id));
  const add = (type, item, label, status = '') => {
    const id = nodeId(type, item.id);
    if (!includedNodes.has(id)) {
      nodes.push({ id, entity_type: type, entity_id: item.id, label, status });
      includedNodes.add(id);
    }
  };
  const link = (fromType, fromId, toType, toId, relation) => {
    const from = nodeId(fromType, fromId);
    const to = nodeId(toType, toId);
    if (fromId && toId && includedNodes.has(from) && includedNodes.has(to)) edges.push({ from, to, relation });
  };
  const linkProject = (type, item) => link('project', project.id, type, item.id, 'contains');

  records.formulations.forEach(item => add('formulation', item, `${item.code} · ${item.name} · v${item.version}`, item.status));
  records.experimental_plans.forEach(item => add('experimental_plan', item, item.name, item.status));
  records.pilot_batches.forEach(item => add('pilot_batch', item, item.batch_code, item.status));
  records.laboratory_results.forEach(item => add('laboratory_result', item, item.batch_code || `Laboratory ${item.id}`, 'recorded'));
  records.sensory_studies.forEach(item => add('sensory_study', item, item.name, item.status));
  records.stability_programs.forEach(item => add('stability_program', item, item.name, item.status));
  records.stability_observations.forEach(item => add('stability_observation', item, `${item.condition_id} · day ${item.timepoint_days}`, 'recorded'));
  records.decisions.forEach(item => add('decision', item, item.title, item.outcome));
  records.product_specifications.forEach(item => add('product_specification', item, `${item.name} · rev ${item.version}`, item.status));
  records.specification_approvals.forEach(item => add('specification_approval', item, `Specification · ${item.outcome}`, item.outcome));
  records.documents.forEach(item => add('document', item, item.title, item.review_status));
  records.packaging_configurations.forEach(item => add('packaging_configuration', item, `${item.name} · rev ${item.version}`, item.status));
  records.production_trials.forEach(item => add('production_trial', item, item.batch_code, item.status));
  records.qc_releases.forEach(item => add('qc_release', item, `QC · ${item.disposition}`, item.disposition));
  records.quality_events.forEach(item => add('quality_event', item, item.title, item.status));
  records.capa_actions.forEach(item => add('capa', item, item.title, item.status));

  records.formulations.forEach(item => linkProject('formulation', item));
  records.experimental_plans.forEach(item => link('formulation', item.formulation_version_id, 'experimental_plan', item.id, 'tested_under'));
  records.pilot_batches.forEach(item => { link('experimental_plan', item.experimental_plan_id, 'pilot_batch', item.id, 'executed_as'); link('formulation', item.formulation_version_id, 'pilot_batch', item.id, 'produced_as'); });
  records.laboratory_results.forEach(item => link('formulation', item.formulation_version_id, 'laboratory_result', item.id, 'tested_by'));
  records.sensory_studies.forEach(item => (item.formulation_version_ids || []).filter(id => id === targetId).forEach(id => link('formulation', id, 'sensory_study', item.id, 'evaluated_by')));
  records.stability_programs.forEach(item => link('formulation', item.formulation_version_id, 'stability_program', item.id, 'monitored_by'));
  records.stability_observations.forEach(item => { link('stability_program', item.program_id, 'stability_observation', item.id, 'observed_as'); link('laboratory_result', item.laboratory_result_id, 'stability_observation', item.id, 'measured_by'); });
  records.decisions.forEach(item => { linkProject('decision', item); link('formulation', item.formulation_version_id, 'decision', item.id, 'governed_by'); });
  records.product_specifications.forEach(item => link('formulation', item.formulation_version_id, 'product_specification', item.id, 'controlled_by'));
  records.specification_approvals.forEach(item => link('product_specification', item.specification_id, 'specification_approval', item.id, 'approved_by'));
  records.documents.forEach(item => link('formulation', item.formulation_version_id, 'document', item.id, 'supported_by'));
  records.packaging_configurations.forEach(item => link('formulation', item.formulation_version_id, 'packaging_configuration', item.id, 'packed_as'));
  records.production_trials.forEach(item => { link('formulation', item.formulation_version_id, 'production_trial', item.id, 'scaled_as'); link('packaging_configuration', item.packaging_configuration_id, 'production_trial', item.id, 'used_by'); });
  records.qc_releases.forEach(item => { link('production_trial', item.production_trial_id, 'qc_release', item.id, 'disposed_by'); link('product_specification', item.specification_id, 'qc_release', item.id, 'evaluated_in'); (item.laboratory_result_ids || []).forEach(id => link('laboratory_result', id, 'qc_release', item.id, 'evidence_for')); });
  records.quality_events.forEach(item => { link('production_trial', item.production_trial_id, 'quality_event', item.id, 'raised'); link('qc_release', item.qc_release_id, 'quality_event', item.id, 'raised'); });
  records.capa_actions.forEach(item => link('quality_event', item.quality_event_id, 'capa', item.id, 'addressed_by'));

  const gates = developmentState.readiness.gates.map(item => {
    const blocked = item.key === 'quality_clearance' && developmentState.blockers.length > 0;
    const status = blocked ? 'blocked' : item.status;
    const explanation = status === 'pass'
      ? gateExplanations[item.key]
      : status === 'blocked'
        ? `${developmentState.blockers.length} unresolved exact-version quality blocker(s) prevent clearance.`
        : `${gateExplanations[item.key] || item.label} Required evidence is missing for the selected version.`;
    return { key: item.key, label: item.label, status, entity_ids: [...item.entity_ids], explanation };
  });

  const passportEvidenceChain = {
    ...Object.fromEntries(Object.entries(evidenceChain).map(([key, value]) => [key, Array.isArray(value) ? [...value] : []])),
    specification_approvals: records.specification_approvals.map(item => item.id),
  };
  const summaryKeys = ['formulations', 'experimental_plans', 'pilot_batches', 'laboratory_results', 'sensory_studies', 'stability_programs', 'stability_observations', 'decisions', 'product_specifications', 'specification_approvals', 'documents', 'packaging_configurations', 'production_trials', 'qc_releases', 'quality_events', 'capa_actions'];

  return {
    engine_version: PRODUCT_PASSPORT_ENGINE_VERSION,
    project_id: project.id,
    formulation_version_id: targetId,
    formulation_version: target?.version ?? null,
    generated_at: new Date().toISOString(),
    project: { id: project.id, code: project.code, name: project.name, stage: project.stage, status: project.status, target_market: project.target_market, beverage_category: project.beverage_category },
    readiness: { ...developmentState.readiness, gates },
    evidence_chain: passportEvidenceChain,
    graph: { nodes, edges, node_count: nodes.length, edge_count: edges.length },
    unresolved_blockers: developmentState.blockers.map(item => ({ ...item })),
    summary: Object.fromEntries(summaryKeys.map(key => [key, records[key].length])),
    limitations: [
      target ? `This passport is restricted to formulation ${target.code} v${target.version} (${target.id}); evidence from other versions is excluded.` : 'No target formulation version could be selected; no formulation evidence is included.',
      'This calculated passport is not a regulatory certificate or an automatic market-release authorization.',
    ],
  };
}

const normalize = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function structuredWorkspaceSearch(query, records, limit = 30) {
  const phrase = normalize(query).trim();
  const terms = phrase.split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return records.map(record => {
    const title = normalize(record.title); const searchable = normalize(`${record.title} ${record.subtitle || ''} ${record.reference || ''}`);
    if (!terms.every(term => searchable.includes(term))) return null;
    const score = (title === phrase ? 100 : title.startsWith(phrase) ? 80 : title.includes(phrase) ? 60 : 0) + terms.reduce((sum, term) => sum + (title.includes(term) ? 5 : 1), 0);
    return { ...record, score };
  }).filter(Boolean).sort((a, b) => b.score - a.score || String(b.updated_at || '').localeCompare(String(a.updated_at || ''))).slice(0, limit);
}
