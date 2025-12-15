import { query, transaction } from '../db/connection.js';
import { getAllIngredients } from './ingredientService.js';
import { createFormulation } from './formulationService.js';

/**
 * Target-Based Generation Service
 * Generates formulations from constraints (calories, sugar, cost, beverage type)
 * Returns top 3 optimized candidates
 */

/**
 * Generate formulations from target constraints
 */
export async function generateFromTargets(constraints, options = {}) {
  const {
    target_calories,
    target_sugar,
    target_cost_per_liter,
    beverage_type,
    max_ingredients = 10,
    min_ingredients = 5,
    count = 3, // Return top 3
  } = constraints;

  // Get all available ingredients
  const allIngredients = await getAllIngredients({
    is_active: true,
    regulatory_status: 'approved',
    limit: 1000,
  });

  // Filter by beverage type compatibility (simplified - in production, use actual rules)
  let ingredientCandidates = allIngredients;
  if (beverage_type) {
    // In production, filter by beverage_type compatibility
    ingredientCandidates = allIngredients;
  }

  // Generate candidate formulations
  const candidates = [];
  const maxAttempts = 100;

  for (let attempt = 0; attempt < maxAttempts && candidates.length < count * 10; attempt++) {
    const formulation = await generateCandidateFormulation(
      ingredientCandidates,
      {
        target_calories,
        target_sugar,
        target_cost_per_liter,
        max_ingredients,
        min_ingredients,
      }
    );

    if (formulation) {
      const score = scoreFormulation(formulation, {
        target_calories,
        target_sugar,
        target_cost_per_liter,
      });

      candidates.push({
        ...formulation,
        score,
      });
    }
  }

  // Sort by score and return top candidates
  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, count);
}

/**
 * Generate a single candidate formulation
 */
async function generateCandidateFormulation(ingredients, targets) {
  const {
    target_calories,
    target_sugar,
    target_cost_per_liter,
    max_ingredients,
    min_ingredients,
  } = targets;

  // Select random number of ingredients
  const numIngredients = Math.floor(
    Math.random() * (max_ingredients - min_ingredients + 1) + min_ingredients
  );

  // Shuffle and select ingredients
  const shuffled = [...ingredients].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, numIngredients);

  // Initialize percentages (equal distribution)
  let percentages = selected.map(() => 100 / numIngredients);

  // Optimize percentages using simple iterative approach
  percentages = optimizePercentages(selected, percentages, {
    target_calories,
    target_sugar,
    target_cost_per_liter,
  });

  // Check if valid
  const total = percentages.reduce((sum, p) => sum + p, 0);
  if (Math.abs(total - 100) > 0.01) {
    return null; // Invalid
  }

  return {
    ingredients: selected.map((ing, idx) => ({
      ingredient_id: ing.id,
      percentage: percentages[idx],
      display_order: idx,
    })),
  };
}

/**
 * Optimize ingredient percentages to meet targets
 * Simple gradient descent approach
 */
function optimizePercentages(ingredients, initialPercentages, targets) {
  let percentages = [...initialPercentages];
  const maxIterations = 50;
  const learningRate = 0.1;

  for (let iter = 0; iter < maxIterations; iter++) {
    // Calculate current values
    const current = calculateFormulationValues(ingredients, percentages);

    // Calculate errors
    const calorieError = targets.target_calories 
      ? (current.calories - targets.target_calories) / targets.target_calories 
      : 0;
    const sugarError = targets.target_sugar 
      ? (current.sugar - targets.target_sugar) / targets.target_sugar 
      : 0;
    const costError = targets.target_cost_per_liter 
      ? (current.cost - targets.target_cost_per_liter) / targets.target_cost_per_liter 
      : 0;

    // Adjust percentages
    for (let i = 0; i < ingredients.length; i++) {
      const ing = ingredients[i];
      let adjustment = 0;

      // Adjust based on calorie error
      if (targets.target_calories && ing.calories_per_100g) {
        adjustment -= calorieError * (ing.calories_per_100g / 100) * learningRate;
      }

      // Adjust based on sugar error
      if (targets.target_sugar && ing.sugar_g) {
        adjustment -= sugarError * (ing.sugar_g / 100) * learningRate;
      }

      // Adjust based on cost error
      if (targets.target_cost_per_liter && ing.base_price_per_kg) {
        adjustment -= costError * (ing.base_price_per_kg / 10) * learningRate;
      }

      percentages[i] = Math.max(0.01, Math.min(100, percentages[i] + adjustment));
    }

    // Normalize
    const total = percentages.reduce((sum, p) => sum + p, 0);
    percentages = percentages.map(p => (p / total) * 100);
  }

  return percentages;
}

/**
 * Calculate formulation values (calories, sugar, cost)
 */
function calculateFormulationValues(ingredients, percentages) {
  let calories = 0;
  let sugar = 0;
  let cost = 0;

  for (let i = 0; i < ingredients.length; i++) {
    const ing = ingredients[i];
    const pct = percentages[i];
    calories += (pct / 100) * (ing.calories_per_100g || 0);
    sugar += (pct / 100) * (ing.sugar_g || 0);
    cost += (pct / 100) * ((ing.base_price_per_kg || 0) / 10);
  }

  return { calories, sugar, cost };
}

/**
 * Score a formulation against targets
 */
function scoreFormulation(formulation, targets) {
  const values = calculateFormulationValues(
    formulation.ingredients.map(ing => {
      // Get ingredient data (simplified - in production, fetch from DB)
      return {
        calories_per_100g: 0, // Would be fetched
        sugar_g: 0,
        base_price_per_kg: 0,
      };
    }),
    formulation.ingredients.map(ing => ing.percentage)
  );

  let score = 100;

  // Penalize deviations from targets
  if (targets.target_calories) {
    const error = Math.abs(values.calories - targets.target_calories) / targets.target_calories;
    score -= error * 50;
  }

  if (targets.target_sugar) {
    const error = Math.abs(values.sugar - targets.target_sugar) / targets.target_sugar;
    score -= error * 30;
  }

  if (targets.target_cost_per_liter) {
    const error = Math.abs(values.cost - targets.target_cost_per_liter) / targets.target_cost_per_liter;
    score -= error * 20;
  }

  return Math.max(0, score);
}

/**
 * Create formulations from generated candidates
 */
export async function createFormulationsFromCandidates(candidates, metadata = {}) {
  const {
    name_prefix = 'Target-Based',
    beverage_type = 'soft_drink',
    tenant_id,
    created_by,
  } = metadata;

  const formulations = [];

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    try {
      const formulation = await createFormulation({
        code: `${name_prefix}-${Date.now()}-${i}`,
        name: `${name_prefix} Formulation ${i + 1}`,
        description: `Generated from target constraints (score: ${candidate.score.toFixed(2)})`,
        beverage_type,
        status: 'draft',
        tenant_id,
        created_by,
        ingredients: candidate.ingredients,
      });

      formulations.push({
        ...formulation,
        generation_score: candidate.score,
      });
    } catch (error) {
      console.error(`Error creating formulation ${i}:`, error);
    }
  }

  return formulations;
}

