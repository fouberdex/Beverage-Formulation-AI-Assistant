import { query, transaction } from '../db/connection.js';
import { getFormulationById } from './formulationService.js';
import { evaluateFormulationCompatibility } from './compatibilityService.js';
import { getAllIngredients } from './ingredientService.js';

/**
 * AI Recommendation Engine Service
 * Generates 10-50 alternative formulations per request
 * 
 * NOTE: This is a mock implementation with structure for real AI integration
 * In production, integrate with OpenAI, Anthropic, or custom ML models
 */

/**
 * Generate alternative formulations based on source formulation
 */
export async function generateAlternativeFormulations(sourceFormulationId, options = {}) {
  const {
    count = 10,
    generation_type = 'optimization',
    constraints = {},
  } = options;

  const sourceFormulation = await getFormulationById(sourceFormulationId);
  if (!sourceFormulation) {
    throw new Error('Source formulation not found');
  }

  const variants = [];

  // Mock AI generation logic
  // In production, this would call an AI service
  for (let i = 0; i < count; i++) {
    const variant = await generateSingleVariant(sourceFormulation, constraints, generation_type);
    variants.push(variant);
  }

  // Store variants in database
  const storedVariants = [];
  for (const variant of variants) {
    const stored = await storeAIVariant(sourceFormulationId, variant, generation_type);
    storedVariants.push(stored);
  }

  return storedVariants;
}

/**
 * Generate a single formulation variant
 * Mock implementation - replace with actual AI model
 */
async function generateSingleVariant(sourceFormulation, constraints, generationType) {
  const sourceIngredients = sourceFormulation.ingredients || [];
  
  // Get all available ingredients for substitution
  const allIngredients = await getAllIngredients({ is_active: true, limit: 1000 });

  // Mock variant generation strategies
  let variantIngredients = [];

  if (generationType === 'optimization') {
    // Optimize for cost while maintaining similar profile
    variantIngredients = optimizeForCost(sourceIngredients, allIngredients, constraints);
  } else if (generationType === 'alternative') {
    // Generate alternatives with ingredient substitutions
    variantIngredients = generateAlternatives(sourceIngredients, allIngredients, constraints);
  } else if (generationType === 'constraint_based') {
    // Generate from scratch based on constraints
    variantIngredients = generateFromConstraints(allIngredients, constraints);
  } else {
    // Default: slight variations
    variantIngredients = createVariations(sourceIngredients, allIngredients);
  }

  // Calculate metrics
  const metrics = calculateVariantMetrics(variantIngredients, sourceFormulation);

  return {
    variant_data: {
      ingredients: variantIngredients.map((ing, idx) => ({
        id: ing.ingredient_id || ing.id,
        percentage: ing.percentage,
        display_order: idx,
      })),
    },
    confidence_score: calculateConfidenceScore(variantIngredients, sourceFormulation),
    explanation: generateExplanation(variantIngredients, sourceFormulation, generationType),
    cost_difference_percent: metrics.costDiff,
    calorie_difference_percent: metrics.calorieDiff,
    sugar_difference_percent: metrics.sugarDiff,
  };
}

/**
 * Optimize formulation for cost
 */
function optimizeForCost(sourceIngredients, allIngredients, constraints) {
  // Sort ingredients by price
  const ingredientsByPrice = [...allIngredients].sort((a, b) => 
    (a.base_price_per_kg || 0) - (b.base_price_per_kg || 0)
  );

  // Replace expensive ingredients with cheaper alternatives in same category
  const variants = sourceIngredients.map(sourceIng => {
    const source = allIngredients.find(ing => ing.id === sourceIng.ingredient_id);
    if (!source) return sourceIng;

    // Find cheaper alternative in same category
    const alternatives = ingredientsByPrice.filter(ing => 
      ing.category === source.category && 
      ing.id !== source.id &&
      (ing.base_price_per_kg || 0) < (source.base_price_per_kg || 0)
    );

    if (alternatives.length > 0 && Math.random() > 0.5) {
      const alt = alternatives[0];
      return {
        ingredient_id: alt.id,
        percentage: sourceIng.percentage * (0.9 + Math.random() * 0.2), // ±10% variation
      };
    }

    return {
      ingredient_id: sourceIng.ingredient_id,
      percentage: sourceIng.percentage * (0.95 + Math.random() * 0.1), // ±5% variation
    };
  });

  // Normalize percentages
  const total = variants.reduce((sum, ing) => sum + ing.percentage, 0);
  return variants.map(ing => ({
    ...ing,
    percentage: (ing.percentage / total) * 100,
  }));
}

