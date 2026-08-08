import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import dotenv from 'dotenv';
import { pathToFileURL } from 'url';
import { z } from 'zod';
import {
  describeGeminiFailure,
  getAIConfiguration,
  reviewFormulationCandidates,
  reviewFormulationVariants,
} from './services/geminiService.js';

// Import mock data
import { 
  ingredients, 
  formulations, 
  categories, 
  generateId, 
  getIngredientById,
  addFormulation,
  updateFormulation,
  deleteFormulation,
  aiVariants,
  complianceRecords,
  batchCostCalculations,
  pricingHistory,
} from './data/mockData.js';
import { getStorageConfiguration, initializePersistentStore, persistStore } from './data/persistentStore.js';

dotenv.config();
await initializePersistentStore();

const server = Fastify({
  logger: true,
});

await server.register(helmet);

await server.register(rateLimit, {
  max: Number.parseInt(process.env.RATE_LIMIT_MAX || '200', 10),
  timeWindow: '1 minute',
});

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

await server.register(cors, {
  origin: allowedOrigins,
  credentials: true,
});

server.addHook('onSend', async (request, reply, payload) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && reply.statusCode < 400) {
    await persistStore();
  }
  return payload;
});

server.addHook('onRequest', async (request, reply) => {
  if (!process.env.API_KEY || request.url === '/health' || request.method === 'OPTIONS') return;
  if (request.headers['x-api-key'] !== process.env.API_KEY) {
    return reply.code(401).send({ error: 'Invalid or missing API key' });
  }
});

server.setErrorHandler((error, request, reply) => {
  if (error instanceof z.ZodError) {
    return reply.code(400).send({
      error: 'Invalid request',
      details: error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })),
    });
  }

  request.log.error(error);
  return reply.code(error.statusCode || 500).send({
    error: error.statusCode && error.statusCode < 500 ? error.message : 'Internal server error',
  });
});

// Health check endpoint
server.get('/health', async () => {
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    ...getStorageConfiguration(),
    ai: getAIConfiguration(),
  };
});

const apiPrefix = '/api/v1';

const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const formulationIngredientSchema = z.object({
  ingredient_id: z.string().min(1),
  percentage: z.coerce.number().finite().positive().max(100),
});

function processFormulationIngredients(input) {
  const formIngredients = z.array(formulationIngredientSchema).min(1).max(40).parse(input);
  const ids = formIngredients.map(item => item.ingredient_id);
  if (new Set(ids).size !== ids.length) {
    throw new z.ZodError([{ code: 'custom', path: ['ingredients'], message: 'Ingredient IDs must be unique' }]);
  }

  let totalPercentage = 0;
  let totalCost = 0;
  let totalCalories = 0;
  let totalSugar = 0;

  const processedIngredients = formIngredients.map((item, displayOrder) => {
    const ingredient = getIngredientById(item.ingredient_id);
    if (!ingredient || !ingredient.is_active) {
      throw new z.ZodError([{
        code: 'custom',
        path: ['ingredients', displayOrder, 'ingredient_id'],
        message: 'Ingredient does not exist or is inactive',
      }]);
    }

    if (ingredient.regulatory_status === 'prohibited') {
      throw new z.ZodError([{
        code: 'custom',
        path: ['ingredients', displayOrder, 'ingredient_id'],
        message: `${ingredient.name} is marked as prohibited`,
      }]);
    }

    if (ingredient.max_percentage && item.percentage > ingredient.max_percentage + 0.0001) {
      throw new z.ZodError([{
        code: 'custom',
        path: ['ingredients', displayOrder, 'percentage'],
        message: `${ingredient.name} cannot exceed ${ingredient.max_percentage}%`,
      }]);
    }

    const fraction = item.percentage / 100;
    const costContribution = fraction * ingredient.base_price_per_kg;
    totalPercentage += item.percentage;
    totalCost += costContribution;
    totalCalories += fraction * (ingredient.calories_per_100g || 0);
    totalSugar += fraction * (ingredient.sugar_g || 0);

    return {
      ...item,
      ingredient_name: ingredient.name,
      ingredient_code: ingredient.code,
      cost_contribution: costContribution,
      display_order: displayOrder,
    };
  });

  if (Math.abs(totalPercentage - 100) > 0.1001) {
    throw new z.ZodError([{
      code: 'custom',
      path: ['ingredients'],
      message: `Ingredient percentages must total 100% (received ${totalPercentage.toFixed(2)}%)`,
    }]);
  }

  return {
    ingredients: processedIngredients,
    total_percentage: Number(totalPercentage.toFixed(4)),
    total_cost_per_liter: totalCost,
    total_calories_per_100ml: totalCalories,
    total_sugar_per_100ml: totalSugar,
  };
}

// ============================================================================
// INGREDIENTS ROUTES
// ============================================================================

server.get(`${apiPrefix}/ingredients`, async (request) => {
  const { category, search } = request.query;
  const { limit, offset } = paginationSchema.parse(request.query);
  
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
  
  const paginated = filtered.slice(offset, offset + limit);
  
  return {
    data: paginated,
    pagination: {
      total: filtered.length,
      limit,
      offset,
      has_more: offset + paginated.length < filtered.length,
    },
  };
});

server.get(`${apiPrefix}/ingredients/:id`, async (request, reply) => {
  const ingredient = ingredients.find(i => i.id === request.params.id);
  if (!ingredient) {
    return reply.code(404).send({ error: 'Ingredient not found' });
  }
  return { data: ingredient };
});

