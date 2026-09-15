import { z } from 'zod';

const DEFAULT_MODEL = 'gemini-3.1-flash-lite';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_FALLBACK_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.6-flash'];

const scoreSchema = { type: 'number', minimum: 0, maximum: 100 };
const advisoryListSchema = { type: 'array', maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 300 } };
const reviewJsonSchema = {
  type: 'object', additionalProperties: false, required: ['reviews'],
  properties: { reviews: { type: 'array', minItems: 1, maxItems: 10, items: {
    type: 'object', additionalProperties: false,
    required: ['id', 'compatibility', 'sensory', 'stability', 'explanation', 'warnings'],
    properties: {
      id: { type: 'string' }, compatibility: scoreSchema,
      sensory: { type: 'object', additionalProperties: false,
        required: ['taste_balance', 'sweetness_level', 'acidity_balance', 'flavor_intensity'],
        properties: { taste_balance: scoreSchema, sweetness_level: scoreSchema, acidity_balance: scoreSchema, flavor_intensity: scoreSchema } },
      stability: { type: 'object', additionalProperties: false,
        required: ['stability_risks', 'likely_failure_modes', 'recommended_tests', 'evidence_gaps', 'uncertainty'],
        properties: {
          stability_risks: advisoryListSchema,
          likely_failure_modes: advisoryListSchema,
          recommended_tests: advisoryListSchema,
          evidence_gaps: advisoryListSchema,
          uncertainty: { type: 'string', minLength: 1, maxLength: 500 },
        } },
      explanation: { type: 'string', minLength: 1, maxLength: 1200 },
      warnings: { type: 'array', maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 300 } },
    },
  } } },
};
const variantReviewJsonSchema = {
  type: 'object', additionalProperties: false, required: ['reviews'],
  properties: { reviews: { type: 'array', minItems: 1, maxItems: 10, items: {
    type: 'object', additionalProperties: false,
    required: ['id', 'confidence_score', 'explanation', 'warnings', 'recommended'],
    properties: {
      id: { type: 'string' }, confidence_score: scoreSchema,
      explanation: { type: 'string', minLength: 1, maxLength: 1200 },
      warnings: { type: 'array', maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 300 } },
      recommended: { type: 'boolean' },
    },
  } } },
};

const reviewSchema = z.object({
  reviews: z.array(z.object({
    id: z.string(),
    compatibility: z.number().finite().min(0).max(100),
    sensory: z.object({
      taste_balance: z.number().finite().min(0).max(100),
      sweetness_level: z.number().finite().min(0).max(100),
      acidity_balance: z.number().finite().min(0).max(100),
      flavor_intensity: z.number().finite().min(0).max(100),
    }),
    stability: z.object({
      stability_risks: z.array(z.string().trim().min(1).max(300)).max(8),
      likely_failure_modes: z.array(z.string().trim().min(1).max(300)).max(8),
      recommended_tests: z.array(z.string().trim().min(1).max(300)).max(8),
      evidence_gaps: z.array(z.string().trim().min(1).max(300)).max(8),
      uncertainty: z.string().trim().min(1).max(500),
    }).strict(),
    explanation: z.string().trim().min(1).max(1200),
    warnings: z.array(z.string().trim().min(1).max(300)).max(8),
  }).strict()).min(1).max(10),
}).strict();

const variantReviewSchema = z.object({
  reviews: z.array(z.object({
    id: z.string(),
    confidence_score: z.number().finite().min(0).max(100),
    explanation: z.string().trim().min(1).max(1200),
    warnings: z.array(z.string().trim().min(1).max(300)).max(8),
    recommended: z.boolean(),
  }).strict()).min(1).max(10),
}).strict();

const insightJsonSchema = {
  type: 'object', additionalProperties: false, required: ['summary', 'recommendations', 'warnings'],
  properties: {
    summary: { type: 'string', minLength: 1, maxLength: 1600 },
    recommendations: { type: 'array', maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 500 } },
    warnings: { type: 'array', maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 500 } },
  },
};
const insightSchema = z.object({
  summary: z.string().trim().min(1).max(1600),
  recommendations: z.array(z.string().trim().min(1).max(500)).max(8),
  warnings: z.array(z.string().trim().min(1).max(500)).max(8),
}).strict();

const providerEnvelopeSchema = z.object({
  candidates: z.array(z.object({
    content: z.object({ parts: z.array(z.object({ text: z.string().optional() }).passthrough()).min(1) }).passthrough(),
  }).passthrough()).min(1),
  usageMetadata: z.object({
    promptTokenCount: z.number().int().nonnegative().optional(),
    candidatesTokenCount: z.number().int().nonnegative().optional(),
    totalTokenCount: z.number().int().nonnegative().optional(),
  }).passthrough().optional(),
}).passthrough();

