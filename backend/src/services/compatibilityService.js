import { query } from '../db/connection.js';

/**
 * Compatibility & Risk Engine Service
 * Handles compatibility scoring and risk evaluation
 * Target: ≤500ms response time for standard formulations
 */

/**
 * Get compatibility score for two ingredients
 * Uses pre-computed compatibility matrix for fast lookups
 */
export async function getCompatibilityScore(ingredientAId, ingredientBId) {
  // Use symmetric lookup (ingredient_a_id < ingredient_b_id)
  const result = await query(
    `SELECT * FROM ingredient_compatibility
     WHERE 
       (ingredient_a_id = $1 AND ingredient_b_id = $2)
       OR (ingredient_a_id = $2 AND ingredient_b_id = $1)
     LIMIT 1`,
    [ingredientAId, ingredientBId]
  );

  if (result.rows.length === 0) {
    // Calculate on-the-fly if not pre-computed (fallback)
    return await calculateCompatibilityScore(ingredientAId, ingredientBId);
  }

  return result.rows[0];
}

/**
 * Calculate compatibility score for a formulation
 * Returns overall score and risk flags
 */
export async function evaluateFormulationCompatibility(formulationId) {
  const startTime = Date.now();

  // Get all ingredients in formulation
  const ingredientsResult = await query(
    `SELECT ingredient_id FROM formulation_ingredients
     WHERE formulation_id = $1`,
    [formulationId]
  );

  const ingredientIds = ingredientsResult.rows.map(row => row.ingredient_id);

  if (ingredientIds.length < 2) {
    return {
      overall_score: 100,
      risks: [],
      warnings: [],
      details: [],
    };
  }

  // Get all pairwise compatibilities
  const compatibilities = [];
  const risks = [];
  const warnings = [];

  // Optimized: batch query for all pairs
  const pairs = [];
  for (let i = 0; i < ingredientIds.length; i++) {
    for (let j = i + 1; j < ingredientIds.length; j++) {
      pairs.push([ingredientIds[i], ingredientIds[j]]);
    }
  }

  // Batch fetch compatibilities
  if (pairs.length > 0) {
    const placeholders = pairs.map((_, idx) => {
      const base = idx * 2;
      return `($${base + 1}, $${base + 2})`;
    }).join(', ');

    const values = pairs.flat();
    const compatResult = await query(
      `SELECT * FROM ingredient_compatibility
       WHERE (ingredient_a_id, ingredient_b_id) IN (${placeholders})
          OR (ingredient_b_id, ingredient_a_id) IN (${placeholders})`,
      [...values, ...values]
    );

    compatibilities.push(...compatResult.rows);
  }

  // Calculate overall score (weighted average)
  let totalScore = 0;
  let totalWeight = 0;

  for (const compat of compatibilities) {
    totalScore += compat.compatibility_score;
    totalWeight += 1;

    // Collect risks
    if (compat.chemical_risk) {
      risks.push({
        type: 'chemical',
        severity: compat.risk_severity,
        description: compat.risk_description,
      });
    }
    if (compat.physical_risk) {
      risks.push({
        type: 'physical',
        severity: compat.risk_severity,
        description: compat.risk_description,
      });
    }
    if (compat.sensory_risk) {
      warnings.push({
        type: 'sensory',
        severity: compat.risk_severity,
        description: compat.risk_description,
      });
    }
    if (compat.regulatory_risk) {
      risks.push({
        type: 'regulatory',
        severity: compat.risk_severity,
        description: compat.risk_description,
      });
    }
  }

  const overallScore = totalWeight > 0 ? Math.round(totalScore / totalWeight) : 100;

  const responseTime = Date.now() - startTime;
  if (responseTime > 500) {
    console.warn(`⚠️ Compatibility evaluation took ${responseTime}ms (target: ≤500ms)`);
  }

  return {
    overall_score: overallScore,
    risks: risks.filter(r => ['high', 'critical'].includes(r.severity)),
    warnings: warnings,
    details: compatibilities,
    evaluation_time_ms: responseTime,
  };
}

/**
 * Calculate compatibility score for two ingredients (on-the-fly)
 * This is a fallback when pre-computed score doesn't exist
 */