/**
 * Generate alternatives with ingredient substitutions
 */
function generateAlternatives(sourceIngredients, allIngredients, constraints) {
  const variants = sourceIngredients.map(sourceIng => {
    const source = allIngredients.find(ing => ing.id === sourceIng.ingredient_id);
    if (!source) return sourceIng;

    // Find alternatives in same category
    const alternatives = allIngredients.filter(ing => 
      ing.category === source.category && ing.id !== source.id
    );

    if (alternatives.length > 0 && Math.random() > 0.3) {
      const alt = alternatives[Math.floor(Math.random() * alternatives.length)];
      return {
        ingredient_id: alt.id,
        percentage: sourceIng.percentage,
      };
    }

    return {
      ingredient_id: sourceIng.ingredient_id,
      percentage: sourceIng.percentage,
    };
  });

  return variants;
}

/**
 * Generate from constraints
 */
function generateFromConstraints(allIngredients, constraints) {
  const {
    target_calories,
    target_sugar,
    target_cost,
    beverage_type,
    max_ingredients = 10,
  } = constraints;

  // Filter ingredients by beverage type compatibility
  let candidates = allIngredients;
  if (beverage_type) {
    // In production, use actual beverage type compatibility
    candidates = allIngredients;
  }

  // Select random ingredients
  const selected = [];
  const shuffled = [...candidates].sort(() => Math.random() - 0.5);
  
  for (let i = 0; i < Math.min(max_ingredients, shuffled.length); i++) {
    selected.push({
      ingredient_id: shuffled[i].id,
      percentage: 100 / max_ingredients + (Math.random() - 0.5) * 5,
    });
  }

  // Normalize
  const total = selected.reduce((sum, ing) => sum + ing.percentage, 0);
  return selected.map(ing => ({
    ...ing,
    percentage: (ing.percentage / total) * 100,
  }));
}

/**
 * Create slight variations
 */
function createVariations(sourceIngredients, allIngredients) {
  return sourceIngredients.map(ing => ({
    ingredient_id: ing.ingredient_id,
    percentage: ing.percentage * (0.9 + Math.random() * 0.2), // ±10% variation
  })).map(ing => {
    // Normalize
    const total = sourceIngredients.reduce((sum, i) => sum + i.percentage, 0);
    return {
      ...ing,
      percentage: (ing.percentage / total) * 100,
    };
  });
}

/**
 * Calculate variant metrics compared to source
 */
function calculateVariantMetrics(variantIngredients, sourceFormulation) {
  // Mock calculation - in production, use actual ingredient data
  const sourceCost = sourceFormulation.total_cost_per_liter || 0;
  const sourceCalories = sourceFormulation.total_calories_per_100ml || 0;
  const sourceSugar = sourceFormulation.total_sugar_per_100ml || 0;

  // Simplified mock calculations
  const variantCost = sourceCost * (0.8 + Math.random() * 0.4);
  const variantCalories = sourceCalories * (0.85 + Math.random() * 0.3);
  const variantSugar = sourceSugar * (0.8 + Math.random() * 0.4);

  return {
    costDiff: ((variantCost - sourceCost) / sourceCost) * 100,
    calorieDiff: ((variantCalories - sourceCalories) / sourceCalories) * 100,
    sugarDiff: ((variantSugar - sourceSugar) / sourceSugar) * 100,
  };
}

