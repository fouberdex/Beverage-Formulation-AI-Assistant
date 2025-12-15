import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';

// Import mock data
import { 
  ingredients, 
  formulations, 
  categories, 
  generateId, 
  getIngredientById,
  addFormulation,
  updateFormulation,
  deleteFormulation
} from './data/mockData.js';

dotenv.config();

const server = Fastify({
  logger: true,
});

// CORS configuration
await server.register(cors, {
  origin: true,
  credentials: true,
});

// Health check endpoint
server.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString(), mode: 'mock' };
});

const apiPrefix = '/api/v1';

// ============================================================================
// INGREDIENTS ROUTES
// ============================================================================

server.get(`${apiPrefix}/ingredients`, async (request) => {
  const { category, search, limit = 100, offset = 0 } = request.query;
  
  let filtered = [...ingredients].filter(i => i.is_active);
  
  if (category) {
    filtered = filtered.filter(i => i.category === category);
  }
  
  if (search) {
    const searchLower = search.toLowerCase();
    filtered = filtered.filter(i => 
      i.name.toLowerCase().includes(searchLower) ||
      i.code.toLowerCase().includes(searchLower)
    );
  }
  
  const paginated = filtered.slice(offset, offset + parseInt(limit));
  
  return {
    data: paginated,
    pagination: {
      total: filtered.length,
      limit: parseInt(limit),
      offset: parseInt(offset),
      has_more: offset + paginated.length < filtered.length,
    },
  };
});

server.get(`${apiPrefix}/ingredients/:id`, async (request) => {
  const ingredient = ingredients.find(i => i.id === request.params.id);
  if (!ingredient) {
    return { error: 'Ingredient not found' };
  }
  return { data: ingredient };
});

server.get(`${apiPrefix}/ingredients/meta/categories`, async () => {
  return { data: categories };
});

server.get(`${apiPrefix}/ingredients/meta/stats`, async () => {
  return {
    data: {
      total_ingredients: ingredients.filter(i => i.is_active).length,
      total_categories: categories.length,
      categories: categories,
    },
  };
});

