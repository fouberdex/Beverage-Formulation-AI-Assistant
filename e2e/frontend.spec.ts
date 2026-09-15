import { expect, test, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const formulation = (index: number) => ({
  id: `form-${index}`, code: `FORM-${index}`, name: `Formula ${index}`,
  beverage_type: 'soft_drink', version: 1, is_latest_version: true, status: 'draft',
  total_percentage: 100, total_cost_per_liter: 40, total_calories_per_100ml: 30,
  total_sugar_per_100ml: 7, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', ingredients: [],
});

async function mockApi(page: Page, options: { formulationStatus?: number; withProject?: boolean } = {}) {
  await page.route('**/api/v1/**', async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    const reply = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'x-request-id': 'e2e-request' } });
    if (path === '/ingredients/meta/stats') return reply({ data: { total_ingredients: 42 } });
    if (path === '/ingredients/meta/categories') return reply({ data: ['base', 'flavor'] });
    const catalog = [{ id: 'water-1', name: 'Purified Water', category: 'base' }, { id: 'sugar-1', name: 'Cane Sugar', category: 'sweetener' }, { id: 'acid-1', name: 'Citric Acid', category: 'acidulant' }, { id: 'flavor-1', name: 'Lemon Flavor', category: 'flavor' }, { id: 'pres-1', name: 'Sodium Benzoate', category: 'preservative' }];
    if (path === '/ingredients') return reply({ data: catalog, pagination: { total: catalog.length, limit: 500, offset: 0, has_more: false } });
    const project = { id: 'project-1', code: 'RD-2026-001', name: 'Citrus launch', business_objective: 'Validate a stable citrus beverage for the Algerian market.', target_market: 'Algeria', beverage_category: 'carbonated soft drink', target_claims: ['low sugar'], brief_status: 'validated', ingredient_constraints: { required: ['water'], forbidden: [], notes: '' }, cost_objectives: { currency: 'DZD', max_cost_per_liter: 60 }, nutrition_objectives: {}, regulatory_constraints: { markets: ['Algeria'], certifications: [], forbidden_additives: [] }, success_criteria: ['Overall liking at least 7/10'], priority: 'high', stage: 'laboratory', status: 'active', event_count: 2, created_at: '2026-09-15T00:00:00Z', updated_at: '2026-09-15T00:00:00Z' };
    if (path === '/projects/project-1') return reply({ data: { ...project, execution_available: true, events: [{ id: 'event-1', project_id: project.id, event_type: 'experimental_plan_created', details: { plan_id: 'plan-1' }, created_at: '2026-09-15T09:00:00Z' }], traceability: { formulations: [{ ...formulation(1), locked_at: null }], laboratory_results: [], sensory_studies: [], experimental_plans: [{ id: 'plan-1', project_id: project.id, formulation_version_id: 'form-1', name: 'Citrus pilot', objective: 'Validate pilot stability.', hypothesis: 'The pilot remains stable.', status: 'ready', planned_runs: 3, protocol: { method: 'Controlled pilot', variables: ['scale'], controls: ['reference'], procedure_steps: ['Mix and fill'], acceptance_criteria: ['pH in target'] }, design: { engine_version: '1.0.0', signature: 'doe-signature', design_type: 'full_factorial', run_count: 3, center_points: 1, replicates: 1, factors: [{ key: 'temperature', label: 'Temperature', low: 20, high: 35, unit: '°C' }], responses: [{ key: 'stability', label: 'Stability', goal: 'maximize', unit: '/10' }], runs: [{ id: 'DOE-001', standard_order: 1, replicate: 1, factor_settings: { temperature: { coded: -1, value: 20, unit: '°C' } } }, { id: 'DOE-002', standard_order: 2, replicate: 1, factor_settings: { temperature: { coded: 1, value: 35, unit: '°C' } } }, { id: 'DOE-003', standard_order: 3, replicate: 1, factor_settings: { temperature: { coded: 0, value: 27.5, unit: '°C' } } }] }, created_at: '2026-09-15T09:00:00Z', updated_at: '2026-09-15T09:00:00Z' }], pilot_batches: [{ id: 'batch-1', project_id: project.id, experimental_plan_id: 'plan-1', formulation_version_id: 'form-1', batch_code: 'PILOT-001', batch_size_liters: 20, status: 'planned', actual_quantities: [], procedure_notes: '', deviations: [], observations: '', conclusion: '', created_at: '2026-09-15T09:00:00Z', updated_at: '2026-09-15T09:00:00Z' }], milestones: [], decisions: [] } }, allowed_transitions: ['formulation', 'sensory'] });
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
  await expect(page.getByText('Ingredient constraints')).toBeVisible();
  await expect(page.getByText('Measurable objectives')).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'R&D experimental workspace' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Experimental plans' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'New plan' })).toBeVisible();
  await page.getByRole('tab', { name: 'DOE & next run' }).click();
  await expect(page.getByText('Deterministic design of experiments')).toBeVisible();
  await expect(page.getByText('DOE-001')).toBeVisible();
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
  await page.getByRole('tab', { name: 'Milestones' }).click();
  await expect(page.getByRole('button', { name: 'New milestone' })).toBeVisible();
  await page.getByRole('tab', { name: 'Go / No-Go' }).click();
  await expect(page.getByRole('button', { name: 'Record decision' })).toBeVisible();
  await page.getByRole('tab', { name: 'Timeline' }).click();
  await expect(page.getByText('experimental plan created')).toBeVisible();
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