async function calculateCompatibilityScore(ingredientAId, ingredientBId) {
  // Get ingredient details
  const [ingA, ingB] = await Promise.all([
    query('SELECT * FROM ingredients WHERE id = $1', [ingredientAId]),
    query('SELECT * FROM ingredients WHERE id = $2', [ingredientBId]),
  ]);

  if (ingA.rows.length === 0 || ingB.rows.length === 0) {
    throw new Error('Ingredient not found');
  }

  const a = ingA.rows[0];
  const b = ingB.rows[0];

  let score = 100;
  const risks = {
    chemical_risk: false,
    physical_risk: false,
    sensory_risk: false,
    regulatory_risk: false,
  };
  const riskDetails = [];

  // pH compatibility check
  if (a.ph_min && a.ph_max && b.ph_min && b.ph_max) {
    const phOverlap = !(a.ph_max < b.ph_min || b.ph_max < a.ph_min);
    if (!phOverlap) {
      score -= 20;
      risks.chemical_risk = true;
      riskDetails.push('pH incompatibility detected');
    }
  }

  // Regulatory compatibility
  if (a.regulatory_status === 'restricted' || b.regulatory_status === 'restricted') {
    score -= 30;
    risks.regulatory_risk = true;
    riskDetails.push('One or both ingredients are restricted');
  }

  // Halal compatibility
  if (a.halal_certified === false && b.halal_certified === false) {
    // Both non-halal - no issue
  } else if (a.halal_certified !== b.halal_certified) {
    score -= 10;
    risks.regulatory_risk = true;
    riskDetails.push('Halal certification mismatch');
  }

  // Solubility check (simplified)
  if (a.solubility_g_per_100ml && b.solubility_g_per_100ml) {
    const solubilityRatio = Math.min(a.solubility_g_per_100ml, b.solubility_g_per_100ml) /
                           Math.max(a.solubility_g_per_100ml, b.solubility_g_per_100ml);
    if (solubilityRatio < 0.1) {
      score -= 15;
      risks.physical_risk = true;
      riskDetails.push('Significant solubility difference may cause precipitation');
    }
  }

  // Store computed result for future use
  const riskSeverity = score < 50 ? 'critical' : score < 70 ? 'high' : score < 85 ? 'medium' : 'low';

  await query(
    `INSERT INTO ingredient_compatibility (
      ingredient_a_id, ingredient_b_id, compatibility_score,
      chemical_risk, physical_risk, sensory_risk, regulatory_risk,
      risk_description, risk_severity
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9
    ) ON CONFLICT (ingredient_a_id, ingredient_b_id) DO NOTHING`,
    [
      ingredientAId < ingredientBId ? ingredientAId : ingredientBId,
      ingredientAId < ingredientBId ? ingredientBId : ingredientAId,
      Math.max(0, Math.min(100, score)),
      risks.chemical_risk,
      risks.physical_risk,
      risks.sensory_risk,
      risks.regulatory_risk,
      riskDetails.join('; '),
      riskSeverity,
    ]
  );

  return {
    compatibility_score: Math.max(0, Math.min(100, score)),
    ...risks,
    risk_description: riskDetails.join('; '),
    risk_severity: riskSeverity,
  };
}

/**
 * Batch compute compatibility matrix for all ingredient pairs
 * Use this for initial setup or periodic updates
 */
export async function batchComputeCompatibilityMatrix(ingredientIds = null) {
  let ingredients;
  
  if (ingredientIds) {
    const result = await query(
      'SELECT id FROM ingredients WHERE id = ANY($1::uuid[]) AND is_active = true',
      [ingredientIds]
    );
    ingredients = result.rows.map(r => r.id);
  } else {
    const result = await query('SELECT id FROM ingredients WHERE is_active = true');
    ingredients = result.rows.map(r => r.id);
  }

  console.log(`Computing compatibility matrix for ${ingredients.length} ingredients...`);
  const totalPairs = (ingredients.length * (ingredients.length - 1)) / 2;
  console.log(`Total pairs to compute: ${totalPairs}`);

  let computed = 0;
  const batchSize = 100;

  for (let i = 0; i < ingredients.length; i++) {
    for (let j = i + 1; j < ingredients.length; j++) {
      try {
        await calculateCompatibilityScore(ingredients[i], ingredients[j]);
        computed++;

        if (computed % batchSize === 0) {
          console.log(`Progress: ${computed}/${totalPairs} (${Math.round(computed / totalPairs * 100)}%)`);
        }
      } catch (error) {
        console.error(`Error computing compatibility for pair ${ingredients[i]}-${ingredients[j]}:`, error);
      }
    }
  }

  console.log(`✅ Compatibility matrix computation complete: ${computed} pairs`);
  return { computed, total: totalPairs };
}


