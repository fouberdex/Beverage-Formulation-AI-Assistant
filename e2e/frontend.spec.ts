import { expect, test, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const formulation = (index: number) => ({
  id: `form-${index}`, code: `FORM-${index}`, name: `Formula ${index}`,
  beverage_type: 'soft_drink', version: 1, is_latest_version: true, status: 'draft',
  total_percentage: 100, total_cost_per_liter: 40, total_calories_per_100ml: 30,
  total_sugar_per_100ml: 7, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', ingredients: [],
});

async function mockApi(page: Page, options: { formulationStatus?: number; withProject?: boolean; projectBriefStatus?: 'draft' | 'validated'; withApprovalEvidence?: boolean } = {}) {
  let projectBriefStatus = options.projectBriefStatus || 'validated';
  const controlledDocument = { id: 'document-1', project_id: 'project-1', supplier_id: 'supplier-1', supplier_material_id: 'material-1', formulation_version_id: 'form-1', document_type: 'technical_data_sheet', title: 'Citric acid technical data sheet', file_name: 'citric-acid-tds.pdf', mime_type: 'application/pdf', size_bytes: 24500, sha256: 'a'.repeat(64), storage_reference: 'supabase://controlled-documents/citric-acid-tds.pdf', source: 'Qualified supplier portal', extraction_status: 'extracted', extracted_text: 'Purity specification and storage instructions.', review_status: 'accepted', reviewed_at: '2026-09-15T08:00:00Z', created_at: '2026-09-15T07:00:00Z', updated_at: '2026-09-15T08:00:00Z' };
  await page.route('**/api/v1/**', async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    const reply = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'x-request-id': 'e2e-request' } });
    if (path === '/ingredients/meta/stats') return reply({ data: { total_ingredients: 42 } });
    if (path === '/ingredients/meta/categories') return reply({ data: ['base', 'flavor'] });
    const catalog = [{ id: 'water-1', name: 'Purified Water', category: 'base' }, { id: 'sugar-1', name: 'Cane Sugar', category: 'sweetener' }, { id: 'acid-1', name: 'Citric Acid', category: 'acidulant' }, { id: 'flavor-1', name: 'Lemon Flavor', category: 'flavor' }, { id: 'pres-1', name: 'Sodium Benzoate', category: 'preservative' }];
    if (path === '/ingredients') return reply({ data: catalog, pagination: { total: catalog.length, limit: 500, offset: 0, has_more: false } });
    if (path === '/supply-chain') return reply({ data: options.withApprovalEvidence ? { suppliers: [{ id: 'supplier-1', name: 'Atlas Ingredients', status: 'qualified', country: 'Algeria', contact_name: '', contact_email: '', phone: '', certifications: [], qualification_score: 88, notes: '', created_at: '2026-09-15T00:00:00Z', updated_at: '2026-09-15T00:00:00Z' }], supplier_materials: [{ id: 'material-1', supplier_id: 'supplier-1', material_code: 'CITRIC-01', name: 'Citric acid', status: 'approved', manufacturing_site: '', currency: 'DZD', price_per_kg: 420, moq_kg: 25, lead_time_days: 10, allergens: [], certifications: [], notes: '', created_at: '2026-09-15T00:00:00Z', updated_at: '2026-09-15T00:00:00Z' }], material_specifications: [{ id: 'material-spec-1', supplier_material_id: 'material-1', name: 'Citric acid incoming specification', version: 1, status: 'draft', limits: [{ key: 'purity', label: 'Purity', unit: '%', lower: 99.5, upper: 100, method: 'Supplier CoA' }], notes: '', created_at: '2026-09-15T00:00:00Z', updated_at: '2026-09-15T00:00:00Z' }], packaging_components: [] } : { suppliers: [], supplier_materials: [], material_specifications: [], packaging_components: [] } });
    const project = { id: 'project-1', code: 'RD-2026-001', name: 'Citrus launch', business_objective: 'Validate a stable citrus beverage for the Algerian market.', target_market: 'Algeria', beverage_category: 'carbonated soft drink', target_claims: ['low sugar'], brief_status: projectBriefStatus, ingredient_constraints: { required: ['water'], forbidden: [], notes: '' }, cost_objectives: { currency: 'DZD', max_cost_per_liter: 60 }, nutrition_objectives: {}, regulatory_constraints: { markets: ['Algeria'], certifications: [], forbidden_additives: [] }, success_criteria: ['Overall liking at least 7/10'], priority: 'high', stage: 'laboratory', status: 'active', event_count: 2, created_at: '2026-09-15T00:00:00Z', updated_at: '2026-09-15T00:00:00Z' };
    const passport = { engine_version:'2.0.0',project_id:project.id,formulation_version_id:'form-1',formulation_version:1,generated_at:'2026-09-15T10:00:00Z',project:{id:project.id,code:project.code,name:project.name,stage:project.stage,status:project.status,target_market:project.target_market,beverage_category:project.beverage_category},readiness:{score_percent:40,passed_gates:4,total_gates:10,status:'in_progress',gates:[{key:'validated_brief',label:'Validated R&D brief',status:'pass',entity_ids:[],explanation:'The structured R&D brief is validated.'},{key:'approved_formulation',label:'Approved exact formulation',status:'missing',entity_ids:['form-1'],explanation:'The target formulation is not approved.'}]},evidence_chain:{formulation:['form-1']},graph:{nodes:[{id:'project:project-1',entity_type:'project',entity_id:'project-1',label:'RD-2026-001 · Citrus launch',status:'active'}],edges:[],node_count:1,edge_count:0},unresolved_blockers:[],summary:{formulations:1,laboratory_results:0,sensory_studies:0,experimental_plans:1,pilot_batches:1,stability_programs:0,stability_observations:0,decisions:0,product_specifications:0,specification_approvals:0,documents:0,packaging_configurations:0,production_trials:0,qc_releases:0,quality_events:0,capa_actions:0},limitations:['This passport is restricted to formulation FORM-1 v1 (form-1); evidence from other versions is excluded.','This calculated passport is not a regulatory certificate or an automatic market-release authorization.'] };
    const developmentState = () => { const briefValidated = projectBriefStatus === 'validated'; const keys = ['validated_brief','approved_formulation','experimental_plan','pilot_evidence','laboratory_evidence','sensory_evidence','stability_evidence','go_decision','approved_specification','approved_packaging','completed_scale_up','released_qc','quality_clearance']; const gates = keys.map(key => ({ key, label: key.replaceAll('_',' '), status: key === 'validated_brief' && briefValidated || key === 'quality_clearance' ? 'pass' : 'missing', entity_ids: [] })); return { engine_version:'1.1.0',calculated_at:'2026-09-15T10:00:00Z',project_id:'project-1',target_formulation_version_id:'form-1',current_stage:briefValidated?'formulation_approval':'brief',next_controlled_action:briefValidated?{key:'approved_formulation',label:'Review and approve a formulation version',detail:'Experimental work must reference a controlled exact version.'}:{key:'validated_brief',label:'Validate the structured brief',detail:'Confirm measurable constraints and success criteria.'},blockers:[],evidence_chain:{formulation:['form-1']},readiness:{status:'in_progress',score_percent:briefValidated?15:8,passed_gates:briefValidated?2:1,total_gates:13,gates},reformulation_required:{required:false,trigger:null,recommended_path:'continue_controlled_workflow',reason:'No persisted evidence currently requires reformulation.',entity_ids:[]},release_eligible:false }; };
    if (path === '/projects/project-1/brief' && route.request().method() === 'PUT') { projectBriefStatus = route.request().postDataJSON().validate ? 'validated' : 'draft'; return reply({ data: { ...project, brief_status: projectBriefStatus }, allowed_transitions: ['formulation', 'sensory'] }); }
    if (path === '/projects/project-1' && route.request().method() === 'PUT') return reply({ data: { ...project, ...route.request().postDataJSON(), brief_status: projectBriefStatus } });
    if (path === '/projects/project-1') return reply({ data: { ...project, development_state:developmentState(), product_passport:passport, execution_available: true, events: [{ id: 'event-1', project_id: project.id, event_type: 'experimental_plan_created', details: { plan_id: 'plan-1' }, created_at: '2026-09-15T09:00:00Z' }], traceability: { formulations: [{ ...formulation(1), locked_at: null }], laboratory_results: [], sensory_studies: [], experimental_plans: [{ id: 'plan-1', project_id: project.id, formulation_version_id: 'form-1', name: 'Citrus pilot', objective: 'Validate pilot stability.', hypothesis: 'The pilot remains stable.', status: 'ready', planned_runs: 3, protocol: { method: 'Controlled pilot', variables: ['scale'], controls: ['reference'], procedure_steps: ['Mix and fill'], acceptance_criteria: ['pH in target'] }, design: { engine_version: '1.0.0', signature: 'doe-signature', design_type: 'full_factorial', run_count: 3, center_points: 1, replicates: 1, factors: [{ key: 'temperature', label: 'Temperature', low: 20, high: 35, unit: '°C' }], responses: [{ key: 'stability', label: 'Stability', goal: 'maximize', unit: '/10' }], runs: [{ id: 'DOE-001', standard_order: 1, replicate: 1, factor_settings: { temperature: { coded: -1, value: 20, unit: '°C' } } }, { id: 'DOE-002', standard_order: 2, replicate: 1, factor_settings: { temperature: { coded: 1, value: 35, unit: '°C' } } }, { id: 'DOE-003', standard_order: 3, replicate: 1, factor_settings: { temperature: { coded: 0, value: 27.5, unit: '°C' } } }] }, created_at: '2026-09-15T09:00:00Z', updated_at: '2026-09-15T09:00:00Z' }], pilot_batches: [{ id: 'batch-1', project_id: project.id, experimental_plan_id: 'plan-1', formulation_version_id: 'form-1', batch_code: 'PILOT-001', batch_size_liters: 20, status: 'planned', actual_quantities: [], procedure_notes: '', deviations: [], observations: '', conclusion: '', created_at: '2026-09-15T09:00:00Z', updated_at: '2026-09-15T09:00:00Z' }], milestones: [], decisions: [], documents: options.withApprovalEvidence ? [controlledDocument] : [] } }, allowed_transitions: ['formulation', 'sensory'] });
    if (path === '/workspace-search') return reply({ data:[{id:'project-1',type:'project',title:'Citrus launch',subtitle:'RD-2026-001 · carbonated soft drink · Algeria',reference:'RD-2026-001',status:'active',project_id:'project-1',route:'/projects?project=project-1',score:110}] });
    if (path === '/projects/project-1/experimental-plans/plan-1/analysis') return reply({ data: { engine_version: '1.0.0', design_signature: 'doe-signature', observation_count: 0, completed_run_count: 0, remaining_run_count: 3, models: { stability: { status: 'insufficient_data', observations: 0, required: 3 } }, next_run: { run_id: 'DOE-001', standard_order: 1, factor_settings: { temperature: { coded: -1, value: 20, unit: '°C' } }, predicted_primary_response: null, response_key: 'stability', basis: 'deterministic_design_order', warning: 'Insufficient recorded results for model-based selection; this is the next unexecuted design run.' }, applicability: { inferential_claims_allowed: false, reason: 'Screening only.' } } });
    if (path === '/projects') return reply({ data: options.withProject ? [project] : [], stages: ['brief', 'concept', 'formulation', 'laboratory', 'sensory', 'validation', 'industrialization', 'launched'], pagination: { total: options.withProject ? 1 : 0, limit: 12, offset: 0, has_more: false } });
    if (path === '/ai/governance') return reply({ data: {
      provider: { provider: 'google-gemini', model: 'test-model', configured: true },
      privacy: { external_processing_enabled: false, include_formulation_name: false, prompt_or_response_content_stored: false },
      quota: { daily_used: 0, daily_limit: 25, daily_remaining: 25, monthly_used: 0, monthly_limit: 250, monthly_remaining: 250 },
    } });
    if (path === '/formulations' && options.formulationStatus) return reply({ error: 'Backend exploded' }, options.formulationStatus);
    if (path === '/formulations') {
      const limit = Number(url.searchParams.get('limit') || 12);
      const offset = Number(url.searchParams.get('offset') || 0);
      const all = Array.from({ length: 13 }, (_, index) => formulation(index + 1));
      return reply({ data: all.slice(offset, offset + limit), pagination: { total: all.length, limit, offset, has_more: offset + limit < all.length } });
    }
    if (/^\/formulations\/[^/]+\/versions$/.test(path)) return reply({ data: [formulation(1)] });
    if (/^\/regulatory\/formulations\/[^/]+\/stability-evidence$/.test(path)) return reply({ data: {
      formulation_version_id: path.split('/')[3], requested_shelf_life: { months: 12, comparison_days: 360, conversion_basis: '30 days per requested label month; comparison only' },
      observed_coverage_days: 90, validated_coverage_days: 0, gap_days: 360, status: 'not_substantiated',
      review_gate: { status: 'blocked', reason: 'The requested duration exceeds completed, fully observed stability evidence for this exact formulation version.' },
    } });
    if (path === '/target-generation/runs' || path === '/audit') return reply({ data: [], pagination: { total: 0, limit: 10, offset: 0, has_more: false } });
    if (path === '/target-generation/generate' && route.request().method() === 'POST') return reply({ data: {
      run_id: 'run-1', feasibility: { feasible: true, blocker_count: 0, feasible_candidate_count: 1, generated_candidate_count: 1 },
      reproducibility: { deterministic: true, engine_version: '2.0.0', input_signature: '1234567890abcdef1234567890abcdef' },
      candidates: [{ id: 'candidate-1', feasible: true, pareto_rank: 1, strategy: 'cost', beverage_type: 'soft_drink', validation_status: 'candidate_for_laboratory_validation',
        ingredients: [{ ingredient_id: 'water-1', ingredient_name: 'Purified Water', category: 'base', percentage: 91.53 }, { ingredient_id: 'sugar-1', ingredient_name: 'Cane Sugar', category: 'sweetener', percentage: 8 }, { ingredient_id: 'acid-1', ingredient_name: 'Citric Acid', category: 'acidulant', percentage: .25 }, { ingredient_id: 'flavor-1', ingredient_name: 'Lemon Flavor', category: 'flavor', percentage: .18 }, { ingredient_id: 'pres-1', ingredient_name: 'Sodium Benzoate', category: 'preservative', percentage: .04 }],
        calculated_values: { sugar_per_100ml: 8, calories_per_100ml: 30.96, cost_per_liter: 15.2 },
        constraint_results: [{ key: 'total_percentage', label: 'Total composition', status: 'pass', actual: 100, comparator: 'equal', limit: 100, unit: '%', basis: 'Calculated from candidate composition' }, { key: 'ph_min', label: 'Minimum finished-product pH', status: 'not_evaluable', actual: null, comparator: 'min', limit: 2.8, unit: 'pH', basis: 'Laboratory measurement required' }],
        trade_offs: ['Optimized primarily for cost.'], assumptions: ['1 kg/L planning density used.'] }], ai: { used: false },
    } }, 201);
    if (path === '/target-generation/save' && route.request().method() === 'POST') return reply({ data: { ...formulation(20), name: 'Constraint candidate 1 · soft_drink', generation_run_id: 'run-1' } }, 201);
    return reply({ data: [] });
  });
}

