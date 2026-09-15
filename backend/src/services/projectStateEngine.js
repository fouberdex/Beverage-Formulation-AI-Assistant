import { analyzeStabilityProgram } from './stabilityEngine.js';

export const PROJECT_STATE_ENGINE_VERSION = '1.1.0';

const list = (trace, key) => Array.isArray(trace?.[key]) ? trace[key] : [];
const approvedVersion = version => version?.status === 'approved' || Boolean(version?.locked_at);
const byNewestVersion = (left, right) => Number(right.version || 0) - Number(left.version || 0);

function activeVersionReferences(trace) {
  const references = new Set();
  list(trace, 'experimental_plans').filter(item => ['ready', 'running'].includes(item.status)).forEach(item => references.add(item.formulation_version_id));
  list(trace, 'pilot_batches').filter(item => ['planned', 'in_progress'].includes(item.status)).forEach(item => references.add(item.formulation_version_id));
  list(trace, 'stability_programs').filter(item => ['draft', 'running'].includes(item.status)).forEach(item => references.add(item.formulation_version_id));
  list(trace, 'packaging_configurations').filter(item => item.status === 'draft').forEach(item => references.add(item.formulation_version_id));
  list(trace, 'production_trials').filter(item => ['planned', 'running'].includes(item.status)).forEach(item => references.add(item.formulation_version_id));
  return references;
}

export function selectTargetFormulationVersion(inputTraceability) {
  const versions = [...list(inputTraceability, 'formulations')];
  const activeReferences = activeVersionReferences(inputTraceability);
  return versions.sort((left, right) => {
    const rank = version => approvedVersion(version) && activeReferences.has(version.id) ? 4 : approvedVersion(version) ? 3 : activeReferences.has(version.id) ? 2 : 1;
    return rank(right) - rank(left) || byNewestVersion(left, right);
  })[0] || null;
}

const ids = records => records.map(item => item.id);
const gate = (key, label, records, passed = records.length > 0) => ({ key, label, status: passed ? 'pass' : 'missing', entity_ids: ids(records) });

function failedStabilityPrograms(programs, observations) {
  return programs.filter(program => {
    if (!Array.isArray(program.storage_conditions) || !Array.isArray(program.parameters) || !Array.isArray(program.timepoints_days)) return false;
    const programObservations = observations.filter(item => item.program_id === program.id);
    return analyzeStabilityProgram(program, programObservations).overall_status === 'fail';
  });
}

function buildReformulationAssessment({ reworkDecisions, failedStability, adverseQc, openEvents, processIssues, rejectedBatches, packagingIssues }) {
  if (reworkDecisions.length) return { required: true, trigger: 'explicit_rework_decision', recommended_path: 'formulation_review', reason: reworkDecisions[0].rationale || 'A controlled decision explicitly requires reformulation.', entity_ids: ids(reworkDecisions) };
  if (failedStability.length) return { required: false, trigger: 'stability_failure', recommended_path: 'stability_investigation', reason: 'An observed stability limit failed. Investigate formulation, process and packaging causes before deciding whether to reformulate.', entity_ids: ids(failedStability) };
  if (adverseQc.length || openEvents.length) return { required: false, trigger: 'quality_issue', recommended_path: 'quality_investigation', reason: 'A target-version quality issue requires root-cause investigation before selecting formulation, process, supplier or packaging corrective action.', entity_ids: ids([...adverseQc, ...openEvents]) };
  if (processIssues.length) return { required: false, trigger: 'process_issue', recommended_path: 'process_review', reason: 'Recorded production controls require review; the available evidence does not establish that the formulation must change.', entity_ids: ids(processIssues) };
  if (rejectedBatches.length) return { required: false, trigger: 'pilot_rejection', recommended_path: 'pilot_investigation', reason: 'A pilot batch was rejected. Determine whether formulation or execution caused the rejection before creating a new version.', entity_ids: ids(rejectedBatches) };
  if (packagingIssues.length) return { required: false, trigger: 'packaging_issue', recommended_path: 'packaging_review', reason: 'Packaging warnings exist; review the package and stability evidence before changing the formulation.', entity_ids: ids(packagingIssues) };
  return { required: false, trigger: null, recommended_path: 'continue_controlled_workflow', reason: 'No persisted evidence currently requires reformulation.', entity_ids: [] };
}