server.get(`${apiPrefix}/ingredients/code/:code`, async (request, reply) => {
  const ingredient = ingredients.find(i => i.code.toLowerCase() === request.params.code.toLowerCase());
  if (!ingredient) {
    return reply.code(404).send({ error: 'Ingredient not found' });
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
  const ingredientInput = z.object({
    code: z.string().trim().min(1).max(50),
    name: z.string().trim().min(1).max(255),
    name_ar: z.string().trim().max(255).optional().default(''),
    name_fr: z.string().trim().max(255).optional().default(''),
    category: z.string().trim().min(1).max(100),
    base_price_per_kg: z.coerce.number().finite().nonnegative().default(0),
    calories_per_100g: z.coerce.number().finite().nonnegative().default(0),
    sugar_g: z.coerce.number().finite().nonnegative().max(100).default(0),
    halal_certified: z.boolean().default(true),
    kosher_certified: z.boolean().default(true),
    vegan: z.boolean().default(true),
    organic: z.boolean().default(false),
    regulatory_status: z.enum(['approved', 'restricted', 'prohibited', 'pending']).default('pending'),
    max_percentage: z.coerce.number().finite().positive().max(100).optional(),
  }).parse(request.body);

  if (ingredients.some(item => item.code.toLowerCase() === ingredientInput.code.toLowerCase())) {
    return reply.code(409).send({ error: 'Ingredient code already exists' });
  }

  const {
    code, name, name_ar, name_fr, category, base_price_per_kg,
    calories_per_100g, sugar_g, halal_certified, kosher_certified, vegan, organic,
    regulatory_status, max_percentage,
  } = ingredientInput;

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
    kosher_certified,
    vegan,
    organic,
    regulatory_status,
    max_percentage,
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

server.put(`${apiPrefix}/ingredients/:id`, async (request, reply) => {
  const ingredient = ingredients.find(item => item.id === request.params.id);
  if (!ingredient) {
    return reply.code(404).send({ error: 'Ingredient not found' });
  }

  const updates = z.object({
    code: z.string().trim().min(1).max(50).optional(),
    name: z.string().trim().min(1).max(255).optional(),
    name_ar: z.string().trim().max(255).optional(),
    name_fr: z.string().trim().max(255).optional(),
    category: z.string().trim().min(1).max(100).optional(),
    base_price_per_kg: z.coerce.number().finite().nonnegative().optional(),
    calories_per_100g: z.coerce.number().finite().nonnegative().optional(),
    sugar_g: z.coerce.number().finite().nonnegative().max(100).optional(),
    halal_certified: z.boolean().optional(),
    kosher_certified: z.boolean().optional(),
    vegan: z.boolean().optional(),
    organic: z.boolean().optional(),
    regulatory_status: z.enum(['approved', 'restricted', 'prohibited', 'pending']).optional(),
    max_percentage: z.coerce.number().finite().positive().max(100).nullable().optional(),
    is_active: z.boolean().optional(),
  }).strict().parse(request.body);

  if (updates.code && ingredients.some(item => item.id !== ingredient.id && item.code.toLowerCase() === updates.code.toLowerCase())) {
    return reply.code(409).send({ error: 'Ingredient code already exists' });
  }

  const previousPrice = ingredient.base_price_per_kg;
  Object.assign(ingredient, updates, { updated_at: new Date().toISOString() });
  if (updates.category && !categories.includes(updates.category)) categories.push(updates.category);
  let recalculatedFormulations = 0;
  if (updates.base_price_per_kg !== undefined && updates.base_price_per_kg !== previousPrice) {
    ingredient.price_per_kg = updates.base_price_per_kg;
    pricingHistory.push({
      id: generateId(),
      ingredient_id: ingredient.id,
      price_per_kg: updates.base_price_per_kg,
      currency: ingredient.currency || 'DZD',
      effective_date: new Date().toISOString(),
      source: 'ingredient edit',
    });
    for (const formulation of formulations.filter(item =>
      item.status !== 'archived' && (item.ingredients || []).some(fi => fi.ingredient_id === ingredient.id)
    )) {
      Object.assign(formulation, processFormulationIngredients(formulation.ingredients), { updated_at: new Date().toISOString() });
      recalculatedFormulations += 1;
    }
  }
  return { data: ingredient, recalculated_formulations: recalculatedFormulations };
});

server.delete(`${apiPrefix}/ingredients/:id`, async (request, reply) => {
  const ingredient = ingredients.find(item => item.id === request.params.id);
  if (!ingredient) {
    return reply.code(404).send({ error: 'Ingredient not found' });
  }
  const usedBy = formulations.filter(item => item.status !== 'archived' &&
    (item.ingredients || []).some(fi => fi.ingredient_id === ingredient.id));
  if (usedBy.length > 0) {
    return reply.code(409).send({
      error: `Ingredient is used by ${usedBy.length} non-archived formulation(s) and cannot be archived`,
    });
  }
  ingredient.is_active = false;
  ingredient.updated_at = new Date().toISOString();
  return { data: ingredient, message: 'Ingredient archived' };
});

// ============================================================================
// FORMULATIONS ROUTES
// ============================================================================

server.get(`${apiPrefix}/formulations`, async (request) => {
  const { search, status } = request.query;
  const { limit, offset } = paginationSchema.extend({ limit: z.coerce.number().int().min(1).max(500).default(50) }).parse(request.query);
  
  let filtered = status === 'all' ? [...formulations] : formulations.filter(item => item.status !== 'archived');
  
  if (status && status !== 'all') {
    filtered = filtered.filter(f => f.status === status);
  }
  
  if (search) {
    const searchLower = search.toLowerCase();
    filtered = filtered.filter(f => 
      f.name.toLowerCase().includes(searchLower) ||
      f.code.toLowerCase().includes(searchLower)
    );
  }
  
  const paginated = filtered.slice(offset, offset + limit);
  
  return {
    data: paginated,
    pagination: {
      total: filtered.length,
      limit,
      offset,
      has_more: offset + paginated.length < filtered.length,
    },
  };
});

server.get(`${apiPrefix}/formulations/:id`, async (request, reply) => {
  const formulation = formulations.find(f => f.id === request.params.id);
  if (!formulation) {
    return reply.code(404).send({ error: 'Formulation not found' });
  }
  return { data: formulation };
});

server.post(`${apiPrefix}/formulations`, async (request, reply) => {
  const input = z.object({
    code: z.string().trim().min(1).max(100).optional(),
    name: z.string().trim().min(1).max(255),
    description: z.string().trim().max(5000).optional().default(''),
    beverage_type: z.string().trim().min(1).max(100).optional().default('soft_drink'),
    ingredients: z.array(formulationIngredientSchema).min(1).max(40),
  }).parse(request.body);

  const code = input.code || `FORM-${Date.now()}`;
  if (formulations.some(item => item.code.toLowerCase() === code.toLowerCase())) {
    return reply.code(409).send({ error: 'Formulation code already exists' });
  }

  const totals = processFormulationIngredients(input.ingredients);
  
  const newFormulation = addFormulation({
    code,
    name: input.name,
    description: input.description,
    beverage_type: input.beverage_type,
    version: 1,
    is_latest_version: true,
    status: 'draft',
    ...totals,
  });
  
  return reply.code(201).send({ data: newFormulation });
});

server.put(`${apiPrefix}/formulations/:id`, async (request, reply) => {
  const { id } = request.params;
  const input = z.object({
    name: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().max(5000).optional(),
    status: z.enum(['draft', 'active', 'archived']).optional(),
    beverage_type: z.string().trim().min(1).max(100).optional(),
    ingredients: z.array(formulationIngredientSchema).min(1).max(40).optional(),
  }).strict().parse(request.body);
  
  const existing = formulations.find(f => f.id === id);
  if (!existing) {
    return reply.code(404).send({ error: 'Formulation not found' });
  }
  
  const updates = {};
  Object.assign(updates, input);
  if (input.ingredients) Object.assign(updates, processFormulationIngredients(input.ingredients));
  
  const updated = updateFormulation(id, updates);
  return { data: updated };
});

server.delete(`${apiPrefix}/formulations/:id`, async (request, reply) => {
  const deleted = deleteFormulation(request.params.id);
  if (!deleted) {
    return reply.code(404).send({ error: 'Formulation not found' });
  }
  return { data: deleted, message: 'Formulation archived' };
});

server.post(`${apiPrefix}/formulations/:id/versions`, async (request, reply) => {
  const source = formulations.find(item => item.id === request.params.id);
  if (!source) return reply.code(404).send({ error: 'Formulation not found' });

  const input = z.object({
    name: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().max(5000).optional(),
    beverage_type: z.string().trim().min(1).max(100).optional(),
    ingredients: z.array(formulationIngredientSchema).min(1).max(40).optional(),
  }).strict().parse(request.body || {});
  const totals = input.ingredients ? processFormulationIngredients(input.ingredients) : {
    ingredients: source.ingredients.map(item => ({ ...item })),
    total_percentage: source.total_percentage,
    total_cost_per_liter: source.total_cost_per_liter,
    total_calories_per_100ml: source.total_calories_per_100ml,
    total_sugar_per_100ml: source.total_sugar_per_100ml,
  };

  source.is_latest_version = false;
  const version = addFormulation({
    ...source,
    ...input,
    ...totals,
    id: undefined,
    code: `${source.code}-V${source.version + 1}`,
    version: source.version + 1,
    parent_formulation_id: source.parent_formulation_id || source.id,
    is_latest_version: true,
    status: 'draft',
  });
  return reply.code(201).send({ data: version });
});

server.get(`${apiPrefix}/formulations/:id/versions`, async (request, reply) => {
  const source = formulations.find(item => item.id === request.params.id);
  if (!source) return reply.code(404).send({ error: 'Formulation not found' });
  const rootId = source.parent_formulation_id || source.id;
  return { data: formulations.filter(item => item.id === rootId || item.parent_formulation_id === rootId) };
});

server.get(`${apiPrefix}/formulations/:id/nutrition`, async (request, reply) => {
  const formulation = formulations.find(item => item.id === request.params.id);
  if (!formulation) return reply.code(404).send({ error: 'Formulation not found' });
  return { data: {
    calories: formulation.total_calories_per_100ml,
    sugar: formulation.total_sugar_per_100ml,
  } };
});

server.get(`${apiPrefix}/formulations/:id/cost`, async (request, reply) => {
  const formulation = formulations.find(item => item.id === request.params.id);
  if (!formulation) return reply.code(404).send({ error: 'Formulation not found' });
  const batchSize = z.coerce.number().finite().positive().max(1000000).default(1).parse(request.query.batch_size);
  return { data: {
    batch_size_liters: batchSize,
    cost_per_liter: formulation.total_cost_per_liter,
    total_cost: formulation.total_cost_per_liter * batchSize,
  } };
});

// ============================================================================
// COMPATIBILITY ROUTES
// ============================================================================

server.get(`${apiPrefix}/compatibility/formulations/:id`, async (request, reply) => {
  const formulation = formulations.find(f => f.id === request.params.id);
  if (!formulation) {
    return reply.code(404).send({ error: 'Formulation not found' });
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

function evaluateIngredientPair(first, second) {
  const names = [first.name, second.name].map(name => name.toLowerCase());
  const categoriesInPair = new Set([first.category, second.category]);
  const benzeneRisk = names.some(name => name.includes('benzoate')) &&
    names.some(name => name.includes('vitamin c') || name.includes('ascorbic'));
  const precipitationRisk = names.some(name => name.includes('calcium')) &&
    names.some(name => name.includes('citric'));
  const acidColorRisk = categoriesInPair.has('acidulant') && categoriesInPair.has('colorant');
  const risk = benzeneRisk || precipitationRisk || acidColorRisk;
  const severity = benzeneRisk ? 'high' : risk ? 'medium' : 'none';
  return {
    ingredient_a_id: first.id,
    ingredient_b_id: second.id,
    compatibility_score: benzeneRisk ? 35 : risk ? 65 : 95,
    chemical_risk: benzeneRisk || acidColorRisk,
    physical_risk: precipitationRisk,
    sensory_risk: false,
    regulatory_risk: benzeneRisk,
    risk_severity: severity,
    risk_description: benzeneRisk
      ? 'Sodium benzoate and vitamin C can form benzene under heat or light.'
      : precipitationRisk
      ? 'Calcium and citric acid may form a visible precipitate.'
      : acidColorRisk
      ? 'Acidity may reduce color stability.'
      : 'No known compatibility issue in the mock rule set.',
  };
}

server.get(`${apiPrefix}/compatibility/ingredients/:ingredientAId/:ingredientBId`, async (request, reply) => {
  const first = getIngredientById(request.params.ingredientAId);
  const second = getIngredientById(request.params.ingredientBId);
  if (!first || !second) return reply.code(404).send({ error: 'Ingredient not found' });
  if (first.id === second.id) return reply.code(400).send({ error: 'Choose two different ingredients' });
  return { data: evaluateIngredientPair(first, second) };
});

server.post(`${apiPrefix}/compatibility/batch-compute`, async (request, reply) => {
  const input = z.object({ ingredient_ids: z.array(z.string().min(1)).min(2).max(100).optional() }).parse(request.body || {});
  const selected = input.ingredient_ids
    ? input.ingredient_ids.map(getIngredientById)
    : ingredients.filter(item => item.is_active);
  if (selected.some(item => !item)) return reply.code(404).send({ error: 'One or more ingredients were not found' });

  const results = [];
  for (let firstIndex = 0; firstIndex < selected.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < selected.length; secondIndex += 1) {
      results.push(evaluateIngredientPair(selected[firstIndex], selected[secondIndex]));
    }
  }
  return reply.code(201).send({ data: results, count: results.length });
});

// ============================================================================
// AI ROUTES
// ============================================================================

function percentageDifference(value, baseline) {
  if (baseline === 0) return value === 0 ? 0 : 100;
  return ((value - baseline) / baseline) * 100;
}

function assessVariantIngredients(variantIngredients) {
  const ingredientDetails = variantIngredients.map(item => getIngredientById(item.ingredient_id));
  const pairResults = [];
  for (let firstIndex = 0; firstIndex < ingredientDetails.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < ingredientDetails.length; secondIndex += 1) {
      pairResults.push(evaluateIngredientPair(ingredientDetails[firstIndex], ingredientDetails[secondIndex]));
    }
  }

  const riskyPairs = pairResults.filter(result => result.risk_severity !== 'none');
  const warnings = [...new Set(riskyPairs.map(result => result.risk_description))];
  const nonApprovedIngredients = ingredientDetails.filter(item => item.regulatory_status !== 'approved');
  warnings.push(...nonApprovedIngredients.map(item => `${item.name} has ${item.regulatory_status} regulatory status.`));

  return {
    compatibility_score: pairResults.length
      ? Math.min(...pairResults.map(result => result.compatibility_score))
      : 100,
    warnings: [...new Set(warnings)],
    regulatory: {
      passes_local_checks: nonApprovedIngredients.length === 0,
      is_halal_compliant: ingredientDetails.every(item => item.halal_certified),
      is_kosher_compliant: ingredientDetails.every(item => item.kosher_certified),
      is_vegan_compliant: ingredientDetails.every(item => item.vegan),
      note: 'Local ingredient-limit screening only; laboratory and legal review are still required.',
    },
  };
}

function generateVariantIngredients(sourceIngredients, generationType, constraints = {}) {
  const sourceIds = new Set(sourceIngredients.map(item => item.ingredient_id));
  const replacementIds = new Set();
  const details = sourceIngredients.map(item => {
    const sourceIngredient = getIngredientById(item.ingredient_id);
    let ingredient = sourceIngredient;
    if (generationType === 'alternative' && sourceIngredient?.category !== 'base') {
      const alternatives = ingredients.filter(candidate =>
        candidate.is_active &&
        candidate.category === sourceIngredient.category &&
        !sourceIds.has(candidate.id) &&
        !replacementIds.has(candidate.id) &&
        candidate.regulatory_status !== 'prohibited'
      );
      if (alternatives.length > 0) {
        ingredient = alternatives[Math.floor(Math.random() * alternatives.length)];
        replacementIds.add(ingredient.id);
      }
    }
    return { source: item, ingredient };
  });
  const balanceIndex = details.findIndex(item => item.ingredient?.category === 'base');
  const effectiveBalanceIndex = balanceIndex >= 0 ? balanceIndex : 0;
  const sugarBearingCount = Math.max(1, details.filter(item => item.ingredient?.sugar_g > 0).length);
  const calorieBearingCount = Math.max(1, details.filter(item => item.ingredient?.calories_per_100g > 0).length);

  const generated = details.map(({ source, ingredient }, index) => {
    if (index === effectiveBalanceIndex) {
      return { ingredient_id: ingredient.id, ingredient_name: ingredient.name, percentage: 0 };
    }

    let factor;
    if (generationType === 'optimization') {
      const pricePressure = Math.min((ingredient.base_price_per_kg || 0) / 3000, 0.08);
      factor = 0.9 + Math.random() * 0.1 - pricePressure;
    } else if (generationType === 'alternative') {
      factor = 0.7 + Math.random() * 0.6;
    } else {
      factor = 0.8 + Math.random() * 0.4;
    }

    let changedPercentage = Math.max(0.0001, source.percentage * factor);
    if (generationType === 'constraint_based') {
      if (constraints.target_sugar !== undefined && ingredient.sugar_g > 0) {
        changedPercentage = Math.max(0.0001, (constraints.target_sugar / sugarBearingCount / ingredient.sugar_g) * 100);
      } else if (constraints.target_calories !== undefined && ingredient.calories_per_100g > 0) {
        changedPercentage = Math.max(0.0001, (constraints.target_calories / calorieBearingCount / ingredient.calories_per_100g) * 100);
      } else if (constraints.target_cost_per_liter !== undefined && constraints.source_cost_per_liter > 0) {
        const costRatio = Math.max(0.5, Math.min(1.5, constraints.target_cost_per_liter / constraints.source_cost_per_liter));
        changedPercentage = source.percentage * costRatio;
      }
    }
    const percentage = ingredient.max_percentage
      ? Math.min(changedPercentage, ingredient.max_percentage)
      : changedPercentage;
    return { ingredient_id: ingredient.id, ingredient_name: ingredient.name, percentage };
  });

  const nonBalanceTotal = generated.reduce(
    (sum, item, index) => index === effectiveBalanceIndex ? sum : sum + item.percentage,
    0,
  );
  if (nonBalanceTotal >= 100) {
    throw new Error('Unable to generate a safe variant because non-base ingredients total 100% or more');
  }
  generated[effectiveBalanceIndex].percentage = 100 - nonBalanceTotal;
  return generated;
}

server.post(`${apiPrefix}/ai/formulations/:id/generate`, async (request, reply) => {
  const { id } = request.params;
  const { count, generation_type, target_calories, target_sugar, target_cost_per_liter } = z.object({
    count: z.coerce.number().int().min(1).max(10).default(5),
    generation_type: z.enum(['optimization', 'alternative', 'constraint', 'constraint_based'])
      .transform(value => value === 'constraint' ? 'constraint_based' : value)
      .default('optimization'),
    target_calories: z.coerce.number().finite().nonnegative().optional(),
    target_sugar: z.coerce.number().finite().nonnegative().optional(),
    target_cost_per_liter: z.coerce.number().finite().nonnegative().optional(),
  }).parse(request.body || {});
  
  const source = formulations.find(f => f.id === id);
  if (!source) {
    return reply.code(404).send({ error: 'Source formulation not found' });
  }
  
  const variants = [];
  const sourceIngredients = source.ingredients || [];
  const sourceTotals = processFormulationIngredients(sourceIngredients);

  for (let i = 0; i < count; i++) {
    const variantIngredients = generateVariantIngredients(sourceIngredients, generation_type, {
      target_calories,
      target_sugar,
      target_cost_per_liter,
      source_cost_per_liter: sourceTotals.total_cost_per_liter,
    });
    const totals = processFormulationIngredients(variantIngredients);
    const assessment = assessVariantIngredients(totals.ingredients);
    const localConfidence = Math.max(0, Math.min(
      assessment.compatibility_score,
      assessment.regulatory.passes_local_checks ? 88 : 50,
    ));
    const variant = {
      id: generateId(),
      source_formulation_id: id,
      source_formulation_name: source.name,
      generation_type,
      variant_ingredients: totals.ingredients,
      confidence_score: localConfidence,
      explanation: generation_type === 'optimization' 
        ? `Locally generated cost-oriented variant ${i + 1}; calculated values and ingredient limits have been checked.`
        : generation_type === 'alternative'
        ? `Locally generated alternative ${i + 1} with a broader change in ingredient proportions.`
        : `Locally generated constraint-oriented variant ${i + 1}; no explicit targets were supplied.`,
      cost_difference_percent: percentageDifference(totals.total_cost_per_liter, sourceTotals.total_cost_per_liter),
      calorie_difference_percent: percentageDifference(totals.total_calories_per_100ml, sourceTotals.total_calories_per_100ml),
      sugar_difference_percent: percentageDifference(totals.total_sugar_per_100ml, sourceTotals.total_sugar_per_100ml),
      calculated_values: {
        cost_per_liter: totals.total_cost_per_liter,
        calories_per_100ml: totals.total_calories_per_100ml,
        sugar_per_100ml: totals.total_sugar_per_100ml,
      },
      compatibility_score: assessment.compatibility_score,
      regulatory: assessment.regulatory,
      warnings: assessment.warnings,
      recommended: false,
      status: 'generated',
      created_at: new Date().toISOString(),
    };
    variants.push(variant);
  }

  let ai = { ...getAIConfiguration(), used: false, reason: 'Gemini review was not attempted' };
  try {
    ai = await reviewFormulationVariants({
      sourceFormulation: source,
      variants,
      generationType: generation_type,
      constraints: { target_calories, target_sugar, target_cost_per_liter },
    });
    if (ai.used) {
      const reviewsById = new Map(ai.reviews.map(review => [review.id, review]));
      for (const variant of variants) {
        const review = reviewsById.get(variant.id);
        variant.confidence_score = review.confidence_score;
        variant.explanation = review.explanation;
        variant.warnings = [...new Set([...variant.warnings, ...review.warnings])];
        variant.recommended = review.recommended;
      }
    }
  } catch (error) {
    request.log.warn({ err: error }, 'Gemini variant review failed; using validated local results');
    ai = { ...getAIConfiguration(), used: false, reason: describeGeminiFailure(error) };
  }

  variants.forEach(variant => aiVariants.push(variant));
  const { reviews: _reviews, ...publicAI } = ai;
  return reply.code(201).send({ data: variants, count: variants.length, ai: publicAI });
});

server.get(`${apiPrefix}/ai/formulations/:id/variants`, async (request, reply) => {
  if (!formulations.some(item => item.id === request.params.id)) {
    return reply.code(404).send({ error: 'Source formulation not found' });
  }
  const { limit, offset } = paginationSchema.extend({ limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(request.query);
  const filtered = aiVariants.filter(item =>
    item.source_formulation_id === request.params.id && (!request.query.status || item.status === request.query.status)
  );
  return {
    data: filtered.slice(offset, offset + limit),
    pagination: { total: filtered.length, limit, offset, has_more: offset + limit < filtered.length },
  };
});

// Accept AI variant and create formulation
server.post(`${apiPrefix}/ai/variants/:variantId/accept`, async (request, reply) => {
  const { variantId } = request.params;
  const { variant_data } = z.object({
    variant_data: z.object({
      source_name: z.string().trim().min(1).max(255).optional(),
      beverage_type: z.string().trim().min(1).max(100).optional(),
      explanation: z.string().trim().max(5000).optional(),
      ingredients: z.array(formulationIngredientSchema).optional(),
    }),
  }).parse(request.body);

  const storedVariant = aiVariants.find(item => item.id === variantId);
  if (!storedVariant) return reply.code(404).send({ error: 'AI variant not found' });
  if (storedVariant.status === 'accepted') return reply.code(409).send({ error: 'AI variant was already accepted' });
  
  const totals = processFormulationIngredients(storedVariant.variant_ingredients);
  
  const newFormulation = addFormulation({
    code: `AI-${Date.now()}`,
    name: `${variant_data.source_name || 'AI Variant'} (AI Generated)`,
    description: variant_data.explanation || 'Created from AI recommendation',
    beverage_type: variant_data.beverage_type || 'soft_drink',
    version: 1,
    is_latest_version: true,
    status: 'draft',
    ...totals,
  });

  storedVariant.status = 'accepted';
  storedVariant.accepted_formulation_id = newFormulation.id;
  
  return reply.code(201).send({ 
    data: newFormulation,
    message: 'AI variant accepted and formulation created successfully'
  });
});

// ============================================================================
// TARGET GENERATION ROUTES
// ============================================================================

server.post(`${apiPrefix}/target-generation/generate`, async (request, reply) => {
  const targetInput = z.object({
    target_calories: z.coerce.number().finite().nonnegative().optional(),
    target_sugar: z.coerce.number().finite().nonnegative().optional(),
    target_cost_per_liter: z.coerce.number().finite().nonnegative().optional(),
    beverage_type: z.string().trim().min(1).max(100).optional(),
    count: z.coerce.number().int().min(1).max(10).default(3),
    min_ingredients: z.coerce.number().int().min(1).max(40).default(5),
    max_ingredients: z.coerce.number().int().min(1).max(40).default(10),
  }).refine(input => input.min_ingredients <= input.max_ingredients, {
    path: ['min_ingredients'],
    message: 'min_ingredients cannot exceed max_ingredients',
  }).parse(request.body || {});
  const {
    target_calories, target_sugar, target_cost_per_liter, beverage_type, count,
    min_ingredients, max_ingredients,
  } = targetInput;

  const activeIngredients = ingredients.filter(item => item.is_active && item.regulatory_status === 'approved');
  if (min_ingredients > activeIngredients.length) {
    return reply.code(400).send({ error: `Only ${activeIngredients.length} active, locally approved ingredients are available` });
  }
  
  // Generate candidates with detailed scoring
  const candidates = [];
  
  for (let i = 0; i < count; i++) {
    const selectedIngredients = [];
    
    // Always include water (base)
    const bases = activeIngredients.filter(ing => ing.category === 'base')
      .sort((a, b) => a.base_price_per_kg - b.base_price_per_kg);
    const water = bases[i % Math.max(bases.length, 1)];
    if (water) {
      selectedIngredients.push({ 
        ingredient_id: water.id, 
        ingredient_name: water.name,
        category: water.category,
        percentage: 0,
      });
    }
    
    // Add sweetener based on target sugar
    const sweeteners = activeIngredients.filter(ing => ing.category === 'sweetener');
    if (sweeteners.length > 0) {
      const zeroSugarSweeteners = sweeteners.filter(item => item.sugar_g === 0);
      const sugarSweeteners = sweeteners.filter(item => item.sugar_g > 0);
      const sweetenerPool = target_sugar === 0 && zeroSugarSweeteners.length > 0
        ? zeroSugarSweeteners
        : target_sugar > 0 && sugarSweeteners.length > 0
        ? sugarSweeteners
        : sweeteners;
      const orderedSweeteners = [...sweetenerPool].sort((a, b) =>
        target_cost_per_liter === undefined ? a.name.localeCompare(b.name) : a.base_price_per_kg - b.base_price_per_kg
      );
      const sweetener = orderedSweeteners[i % orderedSweeteners.length];
      const effectiveSugarTarget = target_sugar ?? (target_calories !== undefined ? target_calories / 3.87 : undefined);
      const sweetenerPct = target_sugar === 0
        ? Math.min(sweetener.max_percentage || 0.05, 0.05)
        : effectiveSugarTarget !== undefined
        ? (effectiveSugarTarget / Math.max(sweetener.sugar_g, 1)) * 100
        : 8 + i;
      selectedIngredients.push({ 
        ingredient_id: sweetener.id, 
        ingredient_name: sweetener.name,
        category: sweetener.category,
        percentage: Math.min(sweetener.max_percentage || 15, 15, Math.max(0.01, sweetenerPct))
      });
    }
    
    // Add acidulant
    const acidulants = activeIngredients.filter(ing => ing.category === 'acidulant');
    if (acidulants.length > 0) {
      const acidulant = acidulants[i % acidulants.length];
      selectedIngredients.push({ 
        ingredient_id: acidulant.id, 
        ingredient_name: acidulant.name,
        category: acidulant.category,
        percentage: Math.min(acidulant.max_percentage || 0.3, 0.25 + (i % 3) * 0.05),
      });
    }
    
    // Add flavor
    const flavors = activeIngredients.filter(ing => ing.category === 'flavor');
    if (flavors.length > 0) {
      const flavor = flavors[i % flavors.length];
      selectedIngredients.push({ 
        ingredient_id: flavor.id, 
        ingredient_name: flavor.name,
        category: flavor.category,
        percentage: Math.min(flavor.max_percentage || 0.25, 0.15 + (i % 3) * 0.05),
      });
    }
    
    // Add preservative
    const preservatives = activeIngredients.filter(ing => ing.category === 'preservative');
    if (preservatives.length > 0) {
      const preservative = preservatives[i % preservatives.length];
      selectedIngredients.push({ 
        ingredient_id: preservative.id, 
        ingredient_name: preservative.name,
        category: preservative.category,
        percentage: Math.min(preservative.max_percentage || 0.04, 0.04),
      });
    }
    
    // Optionally add colorant
    if (i % 2 === 1) {
      const colorants = activeIngredients.filter(ing => ing.category === 'colorant');
      if (colorants.length > 0) {
        const colorant = colorants[i % colorants.length];
        selectedIngredients.push({ 
          ingredient_id: colorant.id, 
          ingredient_name: colorant.name,
          category: colorant.category,
          percentage: Math.min(colorant.max_percentage || 0.02, 0.02),
        });
      }
    }
    
    // Honor requested ingredient-count bounds using low-dose, active ingredients.
    const desiredCount = Math.min(max_ingredients, min_ingredients + (i % (max_ingredients - min_ingredients + 1)));
    const alreadySelected = new Set(selectedIngredients.map(item => item.ingredient_id));
    const additions = activeIngredients
      .filter(item => !alreadySelected.has(item.id) && item.category !== 'base')
      .sort((a, b) => {
        if (target_cost_per_liter !== undefined) return a.base_price_per_kg - b.base_price_per_kg;
        return a.name.localeCompare(b.name);
      });
    while (selectedIngredients.length < desiredCount && additions.length > 0) {
      const ingredient = additions.shift();
      selectedIngredients.push({
        ingredient_id: ingredient.id,
        ingredient_name: ingredient.name,
        category: ingredient.category,
        percentage: Math.min(ingredient.max_percentage || 0.05, 0.05),
      });
    }
    if (selectedIngredients.length > max_ingredients) selectedIngredients.splice(max_ingredients);

    // Water is the balance ingredient; never inflate limited additives through normalization.
    const balanceIngredient = selectedIngredients[0];
    const nonWaterTotal = selectedIngredients.slice(1).reduce((sum, item) => sum + item.percentage, 0);
    if (nonWaterTotal >= 100) {
      return reply.code(400).send({ error: 'The requested targets cannot produce a safe 100% formulation' });
    }
    balanceIngredient.percentage = 100 - nonWaterTotal;
    
    // Calculate actual values
    let actualCalories = 0;
    let actualSugar = 0;
    let actualCost = 0;
    
    for (const item of selectedIngredients) {
      const ing = getIngredientById(item.ingredient_id);
      if (ing) {
        actualCalories += (item.percentage / 100) * (ing.calories_per_100g || 0);
        actualSugar += (item.percentage / 100) * (ing.sugar_g || 0);
        actualCost += (item.percentage / 100) * (ing.base_price_per_kg || 0);
      }
    }
    
    const localAssessment = assessVariantIngredients(selectedIngredients);
    const hasAcidulant = selectedIngredients.some(item => item.category === 'acidulant');
    const hasFlavor = selectedIngredients.some(item => item.category === 'flavor');
    const hasPreservative = selectedIngredients.some(item => item.category === 'preservative');
    const sweetnessScore = target_sugar !== undefined
      ? target_sugar === 0 ? (actualSugar < 0.01 ? 100 : 0) : Math.max(0, 100 - Math.abs(actualSugar - target_sugar) / target_sugar * 100)
      : 80;
    const stabilityBase = Math.max(40, localAssessment.compatibility_score - (hasAcidulant ? 0 : 10));

    // These deterministic values are local screening heuristics, not laboratory predictions.
    const scores = {
      // Target matching scores
      calorie_match: target_calories !== undefined
        ? target_calories === 0 ? (actualCalories < 0.01 ? 100 : 0) : Math.max(0, 100 - Math.abs(actualCalories - target_calories) / target_calories * 100)
        : 100,
      sugar_match: target_sugar !== undefined
        ? target_sugar === 0 ? (actualSugar < 0.01 ? 100 : 0) : Math.max(0, 100 - Math.abs(actualSugar - target_sugar) / target_sugar * 100)
        : 100,
      cost_match: target_cost_per_liter !== undefined
        ? target_cost_per_liter === 0 ? (actualCost < 0.01 ? 100 : 0) : Math.max(0, 100 - Math.abs(actualCost - target_cost_per_liter) / target_cost_per_liter * 100)
        : 100,
      
      // Compatibility score
      compatibility: localAssessment.compatibility_score,
      
      // Sensory evaluation
      sensory: {
        taste_balance: Math.round((sweetnessScore + (hasAcidulant ? 85 : 60) + (hasFlavor ? 85 : 55)) / 3),
        sweetness_level: Math.round(sweetnessScore),
        acidity_balance: hasAcidulant ? 85 : 55,
        flavor_intensity: hasFlavor ? 85 : 55,
      },
      
      // Regulatory compliance
      regulatory: {
        halal_compliant: localAssessment.regulatory.is_halal_compliant,
        kosher_compliant: localAssessment.regulatory.is_kosher_compliant,
        vegan_compliant: localAssessment.regulatory.is_vegan_compliant,
        max_limits_ok: localAssessment.regulatory.passes_local_checks,
        preservative_ok: !hasPreservative || hasAcidulant,
      },
      
      // Stability prediction
      stability: {
        shelf_life_months: hasPreservative && hasAcidulant ? 9 : 3,
        ph_stability: stabilityBase,
        color_stability: Math.max(40, stabilityBase - (selectedIngredients.some(item => item.category === 'colorant') ? 5 : 0)),
      },
      basis: 'deterministic local screening heuristic; laboratory validation required',
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
      local_warnings: localAssessment.warnings,
    });
  }

  let ai = { ...getAIConfiguration(), used: false };
  try {
    const reviewResult = await reviewFormulationCandidates({
      candidates,
      constraints: { target_calories, target_sugar, target_cost_per_liter, beverage_type },
    });
    ai = {
      provider: reviewResult.provider,
      model: reviewResult.model,
      configured: reviewResult.configured,
      used: reviewResult.used,
      reason: reviewResult.reason,
    };

    if (reviewResult.used) {
      const reviewsById = new Map(reviewResult.reviews.map(review => [review.id, review]));
      for (const candidate of candidates) {
        const review = reviewsById.get(candidate.id);
        candidate.scores.compatibility = review.compatibility;
        candidate.scores.sensory = review.sensory;
        candidate.scores.stability = review.stability;
        candidate.ai_explanation = review.explanation;
        candidate.ai_warnings = review.warnings;

        const sensoryAverage = Object.values(review.sensory).reduce((sum, value) => sum + value, 0) / 4;
        const targetMatchAverage = (
          candidate.scores.calorie_match + candidate.scores.sugar_match + candidate.scores.cost_match
        ) / 3;
        candidate.overall_score = (
          targetMatchAverage * 0.4 +
          review.compatibility * 0.25 +
          sensoryAverage * 0.25 +
          ((review.stability.ph_stability + review.stability.color_stability) / 2) * 0.1
        );
      }
    }
  } catch (error) {
    request.log.warn({ err: error }, 'Gemini review failed; returning validated local candidates');
    ai = {
      ...getAIConfiguration(),
      used: false,
      reason: error.name === 'AbortError' ? 'Gemini request timed out' : 'Gemini review was unavailable',
    };
  }
  
  // Sort by overall score
  candidates.sort((a, b) => b.overall_score - a.overall_score);
  
  return reply.code(201).send({
    data: { candidates, formulations: [], ai },
    message: `Generated ${candidates.length} candidates`,
  });
});

// Save target-generated candidate as formulation
server.post(`${apiPrefix}/target-generation/save`, async (request, reply) => {
  const { candidate, name } = z.object({
    candidate: z.object({
      ingredients: z.array(formulationIngredientSchema).min(1).max(40),
      overall_score: z.coerce.number().finite().min(0).max(100).optional(),
      beverage_type: z.string().trim().min(1).max(100).optional(),
    }).passthrough(),
    name: z.string().trim().min(1).max(255).optional(),
  }).parse(request.body);
  
  const totals = processFormulationIngredients(candidate.ingredients);
  
  const newFormulation = addFormulation({
    code: `TGT-${Date.now()}`,
    name: name || `Target-Generated ${new Date().toLocaleDateString()}`,
    description: `Generated from target constraints. Overall score: ${candidate.overall_score?.toFixed(1)}`,
    beverage_type: candidate.beverage_type || 'soft_drink',
    version: 1,
    is_latest_version: true,
    status: 'draft',
    ...totals,
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
  let isKosher = true;
  let isVegan = true;
  const violations = [];
  const warnings = [];
  
  for (const fi of (formulation.ingredients || [])) {
    const ing = getIngredientById(fi.ingredient_id);
    if (ing) {
      if (!ing.halal_certified) isHalal = false;
      if (!ing.kosher_certified) isKosher = false;
      if (!ing.vegan) isVegan = false;
      if (ing.max_percentage && fi.percentage > ing.max_percentage) {
        violations.push({
          type: 'regulatory',
          ingredient: ing.name,
          message: `Exceeds max allowed percentage (${ing.max_percentage}%)`,
        });
      }
      if (ing.regulatory_status === 'restricted') {
        violations.push({
          type: 'regulatory',
          ingredient: ing.name,
          message: 'Ingredient has restricted status and requires jurisdiction-specific review',
        });
      }
    } else {
      violations.push({ type: 'data', message: `Ingredient ${fi.ingredient_id} was not found` });
    }
  }

  const assessment = assessVariantIngredients(formulation.ingredients || []);
  warnings.push(...assessment.warnings);
  
  const compliance = {
      id: generateId(),
      formulation_id: formulation.id,
      is_halal_compliant: isHalal,
      is_kosher_compliant: isKosher,
      is_vegan_compliant: isVegan,
      algerian_regulatory_compliant: violations.length === 0,
      violations,
      warnings,
      compliance_notes: violations.length === 0
        ? 'Passed the application’s local ingredient-data screen. This is not legal certification.'
        : 'The local screen found issues. A qualified regulatory review is required.',
      review_scope: 'Local ingredient certification flags, status, and maximum-percentage data only',
      checked_at: new Date().toISOString(),
    };
  const previousIndex = complianceRecords.findIndex(item => item.formulation_id === formulation.id);
  if (previousIndex >= 0) complianceRecords[previousIndex] = compliance;
  else complianceRecords.push(compliance);
  return reply.code(201).send({ data: compliance });
});

server.get(`${apiPrefix}/regulatory/formulations/:id/compliance`, async (request, reply) => {
  if (!formulations.some(item => item.id === request.params.id)) {
    return reply.code(404).send({ error: 'Formulation not found' });
  }
  const compliance = complianceRecords.find(item => item.formulation_id === request.params.id);
  if (!compliance) return reply.code(404).send({ error: 'Compliance has not been checked' });
  return { data: compliance };
});

server.post(`${apiPrefix}/regulatory/formulations/:id/labels`, async (request, reply) => {
  const formulation = formulations.find(f => f.id === request.params.id);
  if (!formulation) {
    return reply.code(404).send({ error: 'Formulation not found' });
  }
  
  const labelIngredients = (language) => (formulation.ingredients || [])
    .slice()
    .sort((a, b) => b.percentage - a.percentage)
    .map(fi => {
    const ing = getIngredientById(fi.ingredient_id);
    const localizedName = language === 'ar' ? ing?.name_ar : language === 'fr' ? ing?.name_fr : ing?.name_en;
    return { name: localizedName || ing?.name || 'Unknown', percentage: fi.percentage };
  });

  const nutrition = {
    calories: Number((formulation.total_calories_per_100ml || 0).toFixed(1)),
    sugar: Number((formulation.total_sugar_per_100ml || 0).toFixed(1)),
    basis: 'per 100 ml, calculated from ingredient records',
  };
  const isHalal = (formulation.ingredients || []).every(fi => getIngredientById(fi.ingredient_id)?.halal_certified);
  
  const labels = {
      ar: {
        name: formulation.name,
        ingredients: labelIngredients('ar'),
        nutrition,
        halal: isHalal,
        notice: 'مسودة للمراجعة فقط — يجب التحقق من المتطلبات القانونية قبل الاستخدام.',
      },
      fr: {
        name: formulation.name,
        ingredients: labelIngredients('fr'),
        nutrition,
        halal: isHalal,
        notice: 'Projet à vérifier — valider les exigences légales avant utilisation.',
      },
      en: {
        name: formulation.name,
        ingredients: labelIngredients('en'),
        nutrition,
        halal: isHalal,
        notice: 'Draft for review — verify legal requirements before use.',
      },
    };
  formulation.labels = labels;
  return reply.code(201).send({ data: labels });
});

server.get(`${apiPrefix}/regulatory/formulations/:id/labels`, async (request, reply) => {
  const formulation = formulations.find(item => item.id === request.params.id);
  if (!formulation) return reply.code(404).send({ error: 'Formulation not found' });
  if (!formulation.labels) return reply.code(404).send({ error: 'Labels have not been generated' });
  const language = request.query.language;
  if (language && !['ar', 'fr', 'en'].includes(language)) {
    return reply.code(400).send({ error: 'Language must be ar, fr, or en' });
  }
  return { data: language ? formulation.labels[language] : formulation.labels };
});

// ============================================================================
// COST ROUTES
// ============================================================================

server.post(`${apiPrefix}/cost/formulations/:id/batch-cost`, async (request, reply) => {
  const { id } = request.params;
  const { batch_size_liters, overhead_percent, margin_percent } = z.object({
    batch_size_liters: z.coerce.number().finite().positive().max(1000000),
    overhead_percent: z.coerce.number().finite().min(0).max(1000).default(15),
    margin_percent: z.coerce.number().finite().min(0).max(1000).default(30),
  }).parse(request.body);
  
  const formulation = formulations.find(f => f.id === id);
  if (!formulation) {
    return reply.code(404).send({ error: 'Formulation not found' });
  }
  
  const ingredientCost = (formulation.total_cost_per_liter || 0) * batch_size_liters;
  const overheadCost = ingredientCost * (overhead_percent / 100);
  const totalCost = ingredientCost + overheadCost;
  const marginAmount = totalCost * (margin_percent / 100);
  const finalPrice = totalCost + marginAmount;
  
  const calculation = {
      id: generateId(),
      formulation_id: id,
      batch_size_liters,
      breakdown: {
        ingredient_cost: ingredientCost,
        overhead_cost: overheadCost,
        total_cost: totalCost,
        margin: marginAmount,
        final_price: finalPrice,
        estimated_revenue: finalPrice,
        estimated_profit: marginAmount,
        roi_percent: totalCost === 0 ? 0 : (marginAmount / totalCost) * 100,
      },
      per_liter: {
        ingredient_cost: ingredientCost / batch_size_liters,
        total_cost: totalCost / batch_size_liters,
        final_price: finalPrice / batch_size_liters,
      },
      calculated_at: new Date().toISOString(),
    };
  batchCostCalculations.push(calculation);
  return reply.code(201).send({ data: calculation });
});

server.get(`${apiPrefix}/cost/formulations/:id/batch-costs`, async (request, reply) => {
  if (!formulations.some(item => item.id === request.params.id)) {
    return reply.code(404).send({ error: 'Formulation not found' });
  }
  const { limit, offset } = paginationSchema.extend({ limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(request.query);
  const filtered = batchCostCalculations.filter(item => item.formulation_id === request.params.id);
  return {
    data: filtered.slice(offset, offset + limit),
    pagination: { total: filtered.length, limit, offset, has_more: offset + limit < filtered.length },
  };
});

server.get(`${apiPrefix}/cost/formulations/:id/compare-batch-sizes`, async (request, reply) => {
  const { id } = request.params;
  const formulation = formulations.find(f => f.id === id);
  if (!formulation) {
    return reply.code(404).send({ error: 'Formulation not found' });
  }
  
  const sizes = request.query.sizes
    ? request.query.sizes.split(',').map(value => z.coerce.number().finite().positive().max(1000000).parse(value))
    : [1, 10, 100, 1000, 10000];
  const baseCost = formulation.total_cost_per_liter || 0;
  
  return {
    data: sizes.map(size => ({
      batch_size_liters: size,
      cost_per_liter: baseCost,
      total_cost: baseCost * size,
      final_price_per_liter: baseCost * 1.5,
      roi_percent: baseCost === 0 ? 0 : 50,
      assumption: 'Ingredient unit prices are constant because no quantity-tier supplier prices are configured.',
    })),
  };
});

server.post(`${apiPrefix}/cost/formulations/:id/roi`, async (request, reply) => {
  const formulation = formulations.find(item => item.id === request.params.id);
  if (!formulation) return reply.code(404).send({ error: 'Formulation not found' });
  const input = z.object({
    batch_size_liters: z.coerce.number().finite().positive().max(1000000),
    selling_price_per_liter: z.coerce.number().finite().nonnegative(),
  }).parse(request.body);
  const totalCost = formulation.total_cost_per_liter * input.batch_size_liters;
  const estimatedRevenue = input.selling_price_per_liter * input.batch_size_liters;
  const estimatedProfit = estimatedRevenue - totalCost;
  return { data: {
    batch_size_liters: input.batch_size_liters,
    cost_per_liter: formulation.total_cost_per_liter,
    selling_price_per_liter: input.selling_price_per_liter,
    total_cost: totalCost,
    total_revenue: estimatedRevenue,
    profit: estimatedProfit,
    estimated_revenue: estimatedRevenue,
    estimated_profit: estimatedProfit,
    roi_percent: totalCost === 0 ? 0 : (estimatedProfit / totalCost) * 100,
    break_even_price: formulation.total_cost_per_liter,
  } };
});

server.post(`${apiPrefix}/cost/ingredients/:ingredientId/pricing`, async (request, reply) => {
  const ingredient = getIngredientById(request.params.ingredientId);
  if (!ingredient) return reply.code(404).send({ error: 'Ingredient not found' });
  const input = z.object({
    price_per_kg: z.coerce.number().finite().nonnegative(),
    currency: z.string().trim().length(3).default('DZD'),
    effective_date: z.coerce.date().default(() => new Date()),
  }).parse(request.body);
  const record = { id: generateId(), ingredient_id: request.params.ingredientId, ...input, effective_date: input.effective_date.toISOString() };
  pricingHistory.push(record);
  let recalculated_formulations = 0;
  if (input.effective_date <= new Date()) {
    ingredient.base_price_per_kg = input.price_per_kg;
    ingredient.price_per_kg = input.price_per_kg;
    ingredient.currency = input.currency;
    ingredient.updated_at = new Date().toISOString();
    for (const formulation of formulations.filter(item =>
      (item.ingredients || []).some(formulationIngredient => formulationIngredient.ingredient_id === ingredient.id)
    )) {
      Object.assign(formulation, processFormulationIngredients(formulation.ingredients), { updated_at: new Date().toISOString() });
      recalculated_formulations += 1;
    }
  }
  return reply.code(201).send({ data: record, recalculated_formulations });
});

server.get(`${apiPrefix}/cost/ingredients/:ingredientId/pricing`, async (request, reply) => {
  if (!getIngredientById(request.params.ingredientId)) return reply.code(404).send({ error: 'Ingredient not found' });
  const { limit, offset } = paginationSchema.parse(request.query);
  const filtered = pricingHistory.filter(item => item.ingredient_id === request.params.ingredientId);
  return { data: filtered.slice(offset, offset + limit), pagination: { total: filtered.length, limit, offset, has_more: offset + limit < filtered.length } };
});

export default server;

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) {
  const port = Number.parseInt(process.env.PORT || '3001', 10);
  const host = process.env.HOST || '127.0.0.1';
  try {
    await server.listen({ port, host });
    console.log(`BeverageAI DZ Backend running on http://localhost:${port}`);
    console.log(`Storage mode: ${getStorageConfiguration().mode}; ${ingredients.length} ingredients loaded`);
  } catch (error) {
    server.log.error(error);
    process.exit(1);
  }
}
