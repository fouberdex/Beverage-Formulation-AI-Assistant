import { z } from 'zod';

const DEFAULT_MODEL = 'gemini-2.5-flash-lite';
const DEFAULT_TIMEOUT_MS = 15_000;

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
      ph_stability: z.number().finite().min(0).max(100),
      color_stability: z.number().finite().min(0).max(100),
      shelf_life_months: z.number().int().min(1).max(36),
    }),
    explanation: z.string().trim().min(1).max(1200),
    warnings: z.array(z.string().trim().min(1).max(300)).max(8).default([]),
  })).max(10),
});

const variantReviewSchema = z.object({
  reviews: z.array(z.object({
    id: z.string(),
    confidence_score: z.number().finite().min(0).max(100),
    explanation: z.string().trim().min(1).max(1200),
    warnings: z.array(z.string().trim().min(1).max(300)).max(8).default([]),
    recommended: z.boolean(),
  })).max(10),
});

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

async function requestStructuredReview({ prompt, schema, expectedIds }, fetchImplementation) {
  const configuration = getAIConfiguration();
  if (!configuration.configured) {
    return { ...configuration, used: false, reviews: [], reason: 'GEMINI_API_KEY is not configured' };
  }

  const controller = new AbortController();
  const timeoutMs = Number.parseInt(process.env.GEMINI_TIMEOUT_MS || `${DEFAULT_TIMEOUT_MS}`, 10);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(configuration.model)}:generateContent`;
    const response = await fetchImplementation(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': process.env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2,
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Gemini request failed with HTTP ${response.status}: ${errorBody.slice(0, 300)}`);
    }

    const payload = await response.json();
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

    return { ...configuration, used: true, reviews: uniqueReviews };
  } finally {
    clearTimeout(timeout);
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

export async function reviewFormulationCandidates({ candidates, constraints }, fetchImplementation = fetch) {
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
    'Return conservative estimates only. Flag uncertainty; do not claim legal compliance or laboratory validation.',
    'Score compatibility, sensory balance, and predicted stability from 0 to 100.',
    'Return exactly one review for each supplied candidate ID as JSON matching this shape:',
    '{"reviews":[{"id":"...","compatibility":0,"sensory":{"taste_balance":0,"sweetness_level":0,"acidity_balance":0,"flavor_intensity":0},"stability":{"ph_stability":0,"color_stability":0,"shelf_life_months":1},"explanation":"...","warnings":[]}]}',
    `Targets: ${JSON.stringify(constraints)}`,
    `Candidates: ${JSON.stringify(candidatePayload)}`,
  ].join('\n');

  return requestStructuredReview({
    prompt,
    schema: reviewSchema,
    expectedIds: candidates.map(candidate => candidate.id),
  }, fetchImplementation);
}

export async function reviewFormulationVariants(
  { sourceFormulation, variants, generationType },
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
    `Source formulation: ${JSON.stringify({
      name: sourceFormulation.name,
      beverage_type: sourceFormulation.beverage_type,
    })}`,
    `Variants: ${JSON.stringify(variantPayload)}`,
  ].join('\n');

  return requestStructuredReview({
    prompt,
    schema: variantReviewSchema,
    expectedIds: variants.map(variant => variant.id),
  }, fetchImplementation);
}
