import test from 'node:test';
import assert from 'node:assert/strict';
import server from '../src/server.js';
import { getIngredientById, INGREDIENT_IDS, ingredients } from '../src/data/mockData.js';
import { reviewFormulationCandidates, reviewFormulationVariants } from '../src/services/geminiService.js';

const originalGeminiApiKey = process.env.GEMINI_API_KEY;
const originalGeminiModel = process.env.GEMINI_MODEL;
delete process.env.GEMINI_API_KEY;
delete process.env.GEMINI_MODEL;

test.after(async () => {
  if (originalGeminiApiKey) process.env.GEMINI_API_KEY = originalGeminiApiKey;
  else delete process.env.GEMINI_API_KEY;
  if (originalGeminiModel) process.env.GEMINI_MODEL = originalGeminiModel;
  else delete process.env.GEMINI_MODEL;
  await server.close();
});

test('health endpoint identifies the active storage mode', async () => {
  const response = await server.inject({ method: 'GET', url: '/health', headers: { 'x-request-id': 'health-test' } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().mode, 'memory');
  assert.equal(response.json().persistent, false);
  assert.equal(response.headers['x-request-id'], 'health-test');
  assert.ok(response.headers['x-content-type-options']);
});

test('metrics are unavailable without a configured token and protected when enabled', async () => {
  const unavailable = await server.inject({ method: 'GET', url: '/metrics' });
  assert.equal(unavailable.statusCode, 404);

  process.env.METRICS_TOKEN = 'metrics-test-token-that-is-long-enough';
  const unauthorized = await server.inject({ method: 'GET', url: '/metrics' });
  assert.equal(unauthorized.statusCode, 401);
  const authorized = await server.inject({
    method: 'GET',
    url: '/metrics',
    headers: { authorization: `Bearer ${process.env.METRICS_TOKEN}` },
  });
  delete process.env.METRICS_TOKEN;

  assert.equal(authorized.statusCode, 200);
  assert.match(authorized.body, /beverageai_http_requests_total/);
});

test('readiness and account identity endpoints are available', async () => {
  const readiness = await server.inject({ method: 'GET', url: '/ready' });
  assert.equal(readiness.statusCode, 200);
  assert.equal(readiness.json().status, 'ready');

  const identity = await server.inject({ method: 'GET', url: '/api/v1/auth/me' });
  assert.equal(identity.statusCode, 200);
  assert.equal(identity.json().data.role, 'admin');
});

test('AI governance is opt-in and exposes quota metadata without prompt storage', async () => {
  const initial = await server.inject({ method: 'GET', url: '/api/v1/ai/governance' });
  assert.equal(initial.statusCode, 200);
  assert.equal(initial.json().data.privacy.external_processing_enabled, false);
  assert.equal(initial.json().data.privacy.prompt_or_response_content_stored, false);
  assert.equal(initial.json().data.quota.daily_used, 0);

  const updated = await server.inject({
    method: 'PUT', url: '/api/v1/ai/preferences',
    payload: { external_processing_enabled: true, include_formulation_name: false },
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.json().data.external_processing_enabled, true);
});

test('target generation history is exposed only through the history endpoints', async () => {
  const generated = await server.inject({
    method: 'POST', url: '/api/v1/target-generation/generate', payload: { target_sugar: 8, count: 1 },
  });
  assert.equal(generated.statusCode, 201);
  const history = await server.inject({ method: 'GET', url: '/api/v1/target-generation/runs?limit=10' });
  assert.equal(history.statusCode, 200);
  assert.ok(history.json().data.some(run => run.id === generated.json().data.run_id));
});

test('pagination treats offset and limit as numbers', async () => {
  const response = await server.inject({ method: 'GET', url: '/api/v1/formulations?offset=1&limit=2' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.length, 2);
  assert.deepEqual(response.json().pagination, { total: 5, limit: 2, offset: 1, has_more: true });
});

test('R&D projects persist a controlled lifecycle and reject skipped gates', async () => {
  const created = await server.inject({
    method: 'POST', url: '/api/v1/projects',
    payload: { name: 'Algerian citrus launch', beverage_category: 'carbonated soft drink', target_market: 'Algeria', priority: 'high' },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().data.stage, 'brief');
  const id = created.json().data.id;

  const skipped = await server.inject({ method: 'POST', url: `/api/v1/projects/${id}/transition`, payload: { stage: 'laboratory' } });
  assert.equal(skipped.statusCode, 409);
  assert.deepEqual(skipped.json().allowed_transitions, ['concept']);

  const blockedByDraftBrief = await server.inject({ method: 'POST', url: `/api/v1/projects/${id}/transition`, payload: { stage: 'concept' } });
  assert.equal(blockedByDraftBrief.statusCode, 409);
  assert.equal(blockedByDraftBrief.json().code, 'PROJECT_BRIEF_VALIDATION_REQUIRED');

  const brief = await server.inject({ method: 'PUT', url: `/api/v1/projects/${id}/brief`, payload: { validate: true, brief: {
    business_objective: 'Launch a locally relevant citrus beverage at a controlled cost.',
    target_market: 'Algeria', beverage_category: 'carbonated soft drink', target_claims: ['low sugar'],
    ingredient_constraints: { required: ['water'], forbidden: ['aspartame'], notes: '' },
    cost_objectives: { max_cost_per_liter: 60, currency: 'DZD' },
    nutrition_objectives: { max_sugar_g_per_100ml: 10, target_ph_min: 2.8, target_ph_max: 3.5 },
    regulatory_constraints: { markets: ['Algeria'], certifications: ['Halal'], forbidden_additives: [] },
    success_criteria: ['Overall liking reaches at least 7/10'],
  } } });
  assert.equal(brief.statusCode, 200);
  assert.equal(brief.json().data.brief_status, 'validated');

  const advanced = await server.inject({ method: 'POST', url: `/api/v1/projects/${id}/transition`, payload: { stage: 'concept', note: 'Brief approved' } });
  assert.equal(advanced.statusCode, 200);
  assert.equal(advanced.json().data.status, 'active');

  const detail = await server.inject({ method: 'GET', url: `/api/v1/projects/${id}` });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.json().data.events.filter(event => event.event_type === 'stage_transition').length, 1);
  assert.deepEqual(detail.json().allowed_transitions, ['formulation']);

  const formulationResponse = await server.inject({ method: 'POST', url: '/api/v1/formulations', payload: {
    name: 'Project citrus v1', project_id: id,
    ingredients: [{ ingredient_id: INGREDIENT_IDS.WATER, percentage: 90 }, { ingredient_id: INGREDIENT_IDS.CANE_SUGAR, percentage: 10 }],
  } });
  assert.equal(formulationResponse.statusCode, 201);
  const formulation = formulationResponse.json().data;
  const approved = await server.inject({ method: 'POST', url: `/api/v1/formulations/${formulation.id}/approve`, payload: { note: 'Technical review completed' } });
  assert.equal(approved.statusCode, 200);
  assert.ok(approved.json().data.locked_at);
  const forbiddenEdit = await server.inject({ method: 'PUT', url: `/api/v1/formulations/${formulation.id}`, payload: { name: 'Silent mutation' } });
  assert.equal(forbiddenEdit.statusCode, 409);
  const versionResponse = await server.inject({ method: 'POST', url: `/api/v1/formulations/${formulation.id}/versions`, payload: { name: 'Project citrus v2' } });
  assert.equal(versionResponse.statusCode, 201);
  const version = versionResponse.json().data;
  assert.equal(version.project_id, id);
  assert.equal(version.locked_at, undefined);

  const lab = await server.inject({ method: 'POST', url: `/api/v1/formulations/${version.id}/laboratory-results`, payload: {
    batch_code: 'TRACE-LAB-1', tested_at: '2026-09-14', measurements: { ph: 3.2 }, sensory: { overall_acceptance: 8 },
  } });
  assert.equal(lab.statusCode, 201);
  assert.equal(lab.json().data.formulation_version_id, version.id);
  assert.equal(lab.json().data.project_id, id);

  const stabilityProgramResponse = await server.inject({ method: 'POST', url: `/api/v1/projects/${id}/stability-programs`, payload: {
    name: 'Ambient shelf-life program', formulation_version_id: version.id, status: 'draft', protocol: 'Store sealed PET bottles under controlled ambient conditions.',
    storage_conditions: [{ id: 'ambient', label: 'Ambient dark', temperature_c: 25, relative_humidity_percent: 60, light_exposure: 'dark' }],
    timepoints_days: [0, 30, 90], replicates_per_timepoint: 1,
    parameters: [{ key: 'ph', label: 'Finished product pH', source: 'measurements', unit: 'pH', lower: 2.8, upper: 3.5, max_change_from_baseline: 0.2 }],
  } });
  assert.equal(stabilityProgramResponse.statusCode, 201);
  const stabilityProgram = stabilityProgramResponse.json().data;
  const stabilityObservation = await server.inject({ method: 'POST', url: `/api/v1/projects/${id}/stability-programs/${stabilityProgram.id}/observations`, payload: {
    laboratory_result_id: lab.json().data.id, condition_id: 'ambient', timepoint_days: 0, replicate: 1,
  } });
  assert.equal(stabilityObservation.statusCode, 201);
  assert.equal(stabilityObservation.json().data.values.ph, 3.2);
  const lockedStabilityProgram = await server.inject({ method: 'PUT', url: `/api/v1/projects/${id}/stability-programs/${stabilityProgram.id}`, payload: { protocol: 'Attempted silent protocol mutation after observation.' } });
  assert.equal(lockedStabilityProgram.statusCode, 409);
  assert.equal(lockedStabilityProgram.json().code, 'STABILITY_PROTOCOL_LOCKED');

  const specificationResponse = await server.inject({ method: 'POST', url: `/api/v1/projects/${id}/specifications`, payload: {
    name: 'Citrus finished product specification', formulation_version_id: version.id, markets: ['Algeria'], notes: 'Controlled release limits.',
    limits: [{ key: 'ph', label: 'Finished product pH', source: 'measurements', unit: 'pH', lower: 2.8, upper: 3.5 }],
  } });
  assert.equal(specificationResponse.statusCode, 201);
  const specification = specificationResponse.json().data;
  const specificationApproval = await server.inject({ method: 'POST', url: `/api/v1/projects/${id}/specifications/${specification.id}/approve`, payload: {
    rationale: 'The approved limits match the validated brief and initial laboratory result.', evidence_refs: [lab.json().data.id],
  } });
  assert.equal(specificationApproval.statusCode, 201);
  assert.equal(specificationApproval.json().data.status, 'approved');
  const lockedSpecification = await server.inject({ method: 'PUT', url: `/api/v1/projects/${id}/specifications/${specification.id}`, payload: { notes: 'Silent mutation' } });
  assert.equal(lockedSpecification.statusCode, 409);
  const stabilityAnalysis = await server.inject({ method: 'GET', url: `/api/v1/projects/${id}/stability-programs/${stabilityProgram.id}/analysis` });
  assert.equal(stabilityAnalysis.statusCode, 200);
  assert.equal(stabilityAnalysis.json().data.overall_status, 'in_progress');
  assert.equal(stabilityAnalysis.json().data.specification.id, specification.id);
  assert.equal(stabilityAnalysis.json().data.extrapolation.performed, false);

  const supplierResponse = await server.inject({ method: 'POST', url: '/api/v1/supply-chain/suppliers', payload: {
    name: 'Atlas Packaging & Ingredients', status: 'qualified', country: 'Algeria', certifications: ['ISO 9001', 'Halal'], qualification_score: 88,
  } });
  assert.equal(supplierResponse.statusCode, 201);
  const supplier = supplierResponse.json().data;
  const materialResponse = await server.inject({ method: 'POST', url: `/api/v1/supply-chain/suppliers/${supplier.id}/materials`, payload: {
    material_code: 'CITRIC-ANH-01', name: 'Citric acid anhydrous', ingredient_id: INGREDIENT_IDS.CITRIC_ACID, status: 'approved', currency: 'DZD', price_per_kg: 420, moq_kg: 25, lead_time_days: 10,
  } });
  assert.equal(materialResponse.statusCode, 201);
  const material = materialResponse.json().data;
  const materialSpecResponse = await server.inject({ method: 'POST', url: `/api/v1/supply-chain/materials/${material.id}/specifications`, payload: {
    name: 'Citric acid incoming specification', limits: [{ key: 'purity', label: 'Purity', unit: '%', lower: 99.5, upper: 100, method: 'Supplier CoA' }], notes: 'Verify each received lot.',
  } });
  assert.equal(materialSpecResponse.statusCode, 201);
  const materialSpec = materialSpecResponse.json().data;
  const approvedMaterialSpec = await server.inject({ method: 'POST', url: `/api/v1/supply-chain/material-specifications/${materialSpec.id}/approve`, payload: { rationale: 'Incoming limits match the qualified supplier technical dossier.', evidence_refs: ['TDS-CITRIC-2026'] } });
  assert.equal(approvedMaterialSpec.statusCode, 200);
  assert.equal(approvedMaterialSpec.json().data.status, 'approved');

  const bottleResponse = await server.inject({ method: 'POST', url: '/api/v1/supply-chain/packaging-components', payload: {
    supplier_id: supplier.id, code: 'PET-330-01', name: '330 mL PET bottle', component_type: 'bottle', material: 'PET', status: 'approved', capacity_ml: 330, mass_g: 18, recycled_content_percent: 25, unit_cost: 12, currency: 'DZD', barrier: { oxygen_transmission_rate_cc_m2_day: 0.8, light_transmission_percent: 90 }, food_contact_compliant: true, markets: ['Algeria'],
  } });
  assert.equal(bottleResponse.statusCode, 201);
  const closureResponse = await server.inject({ method: 'POST', url: '/api/v1/supply-chain/packaging-components', payload: {
    supplier_id: supplier.id, code: 'CAP-28-01', name: '28 mm closure', component_type: 'closure', material: 'HDPE', status: 'approved', mass_g: 2, recycled_content_percent: 0, unit_cost: 2, currency: 'DZD', barrier: {}, food_contact_compliant: true, markets: ['Algeria'],
  } });
  assert.equal(closureResponse.statusCode, 201);

  const documentResponse = await server.inject({ method: 'POST', url: `/api/v1/projects/${id}/documents`, payload: {
    supplier_id: supplier.id, supplier_material_id: material.id, formulation_version_id: version.id, document_type: 'technical_data_sheet', title: 'Citric acid technical data sheet', file_name: 'citric-acid-tds.pdf', mime_type: 'application/pdf', size_bytes: 24500, sha256: 'a'.repeat(64), storage_reference: 'supabase://controlled-documents/citric-acid-tds.pdf', source: 'Qualified supplier portal', extraction_status: 'extracted', extracted_text: 'Purity specification and storage instructions.',
  } });
  assert.equal(documentResponse.statusCode, 201);
  const document = documentResponse.json().data;
  const reviewedDocument = await server.inject({ method: 'POST', url: `/api/v1/projects/${id}/documents/${document.id}/review`, payload: { outcome: 'accepted', review_notes: 'Checksum, supplier provenance and technical limits verified.' } });
  assert.equal(reviewedDocument.statusCode, 200);
  assert.equal(reviewedDocument.json().data.review_status, 'accepted');
  const lockedDocument = await server.inject({ method: 'POST', url: `/api/v1/projects/${id}/documents/${document.id}/review`, payload: { outcome: 'rejected', review_notes: 'Attempted second review must not replace the audit state.' } });
  assert.equal(lockedDocument.statusCode, 409);

  const packagingResponse = await server.inject({ method: 'POST', url: `/api/v1/projects/${id}/packaging-configurations`, payload: {
    formulation_version_id: version.id, name: '330 mL PET retail pack', currency: 'DZD', intended_shelf_life_days: 180, filling_process: 'Cold fill', components: [
      { component_id: bottleResponse.json().data.id, role: 'primary_container', quantity: 1 }, { component_id: closureResponse.json().data.id, role: 'closure', quantity: 1 },
    ], transport_conditions: 'Ambient distribution', notes: 'Initial controlled configuration.',
  } });
  assert.equal(packagingResponse.statusCode, 201);
  const packaging = packagingResponse.json().data;
  assert.equal(packaging.analysis.economics.cost_per_sale_unit, 14);
  assert.equal(packaging.analysis.stability_link.recorded_coverage_days, 0);
  const blockedPackagingApproval = await server.inject({ method: 'POST', url: `/api/v1/projects/${id}/packaging-configurations/${packaging.id}/approve`, payload: { rationale: 'Attempt approval without accepting the evidence warning.', evidence_refs: [document.id] } });
  assert.equal(blockedPackagingApproval.statusCode, 409);
  const packagingApproval = await server.inject({ method: 'POST', url: `/api/v1/projects/${id}/packaging-configurations/${packaging.id}/approve`, payload: { rationale: 'The limited stability coverage is explicitly accepted for this controlled pilot decision.', evidence_refs: [document.id, stabilityProgram.id], accept_warnings: true } });
  assert.equal(packagingApproval.statusCode, 200);
  assert.equal(packagingApproval.json().data.status, 'approved');
  const lockedPackaging = await server.inject({ method: 'PUT', url: `/api/v1/projects/${id}/packaging-configurations/${packaging.id}`, payload: { name: 'Silent mutation' } });
  assert.equal(lockedPackaging.statusCode, 409);

  const study = await server.inject({ method: 'POST', url: '/api/v1/sensory/studies', payload: {
    name: 'Traceable project study', objective: 'Validate preference for the exact linked formulation version.',
    test_type: 'hedonic', panel_type: 'internal', planned_panelists: 5, status: 'draft',
    attributes: [{ key: 'aroma', label: 'Aroma', category: 'aroma' }, { key: 'overall', label: 'Overall', category: 'overall' }],
    samples: [{ formulation_id: version.id, sample_code: 'TRACE', blind_code: '517', label: 'Project citrus v2' }],
    protocol: { randomize_order: true },
  } });
  assert.equal(study.statusCode, 201);
  assert.equal(study.json().data.project_id, id);

  const planResponse = await server.inject({ method: 'POST', url: `/api/v1/projects/${id}/experimental-plans`, payload: {
    name: 'Citrus stability pilot', objective: 'Confirm physical and sensory stability before the validation gate.',
    hypothesis: 'The selected formulation remains within the agreed pH and sensory limits after pilot processing.',
    formulation_version_id: version.id, planned_runs: 2, status: 'ready', due_date: '2026-10-15',
    protocol: { method: 'Controlled comparative pilot', variables: ['storage temperature'], controls: ['approved reference'],
      procedure_steps: ['Prepare the exact formulation version', 'Pasteurize, fill and retain samples'],
      acceptance_criteria: ['pH remains between 2.8 and 3.5', 'Overall liking remains at least 7/10'] },
  } });
  assert.equal(planResponse.statusCode, 201);
  assert.equal(planResponse.json().data.formulation_version_id, version.id);
  const plan = planResponse.json().data;

  const designResponse = await server.inject({ method: 'POST', url: `/api/v1/projects/${id}/experimental-plans/${plan.id}/design`, payload: {
    type: 'full_factorial', center_points: 1, replicates: 1,
    factors: [{ key: 'temperature', label: 'Storage temperature', low: 20, high: 35, unit: '°C' }],
    responses: [{ key: 'stability', label: 'Stability score', goal: 'maximize', unit: '/10' }],
  } });
  assert.equal(designResponse.statusCode, 201);
  assert.equal(designResponse.json().data.run_count, 3);
  assert.equal(designResponse.json().data.engine_version, '1.1.0');
  const doeRun = designResponse.json().data.runs[0];

  const doeBatchResponse = await server.inject({ method: 'POST', url: `/api/v1/projects/${id}/experimental-plans/${plan.id}/pilot-batches`, payload: {
    batch_code: 'PILOT-DOE-001', formulation_version_id: version.id, batch_size_liters: 25, doe_run_id: doeRun.id,
    factor_settings: { temperature: { coded: 1, value: 999, unit: '°C' } }, response_values: { stability: 8.1 },
  } });
  assert.equal(doeBatchResponse.statusCode, 201);
  assert.equal(doeBatchResponse.json().data.factor_settings.temperature.value, 20);

  const analysisResponse = await server.inject({ method: 'GET', url: `/api/v1/projects/${id}/experimental-plans/${plan.id}/analysis` });
  assert.equal(analysisResponse.statusCode, 200);
  assert.equal(analysisResponse.json().data.observation_count, 1);
  assert.equal(analysisResponse.json().data.next_run.basis, 'deterministic_design_order');
  assert.equal(analysisResponse.json().data.applicability.inferential_claims_allowed, false);
  const reportResponse = await server.inject({ method: 'GET', url: `/api/v1/projects/${id}/experimental-plans/${plan.id}/report.csv` });
  assert.equal(reportResponse.statusCode, 200);
  assert.match(reportResponse.headers['content-type'], /text\/csv/);
  assert.match(reportResponse.body, new RegExp(doeRun.id));

  const lockedDesign = await server.inject({ method: 'POST', url: `/api/v1/projects/${id}/experimental-plans/${plan.id}/design`, payload: {
    type: 'full_factorial', factors: [{ key: 'temperature', label: 'Storage temperature', low: 15, high: 40 }],
    responses: [{ key: 'stability', label: 'Stability score', goal: 'maximize' }],
  } });
  assert.equal(lockedDesign.statusCode, 409);
  assert.equal(lockedDesign.json().code, 'DOE_DESIGN_LOCKED');

  const batchResponse = await server.inject({ method: 'POST', url: `/api/v1/projects/${id}/experimental-plans/${plan.id}/pilot-batches`, payload: {
    batch_code: 'PILOT-CITRUS-001', formulation_version_id: version.id, batch_size_liters: 25,
    status: 'planned', actual_quantities: [], procedure_notes: 'Use sanitized 30 L pilot tank.', deviations: [], observations: '', conclusion: '',
  } });
  assert.equal(batchResponse.statusCode, 201);
  assert.equal(batchResponse.json().data.experimental_plan_id, plan.id);
  const batch = batchResponse.json().data;
  const completedBatch = await server.inject({ method: 'PUT', url: `/api/v1/projects/${id}/pilot-batches/${batch.id}`, payload: {
    status: 'completed', produced_at: '2026-09-20T09:00:00.000Z',
    actual_quantities: [{ material_name: 'Water', ingredient_id: INGREDIENT_IDS.WATER, quantity: 22.5, unit: 'l', lot_code: 'WATER-2409' }],
    deviations: ['Mixing time exceeded by 2 minutes'], observations: 'No visible haze after filling.', conclusion: 'Batch accepted for laboratory testing.',
  } });
  assert.equal(completedBatch.statusCode, 200);
  assert.equal(completedBatch.json().data.actual_quantities[0].lot_code, 'WATER-2409');

  const wrongVersionBatch = await server.inject({ method: 'POST', url: `/api/v1/projects/${id}/experimental-plans/${plan.id}/pilot-batches`, payload: {
    batch_code: 'PILOT-WRONG', formulation_version_id: formulation.id, batch_size_liters: 25,
  } });
  assert.equal(wrongVersionBatch.statusCode, 400);

  const milestoneResponse = await server.inject({ method: 'POST', url: `/api/v1/projects/${id}/milestones`, payload: {
    title: 'Pilot evidence review', stage: 'laboratory', due_date: '2026-10-20', responsible: 'R&D lead',
    success_criteria: ['All planned pilot runs completed', 'Laboratory and sensory evidence reviewed'], status: 'planned',
  } });
  assert.equal(milestoneResponse.statusCode, 201);
  const milestone = milestoneResponse.json().data;

  const decisionResponse = await server.inject({ method: 'POST', url: `/api/v1/projects/${id}/decisions`, payload: {
    title: 'Proceed to validation', outcome: 'go', rationale: 'Pilot, laboratory and sensory evidence meet the documented acceptance criteria.',
    evidence_refs: ['PILOT-CITRUS-001', study.json().data.id, lab.json().data.id], formulation_version_id: version.id, milestone_id: milestone.id,
  } });
  assert.equal(decisionResponse.statusCode, 201);
  assert.equal(decisionResponse.json().data.outcome, 'go');

  const traced = await server.inject({ method: 'GET', url: `/api/v1/projects/${id}` });
  assert.equal(traced.json().data.traceability.formulations.length, 2);
  assert.equal(traced.json().data.traceability.laboratory_results[0].formulation_version_id, version.id);
  assert.deepEqual(traced.json().data.traceability.sensory_studies[0].formulation_version_ids, [version.id]);
  assert.equal(traced.json().data.traceability.experimental_plans.length, 1);
  assert.equal(traced.json().data.traceability.pilot_batches.length, 2);
  assert.equal(traced.json().data.traceability.milestones.length, 1);
  assert.equal(traced.json().data.traceability.decisions.length, 1);
  assert.equal(traced.json().data.traceability.stability_programs.length, 1);
  assert.equal(traced.json().data.traceability.stability_observations.length, 1);
  assert.equal(traced.json().data.traceability.product_specifications.length, 1);
  assert.equal(traced.json().data.traceability.specification_approvals.length, 1);
  assert.equal(traced.json().data.traceability.documents.length, 1);
  assert.equal(traced.json().data.traceability.documents[0].review_status, 'accepted');
  assert.equal(traced.json().data.traceability.packaging_configurations.length, 1);
  assert.equal(traced.json().data.traceability.packaging_configurations[0].analysis.economics.cost_per_sale_unit, 14);
  assert.ok(traced.json().data.events.some(event => event.event_type === 'decision_recorded' && event.actor_id));
});

test('missing resources return HTTP 404', async () => {
  const response = await server.inject({ method: 'GET', url: '/api/v1/formulations/not-real' });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error, 'Formulation not found');
});

test('formulation validation rejects totals other than 100%', async () => {
  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/formulations',
    payload: {
      name: 'Invalid formulation',
      ingredients: [{ ingredient_id: INGREDIENT_IDS.WATER, percentage: 90 }],
    },
  });
  assert.equal(response.statusCode, 400);
  assert.match(response.json().details[0].message, /must total 100%/);
});

