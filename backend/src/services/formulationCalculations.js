import { query } from '../db/connection.js';

/**
 * Formulation Calculation Service
 * Handles calculations for nutrition, cost, and totals
 */

export async function recalculateFormulationTotals(client, formulationId) {
  // Calculate totals from formulation_ingredients
  const result = await client.query(
    `SELECT 
      COALESCE(SUM(fi.percentage), 0) as total_percentage,
      COALESCE(SUM(
        (fi.percentage / 100.0) * (i.base_price_per_kg / 10.0)
      ), 0) as total_cost_per_liter,
      COALESCE(SUM(
        (fi.percentage / 100.0) * COALESCE(i.calories_per_100g, 0)
      ), 0) as total_calories_per_100ml,
      COALESCE(SUM(
        (fi.percentage / 100.0) * COALESCE(i.sugar_g, 0)
      ), 0) as total_sugar_per_100ml
    FROM formulation_ingredients fi
    JOIN ingredients i ON fi.ingredient_id = i.id
    WHERE fi.formulation_id = $1`,
    [formulationId]
  );

  const totals = result.rows[0];

  // Update cost contributions
  await client.query(
    `UPDATE formulation_ingredients fi
     SET cost_contribution = (fi.percentage / 100.0) * (i.base_price_per_kg / 10.0)
     FROM ingredients i
     WHERE fi.ingredient_id = i.id AND fi.formulation_id = $1`,
    [formulationId]
  );

  // Update formulation totals
  await client.query(
    `UPDATE formulations
     SET 
       total_percentage = $1,
       total_cost_per_liter = $2,
       total_calories_per_100ml = $3,
       total_sugar_per_100ml = $4,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = $5`,
    [
      totals.total_percentage,
      totals.total_cost_per_liter,
      totals.total_calories_per_100ml,
      totals.total_sugar_per_100ml,
      formulationId,
    ]
  );

  return totals;
}

export async function calculateNutrition(formulationId) {
  const result = await query(
    `SELECT 
      COALESCE(SUM((fi.percentage / 100.0) * COALESCE(i.calories_per_100g, 0)), 0) as calories,
      COALESCE(SUM((fi.percentage / 100.0) * COALESCE(i.protein_g, 0)), 0) as protein,
      COALESCE(SUM((fi.percentage / 100.0) * COALESCE(i.carbs_g, 0)), 0) as carbs,
      COALESCE(SUM((fi.percentage / 100.0) * COALESCE(i.sugar_g, 0)), 0) as sugar,
      COALESCE(SUM((fi.percentage / 100.0) * COALESCE(i.fat_g, 0)), 0) as fat,
      COALESCE(SUM((fi.percentage / 100.0) * COALESCE(i.fiber_g, 0)), 0) as fiber,
      COALESCE(SUM((fi.percentage / 100.0) * COALESCE(i.sodium_mg, 0)), 0) as sodium
    FROM formulation_ingredients fi
    JOIN ingredients i ON fi.ingredient_id = i.id
    WHERE fi.formulation_id = $1`,
    [formulationId]
  );

  return result.rows[0];
}

export async function calculateCost(formulationId, batchSizeLiters = 1) {
  const result = await query(
    `SELECT 
      COALESCE(SUM(
        (fi.percentage / 100.0) * (i.base_price_per_kg / 10.0) * $2
      ), 0) as total_cost
    FROM formulation_ingredients fi
    JOIN ingredients i ON fi.ingredient_id = i.id
    WHERE fi.formulation_id = $1`,
    [formulationId, batchSizeLiters]
  );

  return {
    batch_size_liters: batchSizeLiters,
    cost_per_liter: result.rows[0].total_cost / batchSizeLiters,
    total_cost: result.rows[0].total_cost,
  };
}