export function getAIConfiguration() {
  return {
    provider: 'google-gemini',
    model: process.env.GEMINI_MODEL || DEFAULT_MODEL,
    configured: Boolean(process.env.GEMINI_API_KEY),
  };
}

function extractResponseText(payload) {
  return payload.candidates?.[0]?.content?.parts
    ?.map(part => part.text || '')
    .join('')
    .trim();
}

function candidateModels(primaryModel) {
  const configured = (process.env.GEMINI_FALLBACK_MODELS || DEFAULT_FALLBACK_MODELS.join(','))
    .split(',')
    .map(model => model.trim())
    .filter(Boolean);
  return [...new Set([primaryModel, ...configured])].slice(0, 3);
}

async function requestGeminiJson({ generationConfig, prompt, fetchImplementation = fetch }) {
  const configuration = getAIConfiguration();
  let lastError;
  const models = candidateModels(configuration.model);

  for (const [index, model] of models.entries()) {
    const controller = new AbortController();
    const timeoutMs = Number.parseInt(process.env.GEMINI_TIMEOUT_MS || `${DEFAULT_TIMEOUT_MS}`, 10);
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImplementation(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const errorBody = await response.text();
        const error = new Error(`Gemini request failed with HTTP ${response.status}: ${errorBody.slice(0, 300)}`);
        const canFallback = [404, 429, 503].includes(response.status) && index < models.length - 1;
        if (canFallback) {
          lastError = error;
          continue;
        }
        throw error;
      }
      return { payload: providerEnvelopeSchema.parse(await response.json()), model };
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      lastError = error;
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error('No Gemini model was available');
}

async function requestStructuredReview({ prompt, schema, jsonSchema, expectedIds, schemaVersion = '1.0' }, fetchImplementation) {
  const configuration = getAIConfiguration();
  if (!configuration.configured) {
    return { ...configuration, used: false, reviews: [], reason: 'GEMINI_API_KEY is not configured' };
  }

  const { payload, model } = await requestGeminiJson({
    prompt,
    fetchImplementation,
    generationConfig: {
      responseMimeType: 'application/json',
      responseJsonSchema: jsonSchema,
      temperature: 0.2,
      maxOutputTokens: 4096,
    },
  });
  {
    const text = extractResponseText(payload);
    if (!text) throw new Error('Gemini returned no text');

    const parsed = schema.parse(JSON.parse(text));
    const allowedIds = new Set(expectedIds);
    const uniqueReviews = parsed.reviews.filter((review, index, reviews) =>
      allowedIds.has(review.id) && reviews.findIndex(item => item.id === review.id) === index
    );
    if (uniqueReviews.length !== expectedIds.length) {
      throw new Error('Gemini did not review every item exactly once');
    }

    return {
      ...configuration,
      model,
      used: true,
      reviews: uniqueReviews,
      schema_version: schemaVersion,
      usage: {
        prompt_tokens: payload.usageMetadata?.promptTokenCount,
        candidate_tokens: payload.usageMetadata?.candidatesTokenCount,
        total_tokens: payload.usageMetadata?.totalTokenCount,
      },
    };
  }
}

export async function generateExpertInsight({ domain, context }, fetchImplementation = fetch) {
  const configuration = getAIConfiguration();
  if (!configuration.configured) return { ...configuration, used: false, reason: 'GEMINI_API_KEY is not configured' };
  const prompt = [
    'You are a conservative beverage R&D decision-support reviewer.',
    `Domain: ${domain}.`,
    'Analyze only the supplied structured data. Never invent measurements, prices, legal compliance, or experimental results.',
    'Separate recommendations from warnings. State when evidence is insufficient. Return JSON only.',
    `Data: ${JSON.stringify(context)}`,
  ].join('\n');
  const { payload, model } = await requestGeminiJson({
    prompt,
    fetchImplementation,
    generationConfig: { responseMimeType: 'application/json', responseJsonSchema: insightJsonSchema, temperature: 0.15, maxOutputTokens: 2048 },
  });
  {
    const result = insightSchema.parse(JSON.parse(extractResponseText(payload)));
    return { ...configuration, model, used: true, ...result, usage: { prompt_tokens: payload.usageMetadata?.promptTokenCount, candidate_tokens: payload.usageMetadata?.candidatesTokenCount, total_tokens: payload.usageMetadata?.totalTokenCount } };
  }
}

export function describeGeminiFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/HTTP 401/i.test(message)) return 'Gemini rejected the API key (HTTP 401)';
  if (/HTTP 403/i.test(message)) return 'Gemini access is forbidden for this API key or project (HTTP 403)';
  if (/HTTP 429/i.test(message)) return 'Gemini quota or rate limit was reached (HTTP 429)';
  if (/abort|timeout/i.test(message)) return 'Gemini review timed out';
  if (/JSON|review every item|schema|invalid/i.test(message)) return 'Gemini returned an invalid or incomplete review';
  return 'Gemini review was unavailable';
}