test('formulation validation enforces ingredient maximum percentages', async () => {
  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/formulations',
    payload: {
      name: 'Unsafe formulation',
      ingredients: [
        { ingredient_id: INGREDIENT_IDS.WATER, percentage: 99 },
        { ingredient_id: INGREDIENT_IDS.ASPARTAME, percentage: 1 },
      ],
    },
  });
  assert.equal(response.statusCode, 400);
  assert.match(response.json().details[0].message, /cannot exceed 0.5%/);
});

test('new formulation nutrition and cost use consistent units', async () => {
  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/formulations',
    payload: {
      code: 'TEST-COST-001',
      name: 'Cost and sugar test',
      ingredients: [
        { ingredient_id: INGREDIENT_IDS.WATER, percentage: 90 },
        { ingredient_id: INGREDIENT_IDS.CANE_SUGAR, percentage: 10 },
      ],
    },
  });
  assert.equal(response.statusCode, 201);
  const formulation = response.json().data;
  assert.equal(formulation.total_sugar_per_100ml, 10);
  assert.equal(formulation.total_calories_per_100ml, 38.7);
  assert.equal(formulation.total_cost_per_liter, 16.5);
});

test('sensory analytics summarize only accessible formulation laboratory results', async () => {
  for (const [index, taste] of [6, 8].entries()) {
    const saved = await server.inject({
      method: 'POST',
      url: '/api/v1/formulations/form-001/laboratory-results',
      payload: {
        batch_code: `ANALYTICS-${index + 1}`,
        tested_at: `2026-08-${20 + index}T00:00:00.000Z`,
        sensory: { appearance: 7, aroma: 7, taste, mouthfeel: 7, overall_acceptance: taste },
      },
    });
    assert.equal(saved.statusCode, 201);
  }

  const response = await server.inject({
    method: 'GET',
    url: '/api/v1/formulations/form-001/sensory-analytics',
  });
  assert.equal(response.statusCode, 200);
  const analysis = response.json().data;
  assert.equal(analysis.coverage.result_count, 2);
  assert.equal(analysis.coverage.completion_percent, 100);
  assert.equal(analysis.attributes.find(attribute => attribute.key === 'taste').mean, 7);
  assert.equal(analysis.ranked_batches[0].batch_code, 'ANALYTICS-2');
  assert.equal(analysis.methodology.observation_unit, 'laboratory_result');

  const missing = await server.inject({
    method: 'GET',
    url: '/api/v1/formulations/not-real/sensory-analytics',
  });
  assert.equal(missing.statusCode, 404);
});