// Create ingredient
server.post(`${apiPrefix}/ingredients`, async (request, reply) => {
  const {
    code,
    name,
    name_ar,
    name_fr,
    category,
    base_price_per_kg = 0,
    calories_per_100g = 0,
    sugar_g = 0,
    halal_certified = true,
    vegan = true,
  } = request.body;

  if (!code || !name || !category) {
    return reply.code(400).send({ error: 'Code, name, and category are required' });
  }

  const newIngredient = {
    id: generateId(),
    code,
    name,
    name_ar: name_ar || '',
    name_fr: name_fr || '',
    category,
    base_price_per_kg,
    calories_per_100g,
    sugar_g,
    halal_certified,
    kosher_certified: true,
    vegan,
    organic: false,
    regulatory_status: 'approved',
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  ingredients.push(newIngredient);
  
  // Update categories if new
  if (!categories.includes(category)) {
    categories.push(category);
  }

  return reply.code(201).send({ data: newIngredient });
});

// ============================================================================
// FORMULATIONS ROUTES
// ============================================================================

server.get(`${apiPrefix}/formulations`, async (request) => {
  const { search, status, limit = 50, offset = 0 } = request.query;
  
  let filtered = [...formulations];
  
  if (status) {
    filtered = filtered.filter(f => f.status === status);
  }
  
  if (search) {
    const searchLower = search.toLowerCase();
    filtered = filtered.filter(f => 
      f.name.toLowerCase().includes(searchLower) ||
      f.code.toLowerCase().includes(searchLower)
    );
  }
  
  const paginated = filtered.slice(offset, offset + parseInt(limit));
  
  return {
    data: paginated,
    pagination: {
      total: filtered.length,
      limit: parseInt(limit),
      offset: parseInt(offset),
      has_more: offset + paginated.length < filtered.length,
    },
  };
});

server.get(`${apiPrefix}/formulations/:id`, async (request) => {
  const formulation = formulations.find(f => f.id === request.params.id);
  if (!formulation) {
    return { error: 'Formulation not found' };
  }
  return { data: formulation };
});

server.post(`${apiPrefix}/formulations`, async (request, reply) => {
  const { code, name, description, beverage_type, ingredients: formIngredients = [] } = request.body;
  
  // Calculate totals
  let totalPercentage = 0;
  let totalCost = 0;
  let totalCalories = 0;
  let totalSugar = 0;
  
  const processedIngredients = formIngredients.map((fi, idx) => {
    const ing = getIngredientById(fi.ingredient_id);
    if (ing) {
      totalPercentage += fi.percentage;
      totalCost += (fi.percentage / 100) * (ing.base_price_per_kg / 10);
      totalCalories += (fi.percentage / 100) * (ing.calories_per_100g || 0);
      totalSugar += (fi.percentage / 100) * (ing.sugar_g || 0);
    }
    return {
      ...fi,
      ingredient_name: ing?.name || 'Unknown',
      ingredient_code: ing?.code || 'Unknown',
      cost_contribution: ing ? (fi.percentage / 100) * (ing.base_price_per_kg / 10) : 0,
      display_order: idx,
    };
  });
  
  const newFormulation = addFormulation({
    code: code || `FORM-${Date.now()}`,
    name,
    description,
    beverage_type: beverage_type || 'soft_drink',
    version: 1,
    is_latest_version: true,
    status: 'draft',
    total_percentage: totalPercentage,
    total_cost_per_liter: totalCost,
    total_calories_per_100ml: totalCalories,
    total_sugar_per_100ml: totalSugar,
    ingredients: processedIngredients,
  });
  
  return reply.code(201).send({ data: newFormulation });
});

server.put(`${apiPrefix}/formulations/:id`, async (request) => {
  const { id } = request.params;
  const { name, description, status, ingredients: formIngredients } = request.body;
  
  const existing = formulations.find(f => f.id === id);
  if (!existing) {
    return { error: 'Formulation not found' };
  }
  
  const updates = {};
  if (name) updates.name = name;
  if (description) updates.description = description;
  if (status) updates.status = status;
  
  if (formIngredients) {
    let totalPercentage = 0;
    let totalCost = 0;
    let totalCalories = 0;
    let totalSugar = 0;
    
    const processedIngredients = formIngredients.map((fi, idx) => {
      const ing = getIngredientById(fi.ingredient_id);
      if (ing) {
        totalPercentage += fi.percentage;
        totalCost += (fi.percentage / 100) * (ing.base_price_per_kg / 10);
        totalCalories += (fi.percentage / 100) * (ing.calories_per_100g || 0);
        totalSugar += (fi.percentage / 100) * (ing.sugar_g || 0);
      }
      return {
        ...fi,
        ingredient_name: ing?.name || 'Unknown',
        ingredient_code: ing?.code || 'Unknown',
        cost_contribution: ing ? (fi.percentage / 100) * (ing.base_price_per_kg / 10) : 0,
        display_order: idx,
      };
    });
    
    updates.ingredients = processedIngredients;
    updates.total_percentage = totalPercentage;
    updates.total_cost_per_liter = totalCost;
    updates.total_calories_per_100ml = totalCalories;
    updates.total_sugar_per_100ml = totalSugar;
  }
  
  const updated = updateFormulation(id, updates);
  return { data: updated };
});

server.delete(`${apiPrefix}/formulations/:id`, async (request) => {
  const deleted = deleteFormulation(request.params.id);
  if (!deleted) {
    return { error: 'Formulation not found' };
  }
  return { data: deleted, message: 'Formulation archived' };
});

// ============================================================================
// COMPATIBILITY ROUTES
// ============================================================================

server.get(`${apiPrefix}/compatibility/formulations/:id`, async (request) => {
  const formulation = formulations.find(f => f.id === request.params.id);
  if (!formulation) {
    return { error: 'Formulation not found' };
  }
  
  const startTime = Date.now();
  const risks = [];
  const warnings = [];
  let overallScore = 100;
  
  const ings = formulation.ingredients || [];
  const ingredientDetails = ings.map(i => ({
    ...i,
    details: getIngredientById(i.ingredient_id)
  })).filter(i => i.details);

  // ============================================
  // 1. FORMULATION VALIDATION
  // ============================================
  const totalPct = ings.reduce((sum, i) => sum + i.percentage, 0);
  if (Math.abs(totalPct - 100) > 0.1) {
    risks.push({
      type: 'formulation',
      severity: 'high',
      description: `Total percentage is ${totalPct.toFixed(2)}%, must equal 100% for a valid formulation`,
    });
    overallScore -= 15;
  }

  // ============================================
  // 2. CHEMICAL RISKS - pH Compatibility
  // ============================================
  const acidulants = ingredientDetails.filter(i => i.details.category === 'acidulant');
  const hasHighAcid = acidulants.some(i => i.details.ph_min && i.details.ph_min < 3);
  const hasLowAcid = acidulants.some(i => i.details.ph_max && i.details.ph_max > 4);
  
  // Check for pH-sensitive ingredients with acids
  const phSensitiveCategories = ['colorant', 'vitamin', 'flavor'];
  const phSensitive = ingredientDetails.filter(i => phSensitiveCategories.includes(i.details.category));
  
  if (hasHighAcid && phSensitive.length > 0) {
    const affected = phSensitive.map(i => i.details.name).join(', ');
    warnings.push({
      type: 'chemical',
      severity: 'medium',
      description: `High acidity (pH < 3) may affect stability of: ${affected}. Consider pH buffering.`,
    });
    overallScore -= 5;
  }

  // Check for incompatible acid combinations
  if (acidulants.length > 1) {
    const acidNames = acidulants.map(i => i.details.name).join(' + ');
    warnings.push({
      type: 'chemical',
      severity: 'low',
      description: `Multiple acidulants detected (${acidNames}). Verify pH balance and taste profile.`,
    });
    overallScore -= 3;
  }

  // Phosphoric acid + Citric acid interaction
  const hasPhosphoric = acidulants.some(i => i.details.name.toLowerCase().includes('phosphoric'));
  const hasCitric = acidulants.some(i => i.details.name.toLowerCase().includes('citric'));
  if (hasPhosphoric && hasCitric) {
    warnings.push({
      type: 'chemical',
      severity: 'medium',
      description: 'Phosphoric acid + Citric acid combination may create unexpected taste interactions.',
    });
    overallScore -= 5;
  }

  // ============================================
  // 3. PHYSICAL RISKS - Precipitation & Cloudiness
  // ============================================
  const hasCalcium = ingredientDetails.some(i => 
    i.details.name.toLowerCase().includes('calcium') || 
    i.details.category === 'mineral'
  );
  const hasCitricAcid = acidulants.some(i => i.details.name.toLowerCase().includes('citric'));
  
  if (hasCalcium && hasCitricAcid) {
    warnings.push({
      type: 'physical',
      severity: 'medium',
      description: 'Calcium + Citric acid may form calcium citrate precipitate causing cloudiness.',
    });
    overallScore -= 5;
  }

  // Gums/stabilizers with high acid
  const stabilizers = ingredientDetails.filter(i => i.details.category === 'stabilizer');
  if (stabilizers.length > 0 && hasHighAcid) {
    const stabNames = stabilizers.map(i => i.details.name).join(', ');
    warnings.push({
      type: 'physical',
      severity: 'low',
      description: `Stabilizers (${stabNames}) may lose viscosity at low pH. Test for phase separation.`,
    });
    overallScore -= 3;
  }

  // Check for potential emulsion instability
  const emulsifiers = ingredientDetails.filter(i => i.details.category === 'emulsifier');
  const juices = ingredientDetails.filter(i => i.details.category === 'juice');
  if (juices.length > 0 && emulsifiers.length === 0) {
    warnings.push({
      type: 'physical',
      severity: 'low',
      description: 'Juice concentrates without emulsifier may cause separation. Consider adding Gum Arabic or Pectin.',
    });
    overallScore -= 2;
  }

  // ============================================
  // 4. SENSORY RISKS - Flavor & Color
  // ============================================
  const sweeteners = ingredientDetails.filter(i => i.details.category === 'sweetener');
  const artificialSweeteners = sweeteners.filter(i => 
    i.details.name.toLowerCase().includes('aspartame') ||
    i.details.name.toLowerCase().includes('sucralose') ||
    i.details.name.toLowerCase().includes('stevia')
  );
  const naturalSweeteners = sweeteners.filter(i => 
    i.details.name.toLowerCase().includes('sugar') ||
    i.details.name.toLowerCase().includes('honey') ||
    i.details.name.toLowerCase().includes('fructose')
  );

  if (artificialSweeteners.length > 0 && naturalSweeteners.length > 0) {
    warnings.push({
      type: 'sensory',
      severity: 'low',
      description: 'Mixing artificial and natural sweeteners may create off-taste. Optimize ratios through sensory testing.',
    });
    overallScore -= 2;
  }

  // Multiple strong flavors
  const flavors = ingredientDetails.filter(i => i.details.category === 'flavor');
  if (flavors.length > 2) {
    const flavorNames = flavors.map(i => i.details.name).join(', ');
    warnings.push({
      type: 'sensory',
      severity: 'medium',
      description: `Multiple flavors detected (${flavorNames}). May result in confused taste profile.`,
    });
    overallScore -= 4;
  }

  // Color stability with Vitamin C
  const hasVitaminC = ingredientDetails.some(i => 
    i.details.name.toLowerCase().includes('vitamin c') ||
    i.details.name.toLowerCase().includes('ascorbic')
  );
  const colorants = ingredientDetails.filter(i => i.details.category === 'colorant');
  if (hasVitaminC && colorants.length > 0) {
    warnings.push({
      type: 'sensory',
      severity: 'medium',
      description: 'Vitamin C (Ascorbic acid) may cause color fading over time. Consider encapsulated vitamin C.',
    });
    overallScore -= 4;
  }

  // Caramel color with citrus flavors
  const hasCaramel = colorants.some(i => i.details.name.toLowerCase().includes('caramel'));
  const hasCitrusFlavor = flavors.some(i => 
    i.details.name.toLowerCase().includes('orange') ||
    i.details.name.toLowerCase().includes('lemon') ||
    i.details.name.toLowerCase().includes('citrus')
  );
  if (hasCaramel && hasCitrusFlavor) {
    warnings.push({
      type: 'sensory',
      severity: 'low',
      description: 'Caramel color with citrus flavor is unusual. Verify this is intentional (cola-citrus hybrid).',
    });
    overallScore -= 2;
  }

  // ============================================
  // 5. REGULATORY RISKS
  // ============================================
  for (const item of ingredientDetails) {
    const ing = item.details;
    const pct = item.percentage;
    
    // Check max percentage limits
    if (ing.max_percentage && pct > ing.max_percentage) {
      risks.push({
        type: 'regulatory',
        severity: 'critical',
        description: `${ing.name} at ${pct.toFixed(2)}% exceeds maximum allowed ${ing.max_percentage}% (Algerian regulation)`,
      });
      overallScore -= 15;
    }

    // Warn if close to limit
    if (ing.max_percentage && pct > ing.max_percentage * 0.8 && pct <= ing.max_percentage) {
      warnings.push({
        type: 'regulatory',
        severity: 'low',
        description: `${ing.name} at ${pct.toFixed(2)}% is close to maximum limit of ${ing.max_percentage}%`,
      });
      overallScore -= 2;
    }

    // Check for restricted ingredients
    if (ing.regulatory_status === 'restricted') {
      risks.push({
        type: 'regulatory',
        severity: 'high',
        description: `${ing.name} has restricted status. Special approval may be required.`,
      });
      overallScore -= 10;
    }
  }

  // Preservative category limits (total 0.5%)
  const preservatives = ingredientDetails.filter(i => i.details.category === 'preservative');
  const totalPreservative = preservatives.reduce((sum, i) => sum + i.percentage, 0);
  if (totalPreservative > 0.5) {
    risks.push({
      type: 'regulatory',
      severity: 'high',
      description: `Total preservative content ${totalPreservative.toFixed(2)}% exceeds 0.5% limit`,
    });
    overallScore -= 10;
  }

  // Colorant category limits (total 0.1%)
  const totalColorant = colorants.reduce((sum, i) => sum + i.percentage, 0);
  if (totalColorant > 0.5) {
    warnings.push({
      type: 'regulatory',
      severity: 'medium',
      description: `Total colorant content ${totalColorant.toFixed(2)}% is high. Verify compliance with local regulations.`,
    });
    overallScore -= 5;
  }

  // Caffeine limits for non-energy drinks
  const caffeine = ingredientDetails.filter(i => i.details.category === 'stimulant');
  const totalCaffeine = caffeine.reduce((sum, i) => sum + i.percentage, 0);
  if (totalCaffeine > 0.032) {
    risks.push({
      type: 'regulatory',
      severity: 'high',
      description: `Caffeine content ${totalCaffeine.toFixed(3)}% exceeds 0.032% (320mg/L) limit for regular beverages`,
    });
    overallScore -= 10;
  }

  // ============================================
  // 6. CHEMICAL STABILITY - Preservatives
  // ============================================
  const hasPreservative = preservatives.length > 0;
  const hasAcidulant = acidulants.length > 0;
  
  if (hasPreservative && !hasAcidulant) {
    warnings.push({
      type: 'chemical',
      severity: 'medium',
      description: 'Preservatives (Sodium Benzoate, Potassium Sorbate) require acidic pH (< 4.5) for effectiveness. Add acidulant.',
    });
    overallScore -= 5;
  }

  // Sodium Benzoate + Vitamin C = Benzene risk
  const hasSodiumBenzoate = preservatives.some(i => i.details.name.toLowerCase().includes('benzoate'));
  if (hasSodiumBenzoate && hasVitaminC) {
    risks.push({
      type: 'chemical',
      severity: 'high',
      description: 'Sodium Benzoate + Vitamin C can form benzene under heat/light. Use Potassium Sorbate instead or remove Vitamin C.',
    });
    overallScore -= 12;
  }

  // ============================================
  // FINAL SCORE
  // ============================================
  const evaluationTime = Date.now() - startTime;
  
  return {
    data: {
      overall_score: Math.max(0, Math.min(100, overallScore)),
      risks: risks.sort((a, b) => {
        const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        return severityOrder[a.severity] - severityOrder[b.severity];
      }),
      warnings: warnings.sort((a, b) => {
        const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        return severityOrder[a.severity] - severityOrder[b.severity];
      }),
      evaluation_time_ms: evaluationTime,
      checks_performed: {
        formulation_validation: true,
        chemical_compatibility: true,
        physical_stability: true,
        sensory_analysis: true,
        regulatory_compliance: true,
      },
    },
  };
});

// ============================================================================
// AI ROUTES
// ============================================================================

server.post(`${apiPrefix}/ai/formulations/:id/generate`, async (request, reply) => {
  const { id } = request.params;
  const { count = 5, generation_type = 'optimization' } = request.body;
  
  const source = formulations.find(f => f.id === id);
  if (!source) {
    return reply.code(404).send({ error: 'Source formulation not found' });
  }
  
  // Generate variants based on source formulation
  const variants = [];
  const sourceIngredients = source.ingredients || [];
  
  for (let i = 0; i < Math.min(count, 10); i++) {
    // Create modified ingredients for each variant
    const variantIngredients = sourceIngredients.map(ing => {
      const variation = generation_type === 'optimization' 
        ? 0.9 + Math.random() * 0.2  // ±10% for optimization
        : 0.7 + Math.random() * 0.6; // ±30% for alternatives
      
      return {
        ingredient_id: ing.ingredient_id,
        ingredient_name: ing.ingredient_name,
        percentage: Math.max(0.01, ing.percentage * variation),
      };
    });
    
    // Normalize to 100%
    const total = variantIngredients.reduce((sum, i) => sum + i.percentage, 0);
    variantIngredients.forEach(i => i.percentage = (i.percentage / total) * 100);
    
    variants.push({
      id: generateId(),
      source_formulation_id: id,
      source_formulation_name: source.name,
      generation_type,
      variant_ingredients: variantIngredients,
      confidence_score: 70 + Math.random() * 25,
      explanation: generation_type === 'optimization' 
        ? `Cost-optimized variant ${i + 1}: Adjusted ingredient ratios to reduce cost while maintaining quality`
        : generation_type === 'alternative'
        ? `Alternative variant ${i + 1}: Modified proportions for different taste profile`
        : `Constraint-based variant ${i + 1}: Optimized to meet target specifications`,
      cost_difference_percent: (Math.random() - 0.5) * 30,
      calorie_difference_percent: (Math.random() - 0.5) * 20,
      sugar_difference_percent: (Math.random() - 0.5) * 25,
      status: 'generated',
      created_at: new Date().toISOString(),
    });
  }
  
  return reply.code(201).send({ data: variants, count: variants.length });
});

// Accept AI variant and create formulation
server.post(`${apiPrefix}/ai/variants/:variantId/accept`, async (request, reply) => {
  const { variantId } = request.params;
  const { variant_data } = request.body;
  
  if (!variant_data) {
    return reply.code(400).send({ error: 'variant_data is required' });
  }
  
  // Calculate totals for the new formulation
  let totalPercentage = 0;
  let totalCost = 0;
  let totalCalories = 0;
  let totalSugar = 0;
  
  const processedIngredients = (variant_data.ingredients || []).map((fi, idx) => {
    const ing = getIngredientById(fi.ingredient_id);
    if (ing) {
      totalPercentage += fi.percentage;
      totalCost += (fi.percentage / 100) * (ing.base_price_per_kg / 10);
      totalCalories += (fi.percentage / 100) * (ing.calories_per_100g || 0);
      totalSugar += (fi.percentage / 100) * (ing.sugar_g || 0);
    }
    return {
      ingredient_id: fi.ingredient_id,
      ingredient_name: fi.ingredient_name || ing?.name || 'Unknown',
      ingredient_code: ing?.code || 'Unknown',
      percentage: fi.percentage,
      cost_contribution: ing ? (fi.percentage / 100) * (ing.base_price_per_kg / 10) : 0,
      display_order: idx,
    };
  });
  
  const newFormulation = addFormulation({
    code: `AI-${Date.now()}`,
    name: `${variant_data.source_name || 'AI Variant'} (AI Generated)`,
    description: variant_data.explanation || 'Created from AI recommendation',
    beverage_type: variant_data.beverage_type || 'soft_drink',
    version: 1,
    is_latest_version: true,
    status: 'draft',
    total_percentage: totalPercentage,
    total_cost_per_liter: totalCost,
    total_calories_per_100ml: totalCalories,
    total_sugar_per_100ml: totalSugar,
    ingredients: processedIngredients,
  });
  
  return reply.code(201).send({ 
    data: newFormulation,
    message: 'AI variant accepted and formulation created successfully'
  });
});

// ============================================================================
// TARGET GENERATION ROUTES
// ============================================================================

server.post(`${apiPrefix}/target-generation/generate`, async (request, reply) => {
  const { target_calories, target_sugar, target_cost_per_liter, beverage_type, count = 3 } = request.body;
  
  // Generate candidates with detailed scoring
  const candidates = [];
  
  for (let i = 0; i < count; i++) {
    const selectedIngredients = [];
    
    // Always include water (base)
    const water = ingredients.find(ing => ing.category === 'base');
    if (water) {
      selectedIngredients.push({ 
        ingredient_id: water.id, 
        ingredient_name: water.name,
        category: water.category,
        percentage: 82 + Math.random() * 8 
      });
    }
    
    // Add sweetener based on target sugar
    const sweeteners = ingredients.filter(ing => ing.category === 'sweetener');
    if (sweeteners.length > 0) {
      const sweetener = sweeteners[Math.floor(Math.random() * sweeteners.length)];
      const sweetenerPct = target_sugar ? (target_sugar / (sweetener.sugar_g || 50)) * 100 * (0.8 + Math.random() * 0.4) : 8 + Math.random() * 4;
      selectedIngredients.push({ 
        ingredient_id: sweetener.id, 
        ingredient_name: sweetener.name,
        category: sweetener.category,
        percentage: Math.min(15, Math.max(2, sweetenerPct))
      });
    }
    
    // Add acidulant
    const acidulants = ingredients.filter(ing => ing.category === 'acidulant');
    if (acidulants.length > 0) {
      const acidulant = acidulants[Math.floor(Math.random() * acidulants.length)];
      selectedIngredients.push({ 
        ingredient_id: acidulant.id, 
        ingredient_name: acidulant.name,
        category: acidulant.category,
        percentage: 0.2 + Math.random() * 0.3 
      });
    }
    
    // Add flavor
    const flavors = ingredients.filter(ing => ing.category === 'flavor');
    if (flavors.length > 0) {
      const flavor = flavors[Math.floor(Math.random() * flavors.length)];
      selectedIngredients.push({ 
        ingredient_id: flavor.id, 
        ingredient_name: flavor.name,
        category: flavor.category,
        percentage: 0.1 + Math.random() * 0.2 
      });
    }
    
    // Add preservative
    const preservatives = ingredients.filter(ing => ing.category === 'preservative');
    if (preservatives.length > 0) {
      const preservative = preservatives[Math.floor(Math.random() * preservatives.length)];
      selectedIngredients.push({ 
        ingredient_id: preservative.id, 
        ingredient_name: preservative.name,
        category: preservative.category,
        percentage: 0.03 + Math.random() * 0.02 
      });
    }
    
    // Optionally add colorant
    if (Math.random() > 0.5) {
      const colorants = ingredients.filter(ing => ing.category === 'colorant');
      if (colorants.length > 0) {
        const colorant = colorants[Math.floor(Math.random() * colorants.length)];
        selectedIngredients.push({ 
          ingredient_id: colorant.id, 
          ingredient_name: colorant.name,
          category: colorant.category,
          percentage: 0.01 + Math.random() * 0.05 
        });
      }
    }
    
    // Normalize percentages to 100%
    const total = selectedIngredients.reduce((sum, ing) => sum + ing.percentage, 0);
    selectedIngredients.forEach(ing => ing.percentage = (ing.percentage / total) * 100);
    
    // Calculate actual values
    let actualCalories = 0;
    let actualSugar = 0;
    let actualCost = 0;
    
    for (const item of selectedIngredients) {
      const ing = getIngredientById(item.ingredient_id);
      if (ing) {
        actualCalories += (item.percentage / 100) * (ing.calories_per_100g || 0);
        actualSugar += (item.percentage / 100) * (ing.sugar_g || 0);
        actualCost += (item.percentage / 100) * ((ing.base_price_per_kg || 0) / 10);
      }
    }
    
    // Calculate detailed scores
    const scores = {
      // Target matching scores
      calorie_match: target_calories 
        ? Math.max(0, 100 - Math.abs(actualCalories - target_calories) / target_calories * 100)
        : 100,
      sugar_match: target_sugar 
        ? Math.max(0, 100 - Math.abs(actualSugar - target_sugar) / target_sugar * 100)
        : 100,
      cost_match: target_cost_per_liter 
        ? Math.max(0, 100 - Math.abs(actualCost - target_cost_per_liter) / target_cost_per_liter * 100)
        : 100,
      
      // Compatibility score
      compatibility: 85 + Math.random() * 10, // Base good compatibility
      
      // Sensory evaluation
      sensory: {
        taste_balance: 75 + Math.random() * 20,
        sweetness_level: 70 + Math.random() * 25,
        acidity_balance: 80 + Math.random() * 15,
        flavor_intensity: 70 + Math.random() * 25,
      },
      
      // Regulatory compliance
      regulatory: {
        halal_compliant: true,
        max_limits_ok: true,
        preservative_ok: true,
      },
      
      // Stability prediction
      stability: {
        shelf_life_months: 6 + Math.floor(Math.random() * 12),
        ph_stability: 80 + Math.random() * 15,
        color_stability: 75 + Math.random() * 20,
      }
    };
    
    // Calculate overall score
    const sensoryAvg = (scores.sensory.taste_balance + scores.sensory.sweetness_level + 
                        scores.sensory.acidity_balance + scores.sensory.flavor_intensity) / 4;
    const targetMatchAvg = (scores.calorie_match + scores.sugar_match + scores.cost_match) / 3;
    
    const overallScore = (
      targetMatchAvg * 0.4 +      // 40% weight on target matching
      scores.compatibility * 0.25 + // 25% weight on compatibility
      sensoryAvg * 0.25 +          // 25% weight on sensory
      ((scores.stability.ph_stability + scores.stability.color_stability) / 2) * 0.1  // 10% on stability
    );
    
    candidates.push({
      id: generateId(),
      ingredients: selectedIngredients,
      calculated_values: {
        calories_per_100ml: actualCalories,
        sugar_per_100ml: actualSugar,
        cost_per_liter: actualCost,
      },
      scores: scores,
      overall_score: overallScore,
      beverage_type: beverage_type || 'soft_drink',
    });
  }
  
  // Sort by overall score
  candidates.sort((a, b) => b.overall_score - a.overall_score);
  
  return reply.code(201).send({
    data: { candidates, formulations: [] },
    message: `Generated ${candidates.length} candidates`,
  });
});

// Save target-generated candidate as formulation
server.post(`${apiPrefix}/target-generation/save`, async (request, reply) => {
  const { candidate, name } = request.body;
  
  if (!candidate || !candidate.ingredients) {
    return reply.code(400).send({ error: 'Candidate data is required' });
  }
  
  // Calculate totals
  let totalPercentage = 0;
  let totalCost = 0;
  let totalCalories = 0;
  let totalSugar = 0;
  
  const processedIngredients = candidate.ingredients.map((fi, idx) => {
    const ing = getIngredientById(fi.ingredient_id);
    if (ing) {
      totalPercentage += fi.percentage;
      totalCost += (fi.percentage / 100) * (ing.base_price_per_kg / 10);
      totalCalories += (fi.percentage / 100) * (ing.calories_per_100g || 0);
      totalSugar += (fi.percentage / 100) * (ing.sugar_g || 0);
    }
    return {
      ingredient_id: fi.ingredient_id,
      ingredient_name: fi.ingredient_name || ing?.name || 'Unknown',
      ingredient_code: ing?.code || 'Unknown',
      percentage: fi.percentage,
      cost_contribution: ing ? (fi.percentage / 100) * (ing.base_price_per_kg / 10) : 0,
      display_order: idx,
    };
  });
  
  const newFormulation = addFormulation({
    code: `TGT-${Date.now()}`,
    name: name || `Target-Generated ${new Date().toLocaleDateString()}`,
    description: `Generated from target constraints. Overall score: ${candidate.overall_score?.toFixed(1)}`,
    beverage_type: candidate.beverage_type || 'soft_drink',
    version: 1,
    is_latest_version: true,
    status: 'draft',
    total_percentage: totalPercentage,
    total_cost_per_liter: totalCost,
    total_calories_per_100ml: totalCalories,
    total_sugar_per_100ml: totalSugar,
    ingredients: processedIngredients,
  });
  
  return reply.code(201).send({ 
    data: newFormulation,
    message: 'Formulation created successfully from target generation'
  });
});

// ============================================================================
// REGULATORY ROUTES
// ============================================================================

server.post(`${apiPrefix}/regulatory/formulations/:id/check`, async (request, reply) => {
  const formulation = formulations.find(f => f.id === request.params.id);
  if (!formulation) {
    return reply.code(404).send({ error: 'Formulation not found' });
  }
  
  // Check compliance
  let isHalal = true;
  let isVegan = true;
  const violations = [];
  
  for (const fi of (formulation.ingredients || [])) {
    const ing = getIngredientById(fi.ingredient_id);
    if (ing) {
      if (!ing.halal_certified) isHalal = false;
      if (!ing.vegan) isVegan = false;
      if (ing.max_percentage && fi.percentage > ing.max_percentage) {
        violations.push({
          type: 'regulatory',
          ingredient: ing.name,
          message: `Exceeds max allowed percentage (${ing.max_percentage}%)`,
        });
      }
    }
  }
  
  return reply.code(201).send({
    data: {
      formulation_id: formulation.id,
      is_halal_compliant: isHalal,
      is_kosher_compliant: true,
      is_vegan_compliant: isVegan,
      algerian_regulatory_compliant: violations.length === 0,
      violations,
      compliance_notes: violations.length === 0 ? 'All checks passed' : 'Issues found',
    },
  });
});

server.post(`${apiPrefix}/regulatory/formulations/:id/labels`, async (request, reply) => {
  const formulation = formulations.find(f => f.id === request.params.id);
  if (!formulation) {
    return reply.code(404).send({ error: 'Formulation not found' });
  }
  
  const ings = (formulation.ingredients || []).map(fi => {
    const ing = getIngredientById(fi.ingredient_id);
    return { name: ing?.name || 'Unknown', percentage: fi.percentage };
  });
  
  return reply.code(201).send({
    data: {
      ar: { name: formulation.name, ingredients: ings },
      fr: { name: formulation.name, ingredients: ings },
      en: { name: formulation.name, ingredients: ings },
    },
  });
});

// ============================================================================
// COST ROUTES
// ============================================================================

server.post(`${apiPrefix}/cost/formulations/:id/batch-cost`, async (request, reply) => {
  const { id } = request.params;
  const { batch_size_liters, overhead_percent = 15, margin_percent = 30 } = request.body;
  
  const formulation = formulations.find(f => f.id === id);
  if (!formulation) {
    return reply.code(404).send({ error: 'Formulation not found' });
  }
  
  const ingredientCost = (formulation.total_cost_per_liter || 0) * batch_size_liters;
  const overheadCost = ingredientCost * (overhead_percent / 100);
  const totalCost = ingredientCost + overheadCost;
  const marginAmount = totalCost * (margin_percent / 100);
  const finalPrice = totalCost + marginAmount;
  
  return reply.code(201).send({
    data: {
      batch_size_liters,
      breakdown: {
        ingredient_cost: ingredientCost,
        overhead_cost: overheadCost,
        total_cost: totalCost,
        margin: marginAmount,
        final_price: finalPrice,
        estimated_revenue: finalPrice * 1.2,
        estimated_profit: finalPrice * 0.2,
        roi_percent: 20,
      },
      per_liter: {
        ingredient_cost: ingredientCost / batch_size_liters,
        total_cost: totalCost / batch_size_liters,
        final_price: finalPrice / batch_size_liters,
      },
    },
  });
});

server.get(`${apiPrefix}/cost/formulations/:id/compare-batch-sizes`, async (request) => {
  const { id } = request.params;
  const formulation = formulations.find(f => f.id === id);
  if (!formulation) {
    return { error: 'Formulation not found' };
  }
  
  const sizes = [1, 10, 100, 1000, 10000];
  const baseCost = formulation.total_cost_per_liter || 10;
  
  return {
    data: sizes.map(size => ({
      batch_size_liters: size,
      cost_per_liter: baseCost * (1 - Math.log10(size) * 0.05),
      total_cost: baseCost * size * (1 - Math.log10(size) * 0.05),
      final_price_per_liter: baseCost * 1.5 * (1 - Math.log10(size) * 0.05),
      roi_percent: 20 + Math.log10(size) * 5,
    })),
  };
});

// Start server
const PORT = parseInt(process.env.PORT || '3001');
const HOST = '0.0.0.0';

try {
  await server.listen({ port: PORT, host: HOST });
  console.log(`🚀 BeverageAI DZ Backend running on http://localhost:${PORT}`);
  console.log(`📦 Mock mode: ${ingredients.length} ingredients loaded`);
} catch (err) {
  server.log.error(err);
  process.exit(1);
}
