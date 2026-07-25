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

export async function reviewFormulationCandidates({ candidates, constraints }, fetchImplementation = fetch) {
  const configuration = getAIConfiguration();
  if (!configuration.configured) {
    return { ...configuration, used: false, reviews: [], reason: 'GEMINI_API_KEY is not configured' };
  }

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

    const parsed = reviewSchema.parse(JSON.parse(text));
    const candidateIds = new Set(candidates.map(candidate => candidate.id));
    const uniqueReviews = parsed.reviews.filter((review, index, reviews) =>
      candidateIds.has(review.id) && reviews.findIndex(item => item.id === review.id) === index
    );
    if (uniqueReviews.length !== candidates.length) {
      throw new Error('Gemini did not review every candidate exactly once');
    }

    return { ...configuration, used: true, reviews: uniqueReviews };
  } finally {
    clearTimeout(timeout);
  }
}