test('laboratory results support bulk import, durable editing and archive filtering', async () => {
  const imported = await server.inject({
    method: 'POST', url: '/api/v1/formulations/form-001/laboratory-results/import',
    payload: { rows: [{ batch_code: 'IMPORT-001', tested_at: '2026-09-01', measurements: { ph: 3.25, brix: 9.8 }, sensory: { overall_acceptance: 7.5 } }] },
  });
  assert.equal(imported.statusCode, 201);
  assert.equal(imported.json().imported, 1);
  const result = imported.json().data[0];
  const updated = await server.inject({
    method: 'PUT', url: `/api/v1/formulations/form-001/laboratory-results/${result.id}`,
    payload: { batch_code: 'IMPORT-001-EDITED', tested_at: '2026-09-02', measurements: { ph: 3.1 }, sensory: { overall_acceptance: 8 } },
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.json().data.batch_code, 'IMPORT-001-EDITED');
  const archived = await server.inject({ method: 'DELETE', url: `/api/v1/formulations/form-001/laboratory-results/${result.id}` });
  assert.equal(archived.statusCode, 204);
  const listed = await server.inject({ method: 'GET', url: '/api/v1/formulations/form-001/laboratory-results' });
  assert.equal(listed.json().data.some(item => item.id === result.id), false);
});

test('sensory workspace persists study design, individual responses and advanced analysis', async () => {
  const created = await server.inject({
    method: 'POST', url: '/api/v1/sensory/studies', payload: {
      name: 'Control versus reduced sugar',
      objective: 'Determine whether reduced sugar preserves sweetness and overall liking.',
      test_type: 'combined', panel_type: 'consumer', planned_panelists: 30,
      scale_min: 0, scale_max: 10, status: 'active',
      attributes: [
        { key: 'sweetness', label: 'Sweetness', category: 'taste' },
        { key: 'overall_liking', label: 'Overall liking', category: 'overall' },
      ],
      samples: [
        { formulation_id: 'form-001', sample_code: 'CTRL', blind_code: '314', label: 'Control' },
        { formulation_id: 'form-002', sample_code: 'CAND', blind_code: '729', label: 'Candidate' },
      ],
      protocol: { randomize_order: true, serving_temperature_c: 6, serving_volume_ml: 60 },
    },
  });
  assert.equal(created.statusCode, 201);
  const study = created.json().data;
  assert.equal(study.samples.length, 2);
  assert.notEqual(study.samples[0].id, study.samples[1].id);

  const responsePayload = {
    panelist_code: 'PANEL-001', segment: 'Frequent buyer',
    demographics: { age_range: '25–34', consumption_frequency: 'Weekly' },
    session: { duration_seconds: 240, serving_order: study.samples.map(sample => sample.id) },
    samples: study.samples.map((sample, index) => ({
      sample_id: sample.id,
      scores: { sweetness: index === 0 ? 8 : 6, overall_liking: index === 0 ? 9 : 7 },
      jar: { sweetness: index === 0 ? 0 : -1 },
      purchase_intent: index === 0 ? 5 : 4,
      preference_rank: index + 1,
    })),
  };
  const invalidOrder = await server.inject({
    method: 'POST', url: `/api/v1/sensory/studies/${study.id}/responses`,
    payload: { ...responsePayload, panelist_code: 'PANEL-BAD-ORDER', session: { duration_seconds: 240, serving_order: [study.samples[0].id, study.samples[0].id] } },
  });
  assert.equal(invalidOrder.statusCode, 400);
  assert.match(invalidOrder.json().error, /serving order/i);

  const response = await server.inject({ method: 'POST', url: `/api/v1/sensory/studies/${study.id}/responses`, payload: responsePayload });
  assert.equal(response.statusCode, 201);

  const duplicate = await server.inject({ method: 'POST', url: `/api/v1/sensory/studies/${study.id}/responses`, payload: responsePayload });
  assert.equal(duplicate.statusCode, 409);

  const analyticsResponse = await server.inject({ method: 'GET', url: `/api/v1/sensory/studies/${study.id}/analytics` });
  assert.equal(analyticsResponse.statusCode, 200);
  const analysis = analyticsResponse.json().data;
  assert.equal(analysis.coverage.response_count, 1);
  assert.equal(analysis.coverage.evaluation_count, 2);
  assert.equal(analysis.ranking[0].sample_id, study.samples[0].id);
  assert.ok(analysis.warnings.some(warning => warning.code === 'small_panel'));

  const listed = await server.inject({ method: 'GET', url: '/api/v1/sensory/studies' });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.json().data.find(item => item.id === study.id).response_count, 1);
});

