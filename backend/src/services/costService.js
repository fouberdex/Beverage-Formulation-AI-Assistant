import { mockFormulations, mockIngredients } from '../data/mockData.js';

/**
 * Cost & ROI Service
 * Handles batch costing (1L → 10,000L) and pricing history
 */

let batchCostCalculations = [];
let pricingHistory = [];

/**
 * Get formulation by ID from mock data
 */
function getFormulationById(formulationId) {
  const formulation = mockFormulations.find(f => f.id === formulationId);
  if (!formulation) return null;

  // Enrich ingredients with full details
  const enrichedIngredients = (formulation.ingredients || []).map(fi => {
    const ingredient = mockIngredients.find(i => i.id === fi.ingredient_id);
    return {
      ...fi,
      ingredient_name: ingredient?.name_en || ingredient?.name || 'Unknown',
      base_price_per_kg: ingredient?.price_per_kg || 0,
    };
  });

  return {
    ...formulation,
    ingredients: enrichedIngredients,
    total_cost_per_liter: enrichedIngredients.reduce(
      (sum, ing) => sum + (ing.percentage / 100) * ing.base_price_per_kg,
      0
    ),
  };
}

/**
 * Calculate batch cost for a formulation
 */
export async function calculateBatchCost(formulationId, batchSizeLiters, options = {}) {
  const {
    overhead_percent = 15,
    margin_percent = 30,
    volume_tier = 'standard',
    pricing_date = new Date(),
  } = options;

  const formulation = getFormulationById(formulationId);
  if (!formulation) {
    throw new Error('Formulation not found');
  }

  // Calculate volume discount
  let volumeDiscount = 1.0;
  if (batchSizeLiters >= 10000) volumeDiscount = 0.85;
  else if (batchSizeLiters >= 1000) volumeDiscount = 0.90;
  else if (batchSizeLiters >= 100) volumeDiscount = 0.95;

  // Get ingredient costs
  const ingredients = formulation.ingredients || [];
  const ingredientCosts = ingredients.map((ing) => {
    const price = ing.base_price_per_kg * volumeDiscount;
    return {
      ingredient_id: ing.ingredient_id,
      ingredient_name: ing.ingredient_name,
      percentage: ing.percentage,
      price_per_kg: price,
      cost_contribution: (ing.percentage / 100) * (price / 10) * batchSizeLiters,
    };
  });

  const ingredientCost = ingredientCosts.reduce((sum, ing) => sum + ing.cost_contribution, 0);
  const overheadCost = ingredientCost * (overhead_percent / 100);
  const totalCost = ingredientCost + overheadCost;
  const marginAmount = totalCost * (margin_percent / 100);
  const finalPrice = totalCost + marginAmount;

  // ROI estimates
  const estimatedRevenue = finalPrice * 1.2;
  const estimatedProfit = estimatedRevenue - totalCost;
  const roiPercent = (estimatedProfit / totalCost) * 100;

  // Store calculation
  const calculation = {
    id: `batch-${Date.now()}`,
    formulation_id: formulationId,
    formulation_name: formulation.name,
    batch_size_liters: batchSizeLiters,
    volume_tier: volume_tier,
    calculated_at: new Date().toISOString(),
    ingredient_costs: ingredientCosts,
  };
  batchCostCalculations.push(calculation);

  return {
    ...calculation,
    batch_size_liters: batchSizeLiters,
    breakdown: {
      ingredient_cost: ingredientCost,
      overhead_cost: overheadCost,
      total_cost: totalCost,
      margin: marginAmount,
      final_price: finalPrice,
      estimated_revenue: estimatedRevenue,
      estimated_profit: estimatedProfit,
      roi_percent: roiPercent,
    },
    per_liter: {
      ingredient_cost: ingredientCost / batchSizeLiters,
      total_cost: totalCost / batchSizeLiters,
      final_price: finalPrice / batchSizeLiters,
    },
    volume_discount_applied: `${((1 - volumeDiscount) * 100).toFixed(0)}%`,
  };
}

/**
 * Get batch cost calculations for a formulation
 */
export async function getBatchCostCalculations(formulationId, filters = {}) {
  const { limit = 50, offset = 0 } = filters;

  const records = batchCostCalculations
    .filter(c => c.formulation_id === formulationId)
    .slice(offset, offset + limit);

  return records;
}

/**
 * Compare costs across different batch sizes
 */
export async function compareBatchSizes(formulationId, batchSizes = [1, 10, 100, 1000, 10000]) {
  const comparisons = await Promise.all(
    batchSizes.map(async (size) => {
      const cost = await calculateBatchCost(formulationId, size);
      return {
        batch_size_liters: size,
        cost_per_liter: cost.per_liter.total_cost,
        total_cost: cost.breakdown.total_cost,
        final_price_per_liter: cost.per_liter.final_price,
        roi_percent: cost.breakdown.roi_percent,
        volume_discount: cost.volume_discount_applied,
      };
    })
  );

  return comparisons;
}

/**
 * Add pricing history entry
 */
export async function addPricingHistory(ingredientId, priceData) {
  const {
    price_per_kg,
    currency = 'DZD',
    effective_date = new Date(),
    supplier_id,
    volume_tier = 'standard',
    source = 'manual',
  } = priceData;

  const record = {
    id: `price-${Date.now()}`,
    ingredient_id: ingredientId,
    price_per_kg,
    currency,
    effective_date: effective_date.toISOString(),
    supplier_id,
    volume_tier,
    source,
    created_at: new Date().toISOString(),
  };

  pricingHistory.push(record);
  return record;
}

/**
 * Get pricing history for an ingredient
 */
export async function getPricingHistory(ingredientId, filters = {}) {
  const { start_date, end_date, limit = 100, offset = 0 } = filters;

  let records = pricingHistory.filter(p => p.ingredient_id === ingredientId);

  if (start_date) {
    records = records.filter(p => new Date(p.effective_date) >= start_date);
  }

  if (end_date) {
    records = records.filter(p => new Date(p.effective_date) <= end_date);
  }

  return records.slice(offset, offset + limit);
}

/**
 * Calculate ROI for a formulation
 */
export async function calculateROI(formulationId, batchSizeLiters, sellingPricePerLiter) {
  const costData = await calculateBatchCost(formulationId, batchSizeLiters);
  const totalRevenue = sellingPricePerLiter * batchSizeLiters;
  const profit = totalRevenue - costData.breakdown.total_cost;
  const roiPercent = (profit / costData.breakdown.total_cost) * 100;

  return {
    formulation_name: costData.formulation_name,
    batch_size_liters: batchSizeLiters,
    total_cost: costData.breakdown.total_cost,
    selling_price_per_liter: sellingPricePerLiter,
    total_revenue: totalRevenue,
    profit: profit,
    roi_percent: roiPercent,
    break_even_price: costData.breakdown.total_cost / batchSizeLiters,
    is_profitable: profit > 0,
  };
}
