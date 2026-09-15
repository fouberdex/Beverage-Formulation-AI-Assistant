import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: fileURLToPath(new URL('../backend/.env', import.meta.url)) });

const baseUrl = process.env.DEMO_SMOKE_API_URL || 'http://127.0.0.1:3001/api/v1';
const required = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY'];
for (const key of required) if (!process.env[key]) throw new Error(`${key} is required in backend/.env`);

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const email = `demo-smoke-${suffix}@beverageai.local`;
const password = `Smoke-${randomUUID()}-Aa1!`;
let userId = null;
let token = '';

async function api(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    signal: AbortSignal.timeout(options.timeout || 90000),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(options.headers || {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path} -> ${response.status}: ${body?.error || text}`);
  return body;
}

function ok(name, detail = '') { console.log(`✓ ${name}${detail ? ` — ${detail}` : ''}`); }

try {
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: 'Demo smoke test' } });
  if (created.error) throw created.error;
  userId = created.data.user.id;
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  token = signedIn.data.session.access_token;
  const verifiedSession = await admin.auth.getUser(token);
  if (verifiedSession.error || verifiedSession.data.user?.id !== userId) {
    throw new Error(`Supabase session preflight failed: ${verifiedSession.error?.message || 'user mismatch'}`);
  }

  await api('/auth/me');
  ok('Authentication and profile bootstrap');

  const water = (await api('/ingredients/code/WATER-001')).data;
  const sugar = (await api('/ingredients/code/SWEET-001')).data;
  ok('Ingredient catalog connection');

  const project = (await api('/projects', { method: 'POST', body: {
    code: `RD-SMOKE-${suffix}`.slice(0, 48), name: 'Demo R&D lifecycle smoke test',
    beverage_category: 'carbonated soft drink', target_market: 'Algeria', priority: 'high',
    business_objective: 'Verify durable project lifecycle persistence before demonstration.',
  } })).data;
  await api(`/projects/${project.id}/brief`, { method: 'PUT', body: { validate: true, brief: {
    business_objective: 'Verify durable project lifecycle persistence before demonstration.',
    target_market: 'Algeria', beverage_category: 'carbonated soft drink', target_claims: ['low sugar'],
    ingredient_constraints: { required: ['water'], forbidden: [], notes: '' },
    cost_objectives: { max_cost_per_liter: 60, currency: 'DZD' },
    nutrition_objectives: { max_sugar_g_per_100ml: 10, target_ph_min: 2.8, target_ph_max: 3.5 },
    regulatory_constraints: { markets: ['Algeria'], certifications: ['Halal'], forbidden_additives: [] },
    success_criteria: ['Project data remains traceable after a complete API round trip'],
  } } });
  await api(`/projects/${project.id}/transition`, { method: 'POST', body: { stage: 'concept', note: 'Automated brief approval' } });
  const projectDetail = (await api(`/projects/${project.id}`)).data;
  if (projectDetail.stage !== 'concept' || !projectDetail.events.some(event => event.event_type === 'stage_transition')) {
    throw new Error('R&D project lifecycle was not persisted');
  }
  ok('R&D project create, update, transition and event persistence');

  const formulation = (await api('/formulations', { method: 'POST', body: {
    code: `SMOKE-${suffix}`.slice(0, 48), name: 'Demo persistence smoke test', beverage_type: 'soft_drink',
    project_id: project.id,
    ingredients: [{ ingredient_id: water.id, percentage: 90 }, { ingredient_id: sugar.id, percentage: 10 }],
  } })).data;
  await api(`/formulations/${formulation.id}`);
  await api(`/formulations/${formulation.id}`, { method: 'PUT', body: { beverage_type: 'carbonated' } });
  await api(`/formulations/${formulation.id}/approve`, { method: 'POST', body: { note: 'Automated technical approval before demonstration' } });
  ok('Formulation create, read and update persistence');

  const experimentalPlan = (await api(`/projects/${project.id}/experimental-plans`, { method: 'POST', body: {
    name: 'Demo controlled pilot', objective: 'Prove the complete project execution loop before demonstration.',
    hypothesis: 'The approved formulation will meet the documented pH and acceptance limits at pilot scale.',
    formulation_version_id: formulation.id, planned_runs: 1, status: 'ready',
    protocol: { method: 'Controlled comparative pilot', variables: ['pilot scale'], controls: ['approved formulation'],
      procedure_steps: ['Weigh the approved formula', 'Mix, process and fill'],
      acceptance_criteria: ['pH remains between 2.8 and 3.5', 'Overall acceptance reaches at least 7/10'] },
  } })).data;
  const doeDesign = (await api(`/projects/${project.id}/experimental-plans/${experimentalPlan.id}/design`, { method: 'POST', body: {
    type: 'full_factorial', center_points: 1, replicates: 1,
    factors: [{ key: 'temperature', label: 'Pasteurization temperature', low: 75, high: 85, unit: '°C' }],
    responses: [{ key: 'acceptance', label: 'Overall acceptance', goal: 'maximize', unit: '/10' }],
  } })).data;
  const pilotBatch = (await api(`/projects/${project.id}/experimental-plans/${experimentalPlan.id}/pilot-batches`, { method: 'POST', body: {
    batch_code: `PILOT-${suffix}`.slice(0, 76), formulation_version_id: formulation.id, batch_size_liters: 20,
    status: 'planned', doe_run_id: doeDesign.runs[0].id, actual_quantities: [], procedure_notes: 'Automated smoke test protocol', deviations: [], observations: '', conclusion: '',
  } })).data;
  await api(`/projects/${project.id}/pilot-batches/${pilotBatch.id}`, { method: 'PUT', body: {
    status: 'completed', produced_at: new Date().toISOString(),
    actual_quantities: [{ material_name: water.name, ingredient_id: water.id, quantity: 18, unit: 'l', lot_code: 'SMOKE-WATER-LOT' }],
    deviations: [], observations: 'Automated pilot execution record completed.', conclusion: 'Ready for laboratory testing.', response_values: { acceptance: 8 },
  } });
  const doeAnalysis = (await api(`/projects/${project.id}/experimental-plans/${experimentalPlan.id}/analysis`)).data;
  if (doeAnalysis.observation_count !== 1 || !doeAnalysis.next_run) throw new Error('DOE analysis or next-run recommendation is incomplete');
  const doeReportResponse = await fetch(`${baseUrl}/projects/${project.id}/experimental-plans/${experimentalPlan.id}/report.csv`, { headers: { authorization: `Bearer ${token}` } });
  if (!doeReportResponse.ok || !(await doeReportResponse.text()).includes(doeDesign.signature)) throw new Error('DOE audit export is incomplete');
  const milestone = (await api(`/projects/${project.id}/milestones`, { method: 'POST', body: {
    title: 'Demo evidence gate', stage: 'laboratory', status: 'planned', responsible: 'Automated smoke test',
    success_criteria: ['Protocol, pilot batch, laboratory and sensory evidence are linked'],
  } })).data;
  await api(`/projects/${project.id}/decisions`, { method: 'POST', body: {
    title: 'Demo execution decision', outcome: 'go', rationale: 'The automated workflow created every required traceability object.',
    evidence_refs: [pilotBatch.batch_code], formulation_version_id: formulation.id, milestone_id: milestone.id,
  } });
  ok('Deterministic DOE, linked pilot batch, next run, milestone and immutable decision persistence');

  const lab = (await api(`/formulations/${formulation.id}/laboratory-results`, { method: 'POST', body: {
    batch_code: 'SMOKE-LAB-1', tested_at: new Date().toISOString(), measurements: { ph: 3.2, brix: 10.1 },
    sensory: { appearance: 8, aroma: 7, taste: 8, mouthfeel: 7, overall_acceptance: 8 }, notes: 'Automated demo readiness check',
  } })).data;
  await api(`/formulations/${formulation.id}/laboratory-results/${lab.id}`, { method: 'PUT', body: { notes: 'Updated automated demo readiness check' } });
  await api(`/formulations/${formulation.id}/laboratory-results/import`, { method: 'POST', body: { rows: [{ batch_code: 'SMOKE-LAB-CSV', tested_at: new Date().toISOString(), measurements: { ph: 3.25, brix: 10 }, sensory: { overall_acceptance: 7.5 } }] } });
  const labs = (await api(`/formulations/${formulation.id}/laboratory-results`)).data;
  if (labs.length < 2) throw new Error('Laboratory persistence check returned fewer than two records');
  ok('Lab Results create, update and spreadsheet-import persistence');

  const stabilityProgram = (await api(`/projects/${project.id}/stability-programs`, { method: 'POST', body: {
    name: 'Demo stability program', formulation_version_id: formulation.id, status: 'draft', protocol: 'Store sealed packs under controlled ambient conditions.',
    storage_conditions: [{ id: 'ambient', label: 'Ambient dark', temperature_c: 25, relative_humidity_percent: 60, light_exposure: 'dark' }],
    timepoints_days: [0, 30, 90], replicates_per_timepoint: 1,
    parameters: [{ key: 'ph', label: 'Finished product pH', source: 'measurements', unit: 'pH', lower: 2.8, upper: 3.5, max_change_from_baseline: 0.2 }],
  } })).data;
  await api(`/projects/${project.id}/stability-programs/${stabilityProgram.id}/observations`, { method: 'POST', body: { laboratory_result_id: lab.id, condition_id: 'ambient', timepoint_days: 0, replicate: 1 } });
  const specification = (await api(`/projects/${project.id}/specifications`, { method: 'POST', body: {
    name: 'Demo finished-product specification', formulation_version_id: formulation.id, markets: ['Algeria'],
    limits: [{ key: 'ph', label: 'Finished product pH', source: 'measurements', unit: 'pH', lower: 2.8, upper: 3.5 }],
  } })).data;
  await api(`/projects/${project.id}/specifications/${specification.id}/approve`, { method: 'POST', body: { rationale: 'Initial laboratory evidence satisfies the controlled release range.', evidence_refs: [lab.id] } });
  const stabilityAnalysis = (await api(`/projects/${project.id}/stability-programs/${stabilityProgram.id}/analysis`)).data;
  if (stabilityAnalysis.observation_count !== 1 || stabilityAnalysis.specification?.id !== specification.id || stabilityAnalysis.extrapolation.performed) throw new Error('Stability or approved specification persistence is incomplete');
  ok('Stability timepoint, deterministic trend and immutable specification persistence');

  const study = (await api('/sensory/studies', { method: 'POST', body: {
    name: 'Demo sensory persistence check', objective: 'Verify the complete sensory workflow before the live demonstration.',
    test_type: 'hedonic', panel_type: 'internal', planned_panelists: 5, scale_min: 0, scale_max: 10, status: 'active',
    attributes: [{ key: 'aroma', label: 'Aroma', category: 'aroma' }, { key: 'overall_liking', label: 'Overall liking', category: 'overall' }],
    samples: [{ formulation_id: formulation.id, sample_code: 'SMOKE-S1', blind_code: '731', label: 'Demo sample' }],
    protocol: { randomize_order: false, serving_temperature_c: 6, serving_volume_ml: 60 },
  } })).data;
  await api(`/sensory/studies/${study.id}/responses`, { method: 'POST', body: {
    panelist_code: 'SMOKE-P1', segment: 'Internal', session: { duration_seconds: 120, serving_order: [study.samples[0].id] },
    samples: [{ sample_id: study.samples[0].id, scores: { aroma: 8, overall_liking: 8 }, jar: {}, purchase_intent: 4, preference_rank: 1 }],
  } });
  const sensory = (await api(`/sensory/studies/${study.id}/analytics`)).data;
  if (sensory.coverage.response_count !== 1) throw new Error('Sensory response was not persisted');
  ok('Sensory study, panel response and analytics persistence');

  const traceability = (await api(`/projects/${project.id}`)).data.traceability;
  if (traceability.formulations.length !== 1 || traceability.laboratory_results.length < 2 || traceability.sensory_studies.length !== 1
    || traceability.experimental_plans.length !== 1 || traceability.pilot_batches.length !== 1
    || traceability.milestones.length !== 1 || traceability.decisions.length !== 1
    || traceability.stability_programs.length !== 1 || traceability.stability_observations.length !== 1
    || traceability.product_specifications.length !== 1 || traceability.specification_approvals.length !== 1) {
    throw new Error('Cross-workspace project traceability is incomplete');
  }
  ok('Project → formulation version → laboratory → sensory traceability');

  await api(`/compatibility/formulations/${formulation.id}`);
  ok('Compatibility engine connection');

  await api(`/regulatory/formulations/${formulation.id}/check`, { method: 'POST', body: {} });
  await api(`/regulatory/formulations/${formulation.id}/labels`, { method: 'POST', body: {
    market: 'algeria', language: 'fr', net_volume_ml: 330, serving_size_ml: 330, servings_per_container: 1,
    manufacturer_name: 'Demo operator', manufacturer_address: 'Algeria', country_of_origin: 'Algeria', claims: [],
  } });
  await api(`/regulatory/formulations/${formulation.id}/labels?language=fr`);
  ok('Regulatory check and Label Studio persistence');

  await api(`/cost/formulations/${formulation.id}/batch-cost`, { method: 'POST', body: {
    batch_size_liters: 1000, package_volume_ml: 330, process_loss_percent: 3, ingredient_waste_percent: 2,
    packaging_cost_per_unit: 18, secondary_packaging_per_unit: 3, labor_hours: 16, labor_rate_per_hour: 450,
    utilities_per_liter: 2.5, quality_cost_per_batch: 3500, logistics_per_batch: 10000,
    target_margin_percent: 30, distributor_margin_percent: 12, retailer_margin_percent: 18,
    selling_price_per_unit: 90, capex: 500000, working_capital: 250000, planned_batches_per_year: 48,
  } });
  const costs = (await api(`/cost/formulations/${formulation.id}/batch-costs`)).data;
  if (!costs.length) throw new Error('Cost scenario was not persisted');
  ok('Cost and ROI persistence');

  const targetRun = (await api('/target-generation/generate', { method: 'POST', body: {
    project_id: project.id, reference_formulation_id: formulation.id, count: 3, min_ingredients: 5, max_ingredients: 10,
    max_sugar_g_per_100ml: 10, target_ph_min: 2.8, target_ph_max: 3.5,
    objectives: ['cost', 'sugar', 'reference_deviation'],
  } })).data;
  const persistedRun = (await api(`/target-generation/runs/${targetRun.run_id}`)).data;
  if (!persistedRun.reproducibility?.deterministic || !persistedRun.candidates.some(candidate => candidate.feasible && candidate.pareto_rank === 1)) {
    throw new Error('Deterministic formulation run metadata or Pareto frontier was not persisted');
  }
  const feasibleCandidate = persistedRun.candidates.find(candidate => candidate.feasible);
  const generatedFormulation = (await api('/target-generation/save', { method: 'POST', body: {
    run_id: persistedRun.id, candidate_id: feasibleCandidate.id, project_id: project.id, name: 'Smoke deterministic candidate',
  } })).data;
  if (generatedFormulation.generation_input_signature !== persistedRun.reproducibility.input_signature || generatedFormulation.project_id !== project.id) {
    throw new Error('Generated candidate provenance was not preserved on the formulation');
  }
  ok('Deterministic constraints, Pareto run and server-owned candidate persistence');

  await api('/ai/preferences', { method: 'PUT', body: { external_processing_enabled: true, include_formulation_name: false } });
  const variants = await api(`/ai/formulations/${formulation.id}/generate`, { method: 'POST', timeout: 120000, body: { count: 1, generation_type: 'optimization' } });
  if (!variants.data?.length) throw new Error('AI variant generation returned no candidate');
  ok('AI Engine and Gemini provider path', variants.ai?.used ? `Gemini ${variants.ai.model}` : `deterministic fallback: ${variants.ai?.reason || 'provider not used'}`);

  await api('/audit?limit=20');
  ok('Audit history connection');
  console.log('\nDEMO_SMOKE_OK — all critical persisted workflows passed.');
} finally {
  if (userId) {
    const removed = await admin.auth.admin.deleteUser(userId);
    if (removed.error) console.error(`Cleanup warning: ${removed.error.message}`);
    else {
      const tables = ['rd_projects', 'rd_project_events', 'rd_experimental_plans', 'rd_pilot_batches', 'rd_project_milestones', 'rd_project_decisions', 'rd_stability_programs', 'rd_stability_observations', 'rd_product_specifications', 'rd_specification_approvals', 'formulations', 'laboratory_results', 'sensory_studies', 'sensory_responses', 'compliance_records', 'batch_cost_calculations', 'target_generation_runs', 'ai_variants'];
      const leftovers = [];
      for (const table of tables) {
        const { count, error } = await admin.from(table).select('*', { head: true, count: 'exact' }).eq('owner_id', userId);
        if (!error && count) leftovers.push(`${table}:${count}`);
      }
      console.log(leftovers.length ? `Cleanup warning — ${leftovers.join(', ')}` : '✓ Temporary user and database rows cleaned');
    }
  }
}