test('sensory panel spreadsheet payload imports grouped panel responses', async () => {
  const created = await server.inject({ method: 'POST', url: '/api/v1/sensory/studies', payload: {
    name: 'Imported panel', objective: 'Verify imported panel responses become available to analytics.',
    test_type: 'hedonic', panel_type: 'internal', planned_panelists: 5, scale_min: 0, scale_max: 10, status: 'active',
    attributes: [{ key: 'aroma', label: 'Aroma', category: 'aroma' }, { key: 'overall_liking', label: 'Overall liking', category: 'overall' }],
    samples: [{ sample_code: 'S1', blind_code: '123', label: 'Sample one' }], protocol: { randomize_order: false },
  } });
  const study = created.json().data;
  const imported = await server.inject({ method: 'POST', url: `/api/v1/sensory/studies/${study.id}/responses/import`, payload: { rows: [{
    panelist_code: 'CSV-001', segment: 'Internal', samples: [{ sample_id: study.samples[0].id, scores: { aroma: 7, overall_liking: 8 }, jar: {} }],
  }] } });
  assert.equal(imported.statusCode, 201);
  assert.equal(imported.json().imported, 1);
  const analytics = await server.inject({ method: 'GET', url: `/api/v1/sensory/studies/${study.id}/analytics` });
  assert.equal(analytics.json().data.coverage.response_count, 1);
});

