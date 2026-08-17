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
    assert.equal(result.model, 'gemini-2.5-flash-lite');
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