async function useRole(page: Page, role: 'admin' | 'formulator' | 'viewer') {
  await page.addInitScript(value => localStorage.setItem('e2e-role', value), role);
}

test('viewer navigation and formulation actions are read-only', async ({ page }) => {
  await useRole(page, 'viewer'); await mockApi(page); await page.goto('/formulations');
  await expect(page.getByRole('heading', { name: 'Formulations' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'AI Engine' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create Formulation' })).toHaveCount(0);
  await page.getByRole('button', { name: /^Formula 1 / }).click();
  await expect(page.getByRole('heading', { name: 'Formulation Details' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Update Formulation' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('viewer is blocked from a privileged URL entered directly', async ({ page }) => {
  await useRole(page, 'viewer'); await mockApi(page); await page.goto('/ai');
  await expect(page.getByRole('heading', { name: 'Access restricted' })).toBeVisible();
  await expect(page.getByText('viewer role cannot open this workspace')).toBeVisible();
});

test('administrator sees privileged navigation and ingredient management', async ({ page }) => {
  await useRole(page, 'admin'); await mockApi(page); await page.goto('/ingredients');
  await expect(page.getByRole('link', { name: 'AI Engine' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Ingredient' })).toBeVisible();
});

test('AI provider processing requires explicit account consent', async ({ page }) => {
  await useRole(page, 'viewer'); await mockApi(page); await page.goto('/account');
  const consent = page.getByRole('checkbox', { name: /Allow external AI review/ });
  await expect(consent).not.toBeChecked();
  await expect(page.getByText(/does not store provider prompts or responses/i)).toBeVisible();
  await consent.check();
  const requestPromise = page.waitForRequest(request => request.url().includes('/api/v1/ai/preferences') && request.method() === 'PUT');
  await page.getByRole('button', { name: 'Save AI privacy' }).click();
  const request = await requestPromise;
  expect(request.postDataJSON()).toEqual({ external_processing_enabled: true, include_formulation_name: false });
  await expect(page.getByRole('status')).toContainText('AI privacy preferences updated');
});

test('formulations paginate using the API total', async ({ page }) => {
  await useRole(page, 'formulator'); await mockApi(page); await page.goto('/formulations');
  await expect(page.getByText('Showing 1–12 of 13')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Showing 13–13 of 13')).toBeVisible();
  await expect(page.getByRole('button', { name: /Formula 13/ })).toBeVisible();
});

test('API failures are announced with a support reference', async ({ page }) => {
  await useRole(page, 'formulator'); await mockApi(page, { formulationStatus: 500 }); await page.goto('/formulations');
  await expect(page.getByRole('alert')).toContainText('temporarily unavailable');
  await expect(page.getByRole('alert')).toContainText('e2e-request');
});

test('expired sessions return the user to sign in', async ({ page }) => {
  await useRole(page, 'formulator'); await mockApi(page, { formulationStatus: 401 }); await page.goto('/formulations');
  await expect(page.getByRole('heading', { name: 'BeverageAI DZ' })).toBeVisible();
  await expect(page.locator('form').getByRole('button', { name: 'Sign in' })).toBeVisible();
});

test('dashboard has no serious automated accessibility violations', async ({ page }) => {
  await useRole(page, 'viewer'); await mockApi(page); await page.goto('/');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter(violation => ['serious', 'critical'].includes(violation.impact || ''))).toEqual([]);
});

test('core workspace pages have no serious automated accessibility violations', async ({ page }) => {
  test.setTimeout(180_000);
  await useRole(page, 'admin'); await mockApi(page);
  for (const path of ['/projects', '/ingredients', '/formulations', '/compatibility', '/history', '/account', '/laboratory-results', '/sensory', '/labels', '/regulatory', '/cost', '/ai', '/target-generation']) {
    await page.goto(path);
    await expect(page.locator('h1')).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter(violation => ['serious', 'critical'].includes(violation.impact || '')), path).toEqual([]);
  }
});

test('new production workspaces are reachable and expose their primary controls', async ({ page }) => {
  await useRole(page, 'admin'); await mockApi(page);
  await page.goto('/projects');
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  await page.getByRole('button', { name: 'New project' }).first().click();
  await expect(page.getByRole('heading', { name: 'New R&D project' })).toBeVisible();
  await expect(page.getByText('Project identity')).toBeVisible();
  await expect(page.getByText('Business brief')).toBeVisible();
  await expect(page.getByText('Ingredient constraints')).toBeVisible();
  await expect(page.getByText('Nutrition / formulation targets')).toBeVisible();
  await expect(page.getByText('Cost target')).toBeVisible();
  await expect(page.getByText('Regulatory requirements')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Validate brief' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.goto('/laboratory-results');
  await expect(page.getByRole('heading', { name: 'Laboratory Results' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import CSV / Excel' })).toBeVisible();
  await page.goto('/sensory');
  await expect(page.getByRole('heading', { name: 'Sensory Analysis' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Panel data' })).toBeVisible();
  await page.goto('/labels');
  await expect(page.getByRole('heading', { name: 'Label Studio' })).toBeVisible();
  await page.getByRole('tab', { name: 'Label Builder' }).click();
  await expect(page.getByRole('button', { name: 'Generate and save label draft' })).toBeVisible();
  await page.goto('/cost');
  await expect(page.getByRole('heading', { name: 'Cost, Price & ROI' })).toBeVisible();
  await expect(page.getByText('Packaging & conversion')).toBeVisible();
  await page.goto('/rag');
  await expect(page.getByRole('heading', { name: 'Patent & Publication RAG' })).toBeVisible();
});

test('project execution workspace exposes protocols, pilot batches, gates, decisions and timeline', async ({ page }) => {
  await useRole(page, 'admin'); await mockApi(page, { withProject: true }); await page.goto('/projects');
  await page.getByRole('button', { name: /Citrus launch/ }).click();
  await expect(page.getByLabel('Current project context')).toContainText('RD-2026-001');
  await expect(page.getByRole('heading', { name: 'Closed-loop R&D workflow' })).toBeVisible();
  await expect(page.getByText('Formula 1 · v1 · FORM-1')).toBeVisible();
  await expect(page.getByText('Review and approve a formulation version')).toBeVisible();
  await expect(page.getByLabel('R&D lifecycle status').getByText('Pilot / lab batch')).toBeVisible();
  await expect(page.getByLabel('R&D lifecycle status').getByText('Quality clearance')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'R&D experimental workspace' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Experimental plans' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'New plan' })).toBeVisible();
  await page.getByRole('tab', { name: 'DOE & next run' }).click();
  await expect(page.getByText('Deterministic design of experiments')).toBeVisible();
  await expect(page.getByText('DOE-001')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export DOE' })).toBeEnabled();
  await page.getByRole('button', { name: 'Refresh analysis' }).click();
  await expect(page.getByText('Next controlled run')).toBeVisible();
  await expect(page.getByText('deterministic design order')).toBeVisible();
  await page.getByRole('tab', { name: 'Pilot batches' }).click();
  await expect(page.getByText('Pilot batch execution')).toBeVisible();
  await page.getByRole('button', { name: 'Complete record' }).click();
  await page.getByRole('textbox', { name: 'Actual weights and material lots' }).fill('Water | 18 | l | WATER-2409');
  const batchRequest = page.waitForRequest(request => request.url().includes('/pilot-batches/batch-1') && request.method() === 'PUT');
  await page.getByRole('button', { name: 'Save execution record' }).click();
  expect((await batchRequest).postDataJSON().actual_quantities[0]).toEqual({ material_name: 'Water', quantity: 18, unit: 'l', lot_code: 'WATER-2409' });
  await page.getByRole('tab', { name: 'Stability & specs' }).click();
  await expect(page.getByText('Stability programs & controlled specifications')).toBeVisible();
  await expect(page.getByRole('button', { name: 'New program' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New specification' })).toBeVisible();
  await page.getByRole('tab', { name: 'Supply & packaging' }).click();
  await expect(page.getByText('Suppliers, evidence & packaging')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Supplier', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Documents' }).click();
  await expect(page.getByRole('button', { name: 'Register document' })).toBeVisible();
  await page.getByRole('tab', { name: 'Packaging', exact: true }).click();
  await expect(page.getByText('Packaging component library')).toBeVisible();
  await page.getByRole('tab', { name: 'Industrial quality' }).click();
  await expect(page.getByText('Industrialization and quality loop')).toBeVisible();
  await expect(page.getByRole('button', { name: 'New production trial' })).toBeVisible();
  await page.getByRole('tab', { name: 'QC release' }).click();
  await expect(page.getByText('Deterministic QC disposition')).toBeVisible();
  await page.getByRole('tab', { name: 'OOS, deviations & CAPA' }).click();
  await expect(page.getByRole('button', { name: 'Open quality event' })).toBeVisible();
  await page.getByRole('tab', { name: 'Product passport' }).click();
  await expect(page.getByText('Evidence map for RD-2026-001')).toBeVisible();
  await expect(page.getByText('form-1 · v1')).toBeVisible();
  await expect(page.getByText('40%', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search workspace records' }).fill('Citrus launch');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText('RD-2026-001 · carbonated soft drink · Algeria')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Milestones' }).click();
  await expect(page.getByRole('button', { name: 'New milestone' })).toBeVisible();
  await page.getByRole('tab', { name: 'Go / No-Go' }).click();
  await expect(page.getByRole('button', { name: 'Record decision' })).toBeVisible();
  await page.getByRole('tab', { name: 'Timeline' }).click();
  await expect(page.getByText('experimental plan created')).toBeVisible();
});

test('material specification approval submits only user-entered rationale and controlled evidence', async ({ page }) => {
  await useRole(page, 'admin'); await mockApi(page, { withProject: true, withApprovalEvidence: true }); await page.goto('/projects');
  await page.getByRole('button', { name: /Citrus launch/ }).click();
  await page.getByRole('tab', { name: 'Supply & packaging' }).click();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  const rationale = 'Supplier dossier and accepted technical data sheet support these incoming limits.';
  await page.getByRole('textbox', { name: 'Approval rationale' }).fill(rationale);
  await page.getByRole('checkbox', { name: /Citric acid technical data sheet/ }).check();
  const approvalRequest = page.waitForRequest(request => request.url().includes('/material-specifications/material-spec-1/approve') && request.method() === 'POST');
  await page.getByRole('button', { name: 'Confirm approval' }).click();
  expect((await approvalRequest).postDataJSON()).toEqual({ rationale, evidence_refs: ['document-1'] });
  await expect(page.getByRole('status')).toContainText('approved from controlled evidence');
});

test('project brief stays usable on mobile and project context opens a linked formulation draft', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await useRole(page, 'admin'); await mockApi(page, { withProject: true }); await page.goto('/projects');
  await page.getByRole('button', { name: 'New project' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New R&D project' });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box?.x).toBeGreaterThanOrEqual(0);
  expect((box?.x || 0) + (box?.width || 0)).toBeLessThanOrEqual(390);
  await expect(dialog.getByLabel('Project name')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await page.goto('/formulations?project=project-1');
  const formulationDialog = page.getByRole('dialog');
  await expect(formulationDialog).toBeVisible();
  await expect(formulationDialog.getByLabel('R&D project')).toHaveValue('project-1');
});

test('project brief fields are vertically aligned and validation refreshes canonical project state', async ({ page }) => {
  await useRole(page, 'admin'); await mockApi(page, { withProject: true, projectBriefStatus: 'draft' }); await page.goto('/projects');
  await page.getByRole('button', { name: /Citrus launch/ }).click();
  await expect(page.getByText('The structured brief must be validated before an experimental plan can be created.')).toBeVisible();
  await page.getByRole('button', { name: 'Edit brief' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit project' });
  const nameField = dialog.getByLabel('Project name');
  await expect(nameField).toBeVisible();
  expect(await nameField.locator('..').evaluate(element => getComputedStyle(element).flexDirection)).toBe('column');
  expect((await nameField.boundingBox())?.width).toBeGreaterThan(400);
  const validationRequest = page.waitForRequest(request => request.url().endsWith('/projects/project-1/brief') && request.method() === 'PUT');
  await dialog.getByRole('button', { name: 'Validate brief' }).click();
  expect((await validationRequest).postDataJSON().validate).toBe(true);
  await expect(page.getByText('Structured brief validated.')).toBeVisible();
  await expect(page.getByText('The structured brief must be validated before an experimental plan can be created.')).toHaveCount(0);
  await expect(page.getByLabel('R&D lifecycle status')).toContainText('Validated');
});

test('formulation intelligence exposes deterministic constraints and saves the server-owned candidate', async ({ page }) => {
  await useRole(page, 'admin'); await mockApi(page, { withProject: true }); await page.goto('/target-generation');
  await expect(page.getByRole('heading', { name: 'Design within real constraints' })).toBeVisible();
  await page.getByRole('combobox', { name: 'R&D project' }).selectOption('project-1');
  await page.getByRole('button', { name: 'Import validated brief' }).click();
  const generationRequest = page.waitForRequest(request => request.url().endsWith('/target-generation/generate') && request.method() === 'POST');
  await page.getByRole('button', { name: 'Generate reproducible candidates' }).click();
  expect((await generationRequest).postDataJSON().project_id).toBe('project-1');
  await expect(page.getByText('Pareto frontier')).toBeVisible();
  await expect(page.getByText('Minimum finished-product pH')).toBeVisible();
  await expect(page.getByText('Lab check')).toBeVisible();
  const saveRequest = page.waitForRequest(request => request.url().endsWith('/target-generation/save') && request.method() === 'POST');
  await page.getByRole('button', { name: 'Save exact version' }).click();
  expect((await saveRequest).postDataJSON()).toMatchObject({ run_id: 'run-1', candidate_id: 'candidate-1', project_id: 'project-1' });
  await expect(page.getByText(/saved as an exact draft formulation version/i)).toBeVisible();
});

test('Label Studio tabs expose complete recipe, builder, live and report workflows', async ({ page }) => {
  await useRole(page, 'admin'); await mockApi(page); await page.goto('/labels');
  await expect(page.getByRole('tab', { name: 'Recipes' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: /Formula 1/ }).first()).toBeVisible();
  await page.getByRole('button', { name: /Formula 1/ }).first().click();
  await expect(page.getByRole('tab', { name: 'Label Builder' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Shelf-life claim not substantiated')).toBeVisible();
  await expect(page.getByText('90 days')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate and save label draft' })).toBeEnabled();
  await page.getByRole('tab', { name: 'Live Label' }).click();
  await expect(page.getByRole('heading', { name: 'No live label yet' })).toBeVisible();
  await page.getByRole('button', { name: 'Open Label Builder' }).click();
  await page.getByRole('tab', { name: 'Reports' }).click();
  await expect(page.getByRole('heading', { name: 'No label report available' })).toBeVisible();
});

test('desktop workspace navigation can collapse and expand', async ({ page }) => {
  await useRole(page, 'admin'); await mockApi(page); await page.goto('/');
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible();
});

test('theme preference persists and applies to the document', async ({ page }) => {
  await useRole(page, 'admin'); await mockApi(page); await page.goto('/');
  const selector = page.locator('select[aria-label="Color theme"]:visible').first();
  await selector.selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('select[aria-label="Color theme"]:visible').first().selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('mobile navigation traps focus, closes with Escape and restores focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await useRole(page, 'admin'); await mockApi(page); await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Open navigation' });
  await trigger.click();
  const drawer = page.getByRole('dialog', { name: 'Application navigation' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Close navigation' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('skip link reaches the main workspace and unknown routes have a coherent 404', async ({ page }) => {
  await useRole(page, 'admin'); await mockApi(page); await page.goto('/');
  const skip = page.getByRole('link', { name: 'Skip to main content' });
  await skip.focus();
  await skip.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
  await page.goto('/this-route-does-not-exist');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Return to dashboard' })).toBeVisible();
});

test('regulatory screening sends a valid JSON body from its primary button', async ({ page }) => {
  await useRole(page, 'admin'); await mockApi(page); await page.goto('/regulatory');
  const requestPromise = page.waitForRequest(request => request.url().includes('/regulatory/formulations/') && request.url().endsWith('/check'));
  await page.getByRole('button', { name: 'Check compliance' }).click();
  const request = await requestPromise;
  expect(request.method()).toBe('POST');
  expect(request.postDataJSON()).toEqual({});
});

test('cost assumptions reset visibly to the baseline', async ({ page }) => {
  await useRole(page, 'admin'); await mockApi(page); await page.goto('/cost');
  const batchSize = page.getByRole('spinbutton', { name: 'Input batch (L)' });
  await batchSize.fill('2500');
  await expect(batchSize).toHaveValue('2500');
  await page.getByTestId('reset-cost-assumptions').click();
  await expect(batchSize).toHaveValue('1000');
  await expect(page.getByRole('status')).toContainText('Assumptions restored');
});