test('target generation uses ingredient sugar data', async () => {
  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/target-generation/generate',
    payload: { target_sugar: 10, count: 1 },
  });
  assert.equal(response.statusCode, 201);
  const candidate = response.json().data.candidates[0];
  assert.ok(candidate.calculated_values.sugar_per_100ml > 0);
  assert.ok(candidate.scores.sugar_match > 50);
  assert.equal(response.json().data.ai.used, false);
  assert.match(response.json().data.ai.reason, /GEMINI_API_KEY/);
});

test('target generation honors ingredient-count constraints and reports heuristic basis', async () => {
  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/target-generation/generate',
    payload: { count: 2, min_ingredients: 8, max_ingredients: 8 },
  });
  assert.equal(response.statusCode, 201);
  for (const candidate of response.json().data.candidates) {
    assert.equal(candidate.ingredients.length, 8);
    assert.match(candidate.scores.basis, /laboratory validation required/);
    assert.ok(Math.abs(candidate.ingredients.reduce((sum, item) => sum + item.percentage, 0) - 100) < 0.001);
  }
});

test('formulation intelligence is reproducible and exposes hard-constraint evidence', async () => {
  const payload = {
    count: 3, min_ingredients: 6, max_ingredients: 8,
    max_sugar_g_per_100ml: 8, max_calories_per_100ml: 40, max_cost_per_liter: 80,
    target_ph_min: 2.8, target_ph_max: 3.5,
    objectives: ['cost', 'sugar', 'calories'],
  };
  const first = await server.inject({ method: 'POST', url: '/api/v1/target-generation/generate', payload });
  const second = await server.inject({ method: 'POST', url: '/api/v1/target-generation/generate', payload });
  assert.equal(first.statusCode, 201);
  assert.equal(second.statusCode, 201);
  assert.equal(first.json().data.reproducibility.input_signature, second.json().data.reproducibility.input_signature);
  assert.deepEqual(first.json().data.candidates.map(item => item.ingredients), second.json().data.candidates.map(item => item.ingredients));
  const feasible = first.json().data.candidates.filter(item => item.feasible);
  assert.ok(feasible.length > 0);
  for (const candidate of feasible) {
    assert.ok(candidate.pareto_rank >= 1);
    assert.ok(candidate.constraint_results.every(item => item.status !== 'fail'));
    assert.equal(candidate.constraint_results.find(item => item.key === 'ph_min').status, 'not_evaluable');
    assert.equal(candidate.validation_status, 'candidate_for_laboratory_validation');
  }
});