/**
 * Calculate confidence score (0-100)
 */
function calculateConfidenceScore(variantIngredients, sourceFormulation) {
  // Mock confidence based on similarity to source
  const similarity = 0.7 + Math.random() * 0.25; // 70-95%
  return Math.round(similarity * 100);
}

/**
 * Generate explanation for variant
 */
function generateExplanation(variantIngredients, sourceFormulation, generationType) {
  const explanations = {
    optimization: 'Optimized formulation focusing on cost reduction while maintaining quality profile.',
    alternative: 'Alternative formulation with ingredient substitutions for variety.',
    constraint_based: 'Generated formulation meeting specified constraints and targets.',
  };

  return explanations[generationType] || 'AI-generated formulation variant.';
}

/**
 * Store AI variant in database
 */
async function storeAIVariant(sourceFormulationId, variant, generationType) {
  const result = await query(
    `INSERT INTO ai_formulation_variants (
      source_formulation_id, generation_type, variant_data,
      confidence_score, explanation,
      cost_difference_percent, calorie_difference_percent, sugar_difference_percent,
      status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [
      sourceFormulationId,
      generationType,
      JSON.stringify(variant.variant_data),
      variant.confidence_score,
      variant.explanation,
      variant.cost_difference_percent,
      variant.calorie_difference_percent,
      variant.sugar_difference_percent,
      'generated',
    ]
  );

  return result.rows[0];
}

/**
 * Get AI variants for a formulation
 */
export async function getAIVariants(sourceFormulationId, filters = {}) {
  const { status, limit = 50, offset = 0 } = filters;

  let sql = `
    SELECT * FROM ai_formulation_variants
    WHERE source_formulation_id = $1
  `;
  const params = [sourceFormulationId];
  let paramCount = 1;

  if (status) {
    paramCount++;
    sql += ` AND status = $${paramCount}`;
    params.push(status);
  }

  sql += ` ORDER BY confidence_score DESC, created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
  params.push(limit, offset);

  const result = await query(sql, params);
  return result.rows;
}

/**
 * Accept an AI variant (create actual formulation from it)
 */
export async function acceptAIVariant(variantId, userId) {
  return await transaction(async (client) => {
    // Get variant
    const variantResult = await client.query(
      'SELECT * FROM ai_formulation_variants WHERE id = $1',
      [variantId]
    );

    if (variantResult.rows.length === 0) {
      throw new Error('AI variant not found');
    }

    const variant = variantResult.rows[0];
    const variantData = variant.variant_data;

    // Get source formulation
    const source = await getFormulationById(variant.source_formulation_id);

    // Create new formulation from variant
    const formulationResult = await client.query(
      `INSERT INTO formulations (
        code, name, description, beverage_type, status, created_by, tenant_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        `${source.code}-ai-${Date.now()}`,
        `${source.name} (AI Variant)`,
        `AI-generated variant: ${variant.explanation}`,
        source.beverage_type,
        'draft',
        userId,
        source.tenant_id,
      ]
    );

    const newFormulation = formulationResult.rows[0];

    // Add ingredients
    if (variantData.ingredients && variantData.ingredients.length > 0) {
      const placeholders = variantData.ingredients.map((_, idx) => {
        const base = idx * 3;
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
      }).join(', ');

      const values = variantData.ingredients.flatMap(ing => [
        newFormulation.id,
        ing.id,
        ing.percentage,
        ing.display_order || 0,
      ]);

      await client.query(
        `INSERT INTO formulation_ingredients (formulation_id, ingredient_id, percentage, display_order)
         VALUES ${placeholders}`,
        values
      );
    }

    // Update variant status
    await client.query(
      `UPDATE ai_formulation_variants
       SET status = 'accepted', reviewed_at = CURRENT_TIMESTAMP, reviewed_by = $1
       WHERE id = $2`,
      [userId, variantId]
    );

    return newFormulation;
  });
}

