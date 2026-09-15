export const PRODUCT_PASSPORT_ENGINE_VERSION = '1.0.0';

const arrays = trace => new Proxy(trace || {}, { get: (target, key) => Array.isArray(target[key]) ? target[key] : [] });
const nodeId = (type, id) => `${type}:${id}`;

export function buildProductPassport(project, inputTraceability) {
  const trace = arrays(inputTraceability);
  const nodes = [{ id: nodeId('project', project.id), entity_type: 'project', entity_id: project.id, label: `${project.code} · ${project.name}`, status: project.status }];
  const edges = [];
  const add = (type, item, label, status = '') => nodes.push({ id: nodeId(type, item.id), entity_type: type, entity_id: item.id, label, status });
  const link = (fromType, fromId, toType, toId, relation) => { if (fromId && toId) edges.push({ from: nodeId(fromType, fromId), to: nodeId(toType, toId), relation }); };
  const linkProject = (type, item) => link('project', project.id, type, item.id, 'contains');

  trace.formulations.forEach(item => { add('formulation', item, `${item.code} · ${item.name} · v${item.version}`, item.status); linkProject('formulation', item); });
  trace.laboratory_results.forEach(item => { add('laboratory_result', item, item.batch_code || `Laboratory ${item.id}`, 'recorded'); link('formulation', item.formulation_version_id, 'laboratory_result', item.id, 'tested_by'); });
  trace.sensory_studies.forEach(item => { add('sensory_study', item, item.name, item.status); (item.formulation_version_ids || []).forEach(id => link('formulation', id, 'sensory_study', item.id, 'evaluated_by')); });
  trace.experimental_plans.forEach(item => { add('experimental_plan', item, item.name, item.status); link('formulation', item.formulation_version_id, 'experimental_plan', item.id, 'tested_under'); });
  trace.pilot_batches.forEach(item => { add('pilot_batch', item, item.batch_code, item.status); link('experimental_plan', item.experimental_plan_id, 'pilot_batch', item.id, 'executed_as'); link('formulation', item.formulation_version_id, 'pilot_batch', item.id, 'produced_as'); });
  trace.milestones.forEach(item => { add('milestone', item, item.title, item.status); linkProject('milestone', item); });
  trace.decisions.forEach(item => { add('decision', item, item.title, item.outcome); linkProject('decision', item); link('formulation', item.formulation_version_id, 'decision', item.id, 'governed_by'); link('milestone', item.milestone_id, 'decision', item.id, 'resolved_by'); });
  trace.stability_programs.forEach(item => { add('stability_program', item, item.name, item.status); link('formulation', item.formulation_version_id, 'stability_program', item.id, 'monitored_by'); });
  trace.product_specifications.forEach(item => { add('product_specification', item, `${item.name} · rev ${item.version}`, item.status); link('formulation', item.formulation_version_id, 'product_specification', item.id, 'controlled_by'); });
  trace.documents.forEach(item => { add('document', item, item.title, item.review_status); item.formulation_version_id ? link('formulation', item.formulation_version_id, 'document', item.id, 'supported_by') : linkProject('document', item); });
  trace.packaging_configurations.forEach(item => { add('packaging_configuration', item, `${item.name} · rev ${item.version}`, item.status); link('formulation', item.formulation_version_id, 'packaging_configuration', item.id, 'packed_as'); });
  trace.production_trials.forEach(item => { add('production_trial', item, item.batch_code, item.status); link('formulation', item.formulation_version_id, 'production_trial', item.id, 'scaled_as'); link('packaging_configuration', item.packaging_configuration_id, 'production_trial', item.id, 'used_by'); });
  trace.qc_releases.forEach(item => { add('qc_release', item, `QC · ${item.disposition}`, item.disposition); link('production_trial', item.production_trial_id, 'qc_release', item.id, 'disposed_by'); link('product_specification', item.specification_id, 'qc_release', item.id, 'evaluated_in'); (item.laboratory_result_ids || []).forEach(id => link('laboratory_result', id, 'qc_release', item.id, 'evidence_for')); });
  trace.quality_events.forEach(item => { add('quality_event', item, item.title, item.status); link('production_trial', item.production_trial_id, 'quality_event', item.id, 'raised'); link('qc_release', item.qc_release_id, 'quality_event', item.id, 'raised'); });
  trace.capa_actions.forEach(item => { add('capa', item, item.title, item.status); link('quality_event', item.quality_event_id, 'capa', item.id, 'addressed_by'); });

  const openSeriousEvents = trace.quality_events.filter(item => item.status !== 'closed' && ['major', 'critical'].includes(item.severity));
  const gates = [
    ['validated_brief', 'Validated R&D brief', project.brief_status === 'validated'],
    ['approved_formulation', 'Approved exact formulation', trace.formulations.some(item => item.status === 'approved')],
    ['pilot_evidence', 'Completed pilot batch', trace.pilot_batches.some(item => item.status === 'completed')],
    ['laboratory_evidence', 'Laboratory evidence', trace.laboratory_results.length > 0],
    ['sensory_evidence', 'Completed sensory study', trace.sensory_studies.some(item => item.status === 'completed')],
    ['approved_specification', 'Approved product specification', trace.product_specifications.some(item => item.status === 'approved')],
    ['approved_packaging', 'Approved packaging configuration', trace.packaging_configurations.some(item => item.status === 'approved')],
    ['completed_scale_up', 'Completed production trial', trace.production_trials.some(item => item.status === 'completed')],
    ['released_qc', 'Released QC decision', trace.qc_releases.some(item => item.disposition === 'released')],
    ['quality_clearance', 'No unresolved major/critical event', openSeriousEvents.length === 0],
  ].map(([key, label, passed]) => ({ key, label, passed: Boolean(passed) }));
  const passed = gates.filter(item => item.passed).length;
  const unresolvedOos = trace.qc_releases.some(release => release.disposition === 'out_of_specification' && !trace.quality_events.some(event => event.qc_release_id === release.id && event.status === 'closed'));
  const blocked = openSeriousEvents.length > 0 || unresolvedOos;
  return {
    engine_version: PRODUCT_PASSPORT_ENGINE_VERSION,
    generated_at: new Date().toISOString(),
    project: { id: project.id, code: project.code, name: project.name, stage: project.stage, status: project.status, target_market: project.target_market, beverage_category: project.beverage_category },
    readiness: { score_percent: Math.round(passed / gates.length * 100), passed_gates: passed, total_gates: gates.length, status: blocked ? 'blocked' : passed === gates.length ? 'evidence_complete' : 'in_progress', gates },
    graph: { nodes, edges, node_count: nodes.length, edge_count: edges.length },
    summary: Object.fromEntries(['formulations','laboratory_results','sensory_studies','experimental_plans','pilot_batches','stability_programs','product_specifications','documents','packaging_configurations','production_trials','qc_releases','quality_events','capa_actions'].map(key => [key, trace[key].length])),
    limitations: ['This passport summarizes recorded workspace evidence; it is not a regulatory certificate or an automatic market-release authorization.'],
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