test('formulation intelligence rejects impossible constraints with structured blockers', async () => {
  const response = await server.inject({
    method: 'POST', url: '/api/v1/target-generation/generate',
    payload: { required_ingredient_ids: ['ing-sweet-001'], forbidden_ingredient_ids: ['ing-sweet-001'] },
  });
  assert.equal(response.statusCode, 422);
  assert.equal(response.json().code, 'FORMULATION_CONSTRAINTS_INFEASIBLE');
  assert.ok(response.json().data.feasibility.blockers.some(item => item.code === 'REQUIRED_AND_FORBIDDEN'));
});

test('legacy target generator is not exposed', async () => {
  const response = await server.inject({ method: 'POST', url: '/api/v1/target-generation/generate-legacy', payload: {} });
  assert.equal(response.statusCode, 404);
});

test('required and forbidden ingredients are deterministically enforced and saved from the owned run', async () => {
  const generated = await server.inject({
    method: 'POST', url: '/api/v1/target-generation/generate',
    payload: { count: 2, required_ingredient_ids: ['ing-juice-001'], forbidden_ingredient_ids: ['ing-sweet-001'], minimum_juice_percent: 5, ingredient_bounds: [{ ingredient_id: 'ing-juice-001', min_percentage: 7, max_percentage: 12 }] },
  });
  assert.equal(generated.statusCode, 201);
  const data = generated.json().data;
  for (const candidate of data.candidates) {
    assert.ok(candidate.ingredients.some(item => item.ingredient_id === 'ing-juice-001'));
    assert.ok(!candidate.ingredients.some(item => item.ingredient_id === 'ing-sweet-001'));
    assert.ok(candidate.ingredients.find(item => item.ingredient_id === 'ing-juice-001').percentage >= 7);
  }
  const saved = await server.inject({
    method: 'POST', url: '/api/v1/target-generation/save',
    payload: { run_id: data.run_id, candidate_id: data.candidates[0].id, name: 'Reproducible constraint candidate' },
  });
  assert.equal(saved.statusCode, 201);
  assert.equal(saved.json().data.generation_run_id, data.run_id);
  assert.equal(saved.json().data.generation_input_signature, data.reproducibility.input_signature);
});