export async function reviewFormulationCandidates({ candidates, constraints, privacy = {} }, fetchImplementation = fetch) {
  const candidatePayload = candidates.map(candidate => ({
    id: candidate.id,
    beverage_type: candidate.beverage_type,
    ingredients: candidate.ingredients.map(ingredient => ({
      name: ingredient.ingredient_name,
      category: ingredient.category,
      percentage: Number(ingredient.percentage.toFixed(4)),
    })),
    calculated_values: candidate.calculated_values,
    target_match_scores: {
      calories: candidate.scores.calorie_match,
      sugar: candidate.scores.sugar_match,
      cost: candidate.scores.cost_match,
    },
  }));

  const prompt = [
    'You are assisting a beverage R&D formulator.',
    'Review the candidate formulations below. Do not change ingredients or percentages.',
    'Return conservative advisory observations only. Flag uncertainty; do not claim legal compliance or laboratory validation.',
    'Score compatibility and sensory balance from 0 to 100.',
    'For stability, identify only plausible risks, likely failure modes, recommended tests, evidence gaps and uncertainty from the supplied composition.',
    'Never estimate shelf life, predict a validated storage duration, or assign numeric stability scores.',
    'Return exactly one review for each supplied candidate ID as JSON matching this shape:',
    '{"reviews":[{"id":"...","compatibility":0,"sensory":{"taste_balance":0,"sweetness_level":0,"acidity_balance":0,"flavor_intensity":0},"stability":{"stability_risks":[],"likely_failure_modes":[],"recommended_tests":[],"evidence_gaps":[],"uncertainty":"..."},"explanation":"...","warnings":[]}]}',
    `Targets: ${JSON.stringify(constraints)}`,
    `Candidates: ${JSON.stringify(candidatePayload)}`,
  ].join('\n');

  return requestStructuredReview({
    prompt,
    schema: reviewSchema,
    jsonSchema: reviewJsonSchema,
    expectedIds: candidates.map(candidate => candidate.id),
    schemaVersion: '2.0',
  }, fetchImplementation);
}

export async function reviewFormulationVariants(
  { sourceFormulation, variants, generationType, constraints = {}, privacy = {} },
  fetchImplementation = fetch,
) {
  const variantPayload = variants.map(variant => ({
    id: variant.id,
    ingredients: variant.variant_ingredients.map(ingredient => ({
      name: ingredient.ingredient_name,
      percentage: Number(ingredient.percentage.toFixed(4)),
    })),
    calculated_values: variant.calculated_values,
    changes_from_source_percent: {
      cost: variant.cost_difference_percent,
      calories: variant.calorie_difference_percent,
      sugar: variant.sugar_difference_percent,
    },
    compatibility_score: variant.compatibility_score,
    regulatory: variant.regulatory,
    local_warnings: variant.warnings,
  }));

  const prompt = [
    'You are assisting a beverage R&D formulator.',
    'Review the locally generated variants below. Do not change ingredients, percentages, or calculated values.',
    'Use the requested generation type when judging usefulness. Be conservative and do not claim legal compliance or laboratory validation.',
    'Return exactly one review for every supplied variant ID as JSON matching this shape:',
    '{"reviews":[{"id":"...","confidence_score":0,"explanation":"...","warnings":[],"recommended":false}]}',
    `Generation type: ${generationType}`,
    `Requested constraints: ${JSON.stringify(constraints)}`,
    `Source formulation: ${JSON.stringify({
      name: privacy.include_formulation_name ? sourceFormulation.name : '[redacted]',
      beverage_type: sourceFormulation.beverage_type,
    })}`,
    `Variants: ${JSON.stringify(variantPayload)}`,
  ].join('\n');

  return requestStructuredReview({
    prompt,
    schema: variantReviewSchema,
    jsonSchema: variantReviewJsonSchema,
    expectedIds: variants.map(variant => variant.id),
  }, fetchImplementation);
}