export function buildProjectDevelopmentState(project, inputTraceability) {
  const trace = inputTraceability || {};
  const target = selectTargetFormulationVersion(trace);
  const targetId = target?.id || null;
  const forTarget = (key, field = 'formulation_version_id') => list(trace, key).filter(item => item[field] === targetId);
  const formulations = target ? [target] : [];
  const plans = forTarget('experimental_plans');
  const batches = forTarget('pilot_batches');
  const laboratoryResults = forTarget('laboratory_results');
  const sensoryStudies = list(trace, 'sensory_studies').filter(item => (item.formulation_version_ids || []).includes(targetId));
  const stabilityPrograms = forTarget('stability_programs');
  const stabilityObservations = forTarget('stability_observations');
  const decisions = forTarget('decisions');
  const productSpecifications = forTarget('product_specifications');
  const documents = forTarget('documents');
  const packagingConfigurations = forTarget('packaging_configurations');
  const productionTrials = forTarget('production_trials');
  const trialIds = new Set(ids(productionTrials));
  const specificationIds = new Set(ids(productSpecifications));
  const laboratoryResultIds = new Set(ids(laboratoryResults));
  const targetQcCandidates = list(trace, 'qc_releases').filter(item => trialIds.has(item.production_trial_id));
  const qcReleases = targetQcCandidates.filter(item => specificationIds.has(item.specification_id) && item.laboratory_result_ids?.length > 0 && item.laboratory_result_ids.every(id => laboratoryResultIds.has(id)));
  const incoherentQcReleases = targetQcCandidates.filter(item => !qcReleases.includes(item));
  const qcIds = new Set(ids(targetQcCandidates));
  const qualityEvents = list(trace, 'quality_events').filter(item => trialIds.has(item.production_trial_id) || qcIds.has(item.qc_release_id));
  const qualityEventIds = new Set(ids(qualityEvents));
  const capaActions = list(trace, 'capa_actions').filter(item => qualityEventIds.has(item.quality_event_id));

  const openEvents = qualityEvents.filter(item => item.status !== 'closed');
  const unresolvedCapas = capaActions.filter(item => !['effectiveness_verified', 'cancelled'].includes(item.status));
  const adverseQc = qcReleases.filter(item => ['hold', 'rejected', 'out_of_specification'].includes(item.disposition) && !qualityEvents.some(event => event.qc_release_id === item.id && event.status === 'closed'));
  const reworkDecisions = decisions.filter(item => item.outcome === 'rework');
  const rejectedBatches = batches.filter(item => item.status === 'rejected');
  const failedStability = failedStabilityPrograms(stabilityPrograms, stabilityObservations);
  const packagingIssues = packagingConfigurations.filter(item => item.analysis?.readiness === 'review_required' || item.analysis?.warnings?.length > 0);
  const processIssues = productionTrials.filter(item => item.analysis?.status === 'review_required' || item.analysis?.warnings?.length > 0);
  const reformulation = buildReformulationAssessment({ reworkDecisions, failedStability, adverseQc, openEvents, processIssues, rejectedBatches, packagingIssues });
  const blockers = [
    ...openEvents.map(item => ({ code: 'OPEN_QUALITY_EVENT', message: `${item.severity} ${item.event_type}: ${item.title}`, entity_type: 'quality_event', entity_id: item.id })),
    ...unresolvedCapas.map(item => ({ code: 'UNRESOLVED_CAPA', message: `CAPA ${item.status}: ${item.title}`, entity_type: 'capa', entity_id: item.id })),
    ...adverseQc.map(item => ({ code: 'ADVERSE_QC_DISPOSITION', message: `QC disposition remains ${item.disposition.replaceAll('_', ' ')}`, entity_type: 'qc_release', entity_id: item.id })),
    ...reworkDecisions.map(item => ({ code: 'REFORMULATION_REQUIRED', message: item.rationale || 'A controlled rework decision requires a new formulation version.', entity_type: 'decision', entity_id: item.id })),
    ...failedStability.map(item => ({ code: 'STABILITY_LIMIT_FAILURE', message: `Observed stability limits failed in ${item.name || item.id}; investigate the failure before progression.`, entity_type: 'stability_program', entity_id: item.id })),
    ...incoherentQcReleases.map(item => ({ code: 'INCOHERENT_QC_EVIDENCE', message: 'QC evidence crosses formulation versions or omits exact-version laboratory evidence.', entity_type: 'qc_release', entity_id: item.id })),
  ];

  const controlledPlans = plans.filter(item => item.status !== 'cancelled');
  const completedBatches = batches.filter(item => item.status === 'completed');
  const completedSensory = sensoryStudies.filter(item => item.status === 'completed');
  const failedStabilityIds = new Set(ids(failedStability));
  const completedStability = stabilityPrograms.filter(item => item.status === 'completed' && !failedStabilityIds.has(item.id));
  const goDecisions = decisions.filter(item => item.outcome === 'go');
  const approvedSpecifications = productSpecifications.filter(item => item.status === 'approved');
  const approvedPackaging = packagingConfigurations.filter(item => item.status === 'approved');
  const completedTrials = productionTrials.filter(item => item.status === 'completed');
  const releasedQc = qcReleases.filter(item => item.disposition === 'released');
  const gates = [
    gate('validated_brief', 'Validated R&D brief', [], project.brief_status === 'validated'),
    gate('approved_formulation', 'Approved target formulation version', formulations, Boolean(target && approvedVersion(target))),
    gate('experimental_plan', 'Experimental plan for target version', controlledPlans),
    gate('pilot_evidence', 'Completed pilot batch for target version', completedBatches),
    gate('laboratory_evidence', 'Laboratory evidence for target version', laboratoryResults),
    gate('sensory_evidence', 'Completed sensory study including target version', completedSensory),
    gate('stability_evidence', 'Completed stability program for target version', completedStability),
    gate('go_decision', 'Go decision for target version', goDecisions),
    gate('approved_specification', 'Approved product specification for target version', approvedSpecifications),
    gate('approved_packaging', 'Approved packaging configuration for target version', approvedPackaging),
    gate('completed_scale_up', 'Completed production trial for target version', completedTrials),
    gate('released_qc', 'Coherent released QC decision', releasedQc),
    gate('quality_clearance', 'No unresolved target-version quality blocker', [], blockers.length === 0),
  ];
  const passedGates = gates.filter(item => item.status === 'pass').length;
  const firstMissing = gates.find(item => item.status !== 'pass');
  const controllingGate = blockers.length ? gates.find(item => item.key === 'quality_clearance') : firstMissing;
  const stageByGate = { validated_brief: 'brief', approved_formulation: 'formulation_approval', experimental_plan: 'experimentation', pilot_evidence: 'pilot', laboratory_evidence: 'laboratory', sensory_evidence: 'sensory', stability_evidence: 'stability', go_decision: 'decision', approved_specification: 'specification', approved_packaging: 'packaging', completed_scale_up: 'industrialization', released_qc: 'qc_release', quality_clearance: 'quality' };
  const actionByGate = {
    validated_brief: ['Validate the structured brief', 'Confirm measurable constraints and success criteria.'],
    approved_formulation: [target ? 'Approve the target formulation version' : 'Create the first formulation version', 'Establish one controlled exact formulation version.'],
    experimental_plan: ['Create an experiment or DOE plan', 'Attach the protocol to the target formulation version.'],
    pilot_evidence: ['Complete a pilot batch', 'Execute the controlled plan against the target formulation version.'],
    laboratory_evidence: ['Record laboratory results', 'Attach measurements to the target formulation version.'],
    sensory_evidence: ['Complete a sensory study', 'Evaluate samples that explicitly include the target formulation version.'],
    stability_evidence: ['Complete the stability program', 'Record the required observations for the target formulation version.'],
    go_decision: ['Record a Go / No-Go / Rework decision', 'Base the decision on exact-version evidence.'],
    approved_specification: ['Approve the product specification', 'Convert accepted exact-version evidence into controlled limits.'],
    approved_packaging: ['Approve a packaging configuration', 'Link the controlled package to the target formulation version.'],
    completed_scale_up: ['Complete an industrial production trial', 'Scale the target formulation and approved packaging under control.'],
    released_qc: ['Complete deterministic QC disposition', 'Evaluate target-version laboratory evidence against its approved specification.'],
    quality_clearance: ['Resolve target-version quality blockers', 'Close quality events and verify their CAPA before release.'],
  };
  const controlledOverride = reformulation.required
    ? { key: 'reformulation_review', label: 'Create a new controlled formulation version', detail: reformulation.reason, stage: 'formulation_review' }
    : failedStability.length
      ? { key: 'stability_review', label: 'Investigate the observed stability failure', detail: reformulation.reason, stage: 'stability' }
      : null;
  const [label, detail] = controlledOverride ? [controlledOverride.label, controlledOverride.detail] : controllingGate ? actionByGate[controllingGate.key] : ['Review released evidence', 'The exact-version evidence chain is complete.'];
  const releasePrerequisites = gates.filter(item => !['released_qc', 'quality_clearance'].includes(item.key));

  return {
    engine_version: PROJECT_STATE_ENGINE_VERSION,
    calculated_at: new Date().toISOString(),
    project_id: project.id,
    target_formulation_version_id: targetId,
    current_stage: controlledOverride?.stage || (controllingGate ? stageByGate[controllingGate.key] : 'released'),
    next_controlled_action: { key: controlledOverride?.key || controllingGate?.key || 'evidence_complete', label, detail },
    blockers,
    evidence_chain: {
      formulation: ids(formulations), experimental_plans: ids(plans), pilot_batches: ids(batches), laboratory_results: ids(laboratoryResults), sensory_studies: ids(sensoryStudies), stability_programs: ids(stabilityPrograms), stability_observations: ids(stabilityObservations), decisions: ids(decisions), product_specifications: ids(productSpecifications), documents: ids(documents), packaging_configurations: ids(packagingConfigurations), production_trials: ids(productionTrials), qc_releases: ids(qcReleases), quality_events: ids(qualityEvents), capa_actions: ids(capaActions),
    },
    readiness: { status: blockers.length ? 'blocked' : passedGates === gates.length ? 'evidence_complete' : 'in_progress', score_percent: Math.round(passedGates / gates.length * 100), passed_gates: passedGates, total_gates: gates.length, gates },
    reformulation_required: reformulation,
    release_eligible: Boolean(targetId) && blockers.length === 0 && releasePrerequisites.every(item => item.status === 'pass'),
  };
}