test('ROI endpoint returns a real profitability calculation', async () => {
  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/cost/formulations/form-001/roi',
    payload: { batch_size_liters: 100, selling_price_per_liter: 50 },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.total_cost, 2550);
  assert.equal(response.json().data.total_revenue, 5000);
  assert.equal(response.json().data.profit, 2450);
  assert.equal(response.json().data.estimated_revenue, 5000);
  assert.ok(response.json().data.roi_percent > 0);
});

test('frontend AI generation and acceptance workflow is supported', async () => {
  const generatedResponse = await server.inject({
    method: 'POST',
    url: '/api/v1/ai/formulations/form-001/generate',
    payload: { count: 2, generation_type: 'optimization' },
  });
  assert.equal(generatedResponse.statusCode, 201);
  const generatedPayload = generatedResponse.json();
  assert.equal(generatedPayload.data.length, 2);
  assert.equal(generatedPayload.ai.used, false);
  assert.match(generatedPayload.ai.reason, /GEMINI_API_KEY/);

  const variant = generatedPayload.data[0];
  const calculatedCost = variant.variant_ingredients.reduce((sum, item) =>
    sum + (item.percentage / 100) * getIngredientById(item.ingredient_id).base_price_per_kg, 0
  );
  assert.ok(Math.abs(variant.calculated_values.cost_per_liter - calculatedCost) < 0.000001);
  assert.equal(variant.regulatory.passes_local_checks, true);
  const acceptedResponse = await server.inject({
    method: 'POST',
    url: `/api/v1/ai/variants/${variant.id}/accept`,
    payload: {
      variant_data: {
        ingredients: [{ ingredient_id: INGREDIENT_IDS.WATER, percentage: 100 }],
        source_name: 'Classic Orange Soda',
        beverage_type: 'carbonated',
        explanation: variant.explanation,
      },
    },
  });
  assert.equal(acceptedResponse.statusCode, 201);
  assert.equal(acceptedResponse.json().data.total_percentage, 100);
  assert.ok(Math.abs(acceptedResponse.json().data.total_cost_per_liter - calculatedCost) < 0.000001);
});

test('regulatory checks and generated labels can be retrieved', async () => {
  const complianceResponse = await server.inject({ method: 'POST', url: '/api/v1/regulatory/formulations/form-001/check' });
  assert.equal(complianceResponse.statusCode, 201);

  const storedResponse = await server.inject({ method: 'GET', url: '/api/v1/regulatory/formulations/form-001/compliance' });
  assert.equal(storedResponse.statusCode, 200);
  assert.equal(storedResponse.json().data.formulation_id, 'form-001');

  const labelsResponse = await server.inject({ method: 'POST', url: '/api/v1/regulatory/formulations/form-001/labels' });
  assert.equal(labelsResponse.statusCode, 201);
  const englishResponse = await server.inject({ method: 'GET', url: '/api/v1/regulatory/formulations/form-001/labels?language=en' });
  assert.equal(englishResponse.statusCode, 200);
  assert.equal(englishResponse.json().data.name, 'Classic Orange Soda');
});

test('batch costing returns the fields rendered by the frontend', async () => {
  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/cost/formulations/form-001/batch-cost',
    payload: { batch_size_liters: 1000, overhead_percent: 15, margin_percent: 30 },
  });
  assert.equal(response.statusCode, 201);
  assert.equal(response.json().data.breakdown.estimated_profit, response.json().data.breakdown.margin);
  assert.equal(response.json().data.breakdown.roi_percent, 30);
  assert.ok(response.json().data.per_liter.final_price > response.json().data.per_liter.total_cost);
});

test('advanced costing persists yield, conversion, channel and investment economics', async () => {
  const response = await server.inject({ method: 'POST', url: '/api/v1/cost/formulations/form-001/batch-cost', payload: {
    batch_size_liters: 1000, package_volume_ml: 330, process_loss_percent: 3, ingredient_waste_percent: 2,
    packaging_cost_per_unit: 18, secondary_packaging_per_unit: 3, labor_hours: 16, labor_rate_per_hour: 450,
    utilities_per_liter: 2.5, quality_cost_per_batch: 3500, logistics_per_batch: 10000,
    target_margin_percent: 30, distributor_margin_percent: 12, retailer_margin_percent: 18,
    selling_price_per_unit: 90, capex: 500000, working_capital: 250000, planned_batches_per_year: 48,
  } });
  assert.equal(response.statusCode, 201);
  const data = response.json().data;
  assert.equal(data.production.saleable_liters, 970);
  assert.ok(data.breakdown.packaging_cost > 0);
  assert.ok(data.unit_economics.suggested_retail_price > data.unit_economics.target_ex_factory_price);
  assert.ok(data.investment.break_even_units > 0);
  const history = await server.inject({ method: 'GET', url: '/api/v1/cost/formulations/form-001/batch-costs' });
  assert.ok(history.json().data.some(item => item.id === data.id));
});

