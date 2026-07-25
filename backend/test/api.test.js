import test from 'node:test';
import assert from 'node:assert/strict';
import server from '../src/server.js';
import { INGREDIENT_IDS } from '../src/data/mockData.js';
import { reviewFormulationCandidates } from '../src/services/geminiService.js';

const originalGeminiApiKey = process.env.GEMINI_API_KEY;
delete process.env.GEMINI_API_KEY;

test.after(async () => {
  if (originalGeminiApiKey) process.env.GEMINI_API_KEY = originalGeminiApiKey;
  else delete process.env.GEMINI_API_KEY;
  await server.close();
});

test('health endpoint identifies the active storage mode', async () => {
  const response = await server.inject({ method: 'GET', url: '/health' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().mode, 'mock');
  assert.ok(response.headers['x-content-type-options']);
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
  assert.equal(generatedResponse.json().data.length, 2);

  const variant = generatedResponse.json().data[0];
  const acceptedResponse = await server.inject({
    method: 'POST',
    url: `/api/v1/ai/variants/${variant.id}/accept`,
    payload: {
      variant_data: {
        ingredients: variant.variant_ingredients,
        source_name: 'Classic Orange Soda',
        beverage_type: 'carbonated',
        explanation: variant.explanation,
      },
    },
  });
  assert.equal(acceptedResponse.statusCode, 201);
  assert.equal(acceptedResponse.json().data.total_percentage, 100);
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
