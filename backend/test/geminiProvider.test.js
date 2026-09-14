import test from 'node:test';
import assert from 'node:assert/strict';
import { describeGeminiFailure, generateExpertInsight, reviewFormulationVariants } from '../src/services/geminiService.js';

const variantInput = {
  sourceFormulation: { name: 'Confidential Cola', beverage_type: 'soft_drink' },
  variants: [{
    id: 'variant-1', variant_ingredients: [{ ingredient_name: 'Water', percentage: 100 }],
    calculated_values: { cost_per_liter: 5, calories_per_100ml: 0, sugar_per_100ml: 0 },
    cost_difference_percent: 0, calorie_difference_percent: 0, sugar_difference_percent: 0,
    compatibility_score: 100, regulatory: { passes_local_checks: true }, warnings: [],
  }],
  generationType: 'optimization',
};

test.beforeEach(() => { process.env.GEMINI_API_KEY = 'provider-test-key'; });
test.afterEach(() => { delete process.env.GEMINI_API_KEY; delete process.env.GEMINI_TIMEOUT_MS; delete process.env.GEMINI_MODEL; delete process.env.GEMINI_FALLBACK_MODELS; });

test('provider request carries a strict JSON schema, redacts names, and captures token metadata', async () => {
  const fakeFetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    assert.equal(body.generationConfig.responseJsonSchema.additionalProperties, false);
    assert.match(body.contents[0].parts[0].text, /\[redacted\]/);
    assert.doesNotMatch(body.contents[0].parts[0].text, /Confidential Cola/);
    return { ok: true, json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ reviews: [{
        id: 'variant-1', confidence_score: 90, explanation: 'Structured provider review.', warnings: [], recommended: true,
      }] }) }] } }],
      usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10, totalTokenCount: 30 },
    }) };
  };
  const result = await reviewFormulationVariants({ ...variantInput, privacy: { include_formulation_name: false } }, fakeFetch);
  assert.equal(result.schema_version, '1.0');
  assert.deepEqual(result.usage, { prompt_tokens: 20, candidate_tokens: 10, total_tokens: 30 });
});

test('provider errors are classified without exposing response bodies', () => {
  assert.equal(describeGeminiFailure(new Error('Gemini request failed with HTTP 429: private upstream detail')), 'Gemini quota or rate limit was reached (HTTP 429)');
  assert.equal(describeGeminiFailure(new Error('Gemini request failed with HTTP 401')), 'Gemini rejected the API key (HTTP 401)');
  assert.equal(describeGeminiFailure(new Error('unexpected private detail')), 'Gemini review was unavailable');
});

test('malformed provider envelopes are rejected before model output is used', async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => ({ candidates: [] }) });
  await assert.rejects(() => reviewFormulationVariants(variantInput, fakeFetch), /at least 1 element/);
});

test('provider calls honor the configured timeout', async () => {
  process.env.GEMINI_TIMEOUT_MS = '5';
  const hangingFetch = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  });
  await assert.rejects(() => reviewFormulationVariants(variantInput, hangingFetch), error => error.name === 'AbortError');
});

test('cross-workspace Gemini insights are schema constrained and preserve supplied calculations', async () => {
  const fakeFetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.generationConfig.responseJsonSchema.additionalProperties, false);
    assert.match(body.contents[0].parts[0].text, /Never invent measurements/);
    return { ok: true, json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ summary: 'Costs are packaging-led.', recommendations: ['Validate packaging quotes.'], warnings: ['Scenario only.'] }) }] } }],
      usageMetadata: { totalTokenCount: 42 },
    }) };
  };
  const result = await generateExpertInsight({ domain: 'cost', context: { cost_per_unit: 42 } }, fakeFetch);
  assert.equal(result.used, true);
  assert.equal(result.summary, 'Costs are packaging-led.');
  assert.equal(result.usage.total_tokens, 42);
});

test('cross-workspace insights fall back once when the primary model is unavailable', async () => {
  process.env.GEMINI_MODEL = 'busy-primary';
  process.env.GEMINI_FALLBACK_MODELS = 'available-fallback';
  const requestedModels = [];
  const fakeFetch = async (url) => {
    requestedModels.push(url);
    if (url.includes('busy-primary')) return { ok: false, status: 503, text: async () => 'high demand' };
    return { ok: true, json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ summary: 'Fallback succeeded.', recommendations: [], warnings: [] }) }] } }],
    }) };
  };
  const result = await generateExpertInsight({ domain: 'cost', context: { cost_per_unit: 42 } }, fakeFetch);
  assert.equal(result.model, 'available-fallback');
  assert.equal(result.summary, 'Fallback succeeded.');
  assert.equal(requestedModels.length, 2);
});