test('ingredient lookup by code is implemented', async () => {
  const response = await server.inject({ method: 'GET', url: '/api/v1/ingredients/code/SWEET-001' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.sugar_g, 100);
  assert.equal(response.json().data.currency, 'DZD');
});

test('ingredient catalog contains at least 300 complete halal non-intoxicating beverage entries priced in DZD', () => {
  const requiredProperties = [
    'id', 'code', 'name', 'name_en', 'name_ar', 'name_fr', 'category', 'subcategory',
    'ph_min', 'ph_max', 'solubility_g_per_100ml', 'density_g_per_ml', 'taste_profile',
    'color', 'halal_certified', 'halal_eligibility', 'vegan', 'regulatory_status',
    'regulatory_note', 'max_percentage', 'base_price_per_kg', 'currency', 'price_basis',
    'price_as_of', 'calories_per_100g', 'protein_g', 'carbs_g', 'sugar_g', 'fat_g',
    'nutrition_basis', 'is_active',
  ];
  assert.ok(ingredients.length >= 300);
  assert.equal(ingredients.every(item => item.halal_certified), true);
  assert.equal(ingredients.every(item => item.currency === 'DZD' && Number.isFinite(item.base_price_per_kg)), true);
  assert.equal(ingredients.some(item => /alcohol|ethanol|wine|beer|rum|brandy|whisk|vodka|liqueur|gelatin|carmine|shellac/i.test(item.name)), false);
  assert.deepEqual(ingredients.filter(item => requiredProperties.some(property => item[property] === undefined || item[property] === null)), []);
});

test('Gemini responses are schema-validated before they affect candidates', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  const candidate = {
    id: 'candidate-1',
    beverage_type: 'soft_drink',
    ingredients: [{ ingredient_name: 'Water', category: 'base', percentage: 100 }],
    calculated_values: { calories_per_100ml: 0, sugar_per_100ml: 0, cost_per_liter: 5 },
    scores: { calorie_match: 100, sugar_match: 100, cost_match: 100 },
  };
  const fakeFetch = async (_url, options) => {
    assert.equal(options.headers['x-goog-api-key'], 'test-key');
    return {
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({
          reviews: [{
            id: 'candidate-1',
            compatibility: 92,
            sensory: { taste_balance: 80, sweetness_level: 75, acidity_balance: 78, flavor_intensity: 76 },
            stability: { ph_stability: 88, color_stability: 90, shelf_life_months: 9 },
            explanation: 'Conservative mock review.',
            warnings: ['Laboratory validation is still required.'],
          }],
        }) }] } }],
      }),
    };
  };

  try {
    const result = await reviewFormulationCandidates({ candidates: [candidate], constraints: {} }, fakeFetch);
    assert.equal(result.used, true);
    assert.equal(result.model, 'gemini-3.1-flash-lite');
    assert.equal(result.reviews[0].compatibility, 92);
  } finally {
    delete process.env.GEMINI_API_KEY;
  }
});

test('Gemini recommendation reviews are structured and matched to every variant', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  const variant = {
    id: 'variant-1',
    variant_ingredients: [{ ingredient_name: 'Purified Water', percentage: 100 }],
    calculated_values: { cost_per_liter: 5, calories_per_100ml: 0, sugar_per_100ml: 0 },
    cost_difference_percent: 0,
    calorie_difference_percent: 0,
    sugar_difference_percent: 0,
    compatibility_score: 100,
    regulatory: { passes_local_checks: true },
    warnings: [],
  };
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ reviews: [{
        id: 'variant-1',
        confidence_score: 91,
        explanation: 'The calculated profile is internally consistent.',
        warnings: ['Pilot testing is required.'],
        recommended: true,
      }] }) }] } }],
    }),
  });

  try {
    const result = await reviewFormulationVariants({
      sourceFormulation: { name: 'Source', beverage_type: 'soft_drink' },
      variants: [variant],
      generationType: 'optimization',
    }, fakeFetch);
    assert.equal(result.used, true);
    assert.equal(result.reviews[0].confidence_score, 91);
    assert.equal(result.reviews[0].recommended, true);
  } finally {
    delete process.env.GEMINI_API_KEY;
  }
});

test('Gemini recommendation reviews reject malformed or incomplete output', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  const input = {
    sourceFormulation: { name: 'Source', beverage_type: 'soft_drink' },
    variants: [{
      id: 'variant-1',
      variant_ingredients: [],
      calculated_values: {},
      cost_difference_percent: 0,
      calorie_difference_percent: 0,
      sugar_difference_percent: 0,
      compatibility_score: 100,
      regulatory: {},
      warnings: [],
    }],
    generationType: 'optimization',
  };
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text: '{"reviews":[]}' }] } }] }),
  });

  try {
    await assert.rejects(() => reviewFormulationVariants(input, fakeFetch), /at least 1 element|every item exactly once/);
  } finally {
    delete process.env.GEMINI_API_KEY;
  }
});

test('formulation edits save beverage type and ingredient price edits recalculate costs', async () => {
  const updateResponse = await server.inject({
    method: 'PUT',
    url: '/api/v1/formulations/form-001',
    payload: { beverage_type: 'juice' },
  });
  assert.equal(updateResponse.statusCode, 200);
  assert.equal(updateResponse.json().data.beverage_type, 'juice');

  const before = (await server.inject({ method: 'GET', url: '/api/v1/formulations/form-001' })).json().data;
  const priceResponse = await server.inject({
    method: 'PUT',
    url: `/api/v1/ingredients/${INGREDIENT_IDS.CANE_SUGAR}`,
    payload: { base_price_per_kg: 130 },
  });
  assert.equal(priceResponse.statusCode, 200);
  assert.ok(priceResponse.json().recalculated_formulations > 0);
  const after = (await server.inject({ method: 'GET', url: '/api/v1/formulations/form-001' })).json().data;
  assert.ok(after.total_cost_per_liter > before.total_cost_per_liter);

  const archiveResponse = await server.inject({
    method: 'DELETE',
    url: `/api/v1/ingredients/${INGREDIENT_IDS.CANE_SUGAR}`,
  });
  assert.equal(archiveResponse.statusCode, 409);

  await server.inject({ method: 'PUT', url: '/api/v1/formulations/form-001', payload: { beverage_type: 'carbonated' } });
  await server.inject({ method: 'PUT', url: `/api/v1/ingredients/${INGREDIENT_IDS.CANE_SUGAR}`, payload: { base_price_per_kg: 120 } });
});

test('draft labels localize ingredient names and carry calculated nutrition', async () => {
  const response = await server.inject({ method: 'GET', url: '/api/v1/regulatory/formulations/form-001/labels?language=ar' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.ingredients[0].name, 'ماء نقي');
  assert.equal(response.json().data.nutrition.sugar, 10);
  assert.match(response.json().data.notice, /مراجعة/);
});

test('recommendation constraints affect calculated output and alternatives substitute ingredients', async () => {
  const constrained = await server.inject({
    method: 'POST',
    url: '/api/v1/ai/formulations/form-001/generate',
    payload: { count: 1, generation_type: 'constraint_based', target_sugar: 5 },
  });
  assert.equal(constrained.statusCode, 201);
  assert.ok(Math.abs(constrained.json().data[0].calculated_values.sugar_per_100ml - 5) < 0.1);

  const alternative = await server.inject({
    method: 'POST',
    url: '/api/v1/ai/formulations/form-001/generate',
    payload: { count: 1, generation_type: 'alternative' },
  });
  assert.equal(alternative.statusCode, 201);
  const sourceIds = new Set((await server.inject({ method: 'GET', url: '/api/v1/formulations/form-001' })).json().data.ingredients.map(item => item.ingredient_id));
  assert.ok(alternative.json().data[0].variant_ingredients.some(item => !sourceIds.has(item.ingredient_id)));
});
