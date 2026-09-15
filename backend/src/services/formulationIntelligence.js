import { createHash } from 'node:crypto';

export const FORMULATION_ENGINE_VERSION = '2.0.0';

const DEFAULT_PERCENTAGES = {
  sweetener: 8, acidulant: 0.25, flavor: 0.18, preservative: 0.04,
  colorant: 0.01, vitamin: 0.03, mineral: 0.05, stimulant: 0.02,
  carbonation: 0.3, juice: 10, stabilizer: 0.08, emulsifier: 0.08, extract: 0.15,
};

const round = (value, digits = 6) => Number(Number(value).toFixed(digits));

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  return value;
}

export function inputSignature(input) {
  return createHash('sha256').update(JSON.stringify(stableValue(input))).digest('hex');
}

function ingredientMetric(ingredient, objective) {
  if (objective === 'cost') return Number(ingredient.base_price_per_kg || 0);
  if (objective === 'sugar') return Number(ingredient.sugar_g || 0);
  if (objective === 'calories') return Number(ingredient.calories_per_100g || 0);
  return ingredient.name.toLowerCase();
}

function compareIngredients(a, b, objective) {
  const av = ingredientMetric(a, objective);
  const bv = ingredientMetric(b, objective);
  if (typeof av === 'number' && typeof bv === 'number' && av !== bv) return av - bv;
  return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

function defaultDose(ingredient, constraints, strategyFactor) {
  const bound = constraints.ingredient_bounds.find(item => item.ingredient_id === ingredient.id);
  const minimum = Number(bound?.min_percentage || 0);
  const maximum = Math.min(Number(bound?.max_percentage ?? Infinity), Number(ingredient.max_percentage ?? Infinity));
  let dose = DEFAULT_PERCENTAGES[ingredient.category] ?? 0.05;
  if (ingredient.category === 'sweetener') {
    const sugarLimit = constraints.max_sugar_g_per_100ml ?? constraints.target_sugar;
    if (sugarLimit !== undefined && ingredient.sugar_g > 0) dose = (sugarLimit / ingredient.sugar_g) * 100 * strategyFactor;
    if (sugarLimit === 0 && ingredient.sugar_g === 0) dose = 0.03;
  }
  if (ingredient.category === 'juice' && constraints.minimum_juice_percent !== undefined) {
    dose = Math.max(dose, constraints.minimum_juice_percent);
  }
  if (ingredient.category === 'preservative' && constraints.maximum_preservative_percent !== undefined) {
    dose = Math.min(dose, constraints.maximum_preservative_percent);
  }
  return round(Math.max(minimum, Math.min(dose, maximum)));
}

export function preflightFormulationGeneration(constraints, ingredients) {
  const byId = new Map(ingredients.map(item => [item.id, item]));
  const required = new Set(constraints.required_ingredient_ids);
  for (const bound of constraints.ingredient_bounds) if ((bound.min_percentage ?? 0) > 0) required.add(bound.ingredient_id);
  const forbidden = new Set(constraints.forbidden_ingredient_ids);
  const blockers = [];
  for (const id of required) {
    if (!byId.has(id)) blockers.push({ code: 'REQUIRED_INGREDIENT_UNAVAILABLE', ingredient_id: id, message: `Required ingredient ${id} is not active and locally approved.` });
    if (forbidden.has(id)) blockers.push({ code: 'REQUIRED_AND_FORBIDDEN', ingredient_id: id, message: `Ingredient ${id} cannot be both required and forbidden.` });
  }
  for (const bound of constraints.ingredient_bounds) {
    if (!byId.has(bound.ingredient_id)) blockers.push({ code: 'BOUNDED_INGREDIENT_UNAVAILABLE', ingredient_id: bound.ingredient_id, message: `Bounded ingredient ${bound.ingredient_id} is unavailable.` });
    if ((bound.min_percentage ?? 0) > (bound.max_percentage ?? Infinity)) blockers.push({ code: 'INVALID_INGREDIENT_BOUND', ingredient_id: bound.ingredient_id, message: 'Minimum percentage exceeds maximum percentage.' });
  }
  if (required.size > constraints.max_ingredients) blockers.push({ code: 'TOO_MANY_REQUIRED_INGREDIENTS', message: 'Required ingredient count exceeds the maximum ingredient count.' });
  const available = ingredients.filter(item => !forbidden.has(item.id));
  if (available.length < constraints.min_ingredients) blockers.push({ code: 'INSUFFICIENT_AVAILABLE_INGREDIENTS', message: `Only ${available.length} allowed ingredients are available.` });
  if (!available.some(item => item.category === 'base')) blockers.push({ code: 'NO_BALANCE_INGREDIENT', message: 'No allowed base ingredient is available to balance the formulation to 100%.' });
  const minimumTotal = constraints.ingredient_bounds.reduce((sum, item) => sum + Number(item.min_percentage || 0), 0);
  if (minimumTotal >= 100) blockers.push({ code: 'MINIMUM_PERCENTAGES_EXCEED_BATCH', message: `Ingredient minimums total ${round(minimumTotal)}%; room is required for a balance ingredient.` });
  if (constraints.minimum_juice_percent > 0 && !available.some(item => item.category === 'juice')) blockers.push({ code: 'NO_JUICE_INGREDIENT', message: 'A minimum juice content was requested but no allowed juice ingredient is available.' });
  return { feasible: blockers.length === 0, blocker_count: blockers.length, blockers, available_ingredient_count: available.length };
}

function calculateValues(composition, byId) {
  return composition.reduce((values, item) => {
    const ingredient = byId.get(item.ingredient_id);
    const ratio = item.percentage / 100;
    values.calories_per_100ml += ratio * Number(ingredient?.calories_per_100g || 0);
    values.sugar_per_100ml += ratio * Number(ingredient?.sugar_g || 0);
    values.cost_per_liter += ratio * Number(ingredient?.base_price_per_kg || 0);
    if (ingredient?.category === 'juice') values.juice_percent += item.percentage;
    if (ingredient?.category === 'preservative') values.preservative_percent += item.percentage;
    if (ingredient?.subcategory === 'caffeine') values.caffeine_percent += item.percentage;
    return values;
  }, { calories_per_100ml: 0, sugar_per_100ml: 0, cost_per_liter: 0, juice_percent: 0, preservative_percent: 0, caffeine_percent: 0 });
}

function constraintResult(key, label, actual, limit, comparator, unit, basis) {
  const evaluable = actual !== null && actual !== undefined;
  const passed = evaluable && (comparator === 'max' ? actual <= limit + 1e-6 : comparator === 'min' ? actual + 1e-6 >= limit : Math.abs(actual - limit) < 0.001);
  const margin = evaluable ? (comparator === 'max' ? limit - actual : comparator === 'min' ? actual - limit : -Math.abs(actual - limit)) : null;
  return { key, label, hard: true, status: evaluable ? (passed ? 'pass' : 'fail') : 'not_evaluable', actual: evaluable ? round(actual) : null, limit, comparator, margin: margin === null ? null : round(margin), unit, basis };
}

function evaluateConstraints(composition, values, constraints, byId) {
  const ids = new Set(composition.map(item => item.ingredient_id));
  const results = [constraintResult('total_percentage', 'Total composition', composition.reduce((sum, item) => sum + item.percentage, 0), 100, 'equal', '%', 'Calculated from candidate composition'), constraintResult('minimum_ingredients', 'Minimum ingredient count', composition.length, constraints.min_ingredients, 'min', 'ingredients', 'Counted from candidate composition'), constraintResult('maximum_ingredients', 'Maximum ingredient count', composition.length, constraints.max_ingredients, 'max', 'ingredients', 'Counted from candidate composition')];
  for (const id of constraints.required_ingredient_ids) results.push(constraintResult(`required:${id}`, `Required: ${byId.get(id)?.name || id}`, ids.has(id) ? 1 : 0, 1, 'equal', 'presence', 'Exact ingredient identifier'));
  for (const id of constraints.forbidden_ingredient_ids) results.push(constraintResult(`forbidden:${id}`, `Forbidden: ${byId.get(id)?.name || id}`, ids.has(id) ? 1 : 0, 0, 'equal', 'presence', 'Exact ingredient identifier'));
  for (const item of composition) {
    const ingredient = byId.get(item.ingredient_id);
    const bound = constraints.ingredient_bounds.find(entry => entry.ingredient_id === item.ingredient_id);
    results.push(constraintResult(`ingredient_nonnegative:${item.ingredient_id}`, `${ingredient.name} non-negative content`, item.percentage, 0, 'min', '%', 'Physical composition requirement'));
    const maximum = Math.min(Number(ingredient?.max_percentage ?? Infinity), Number(bound?.max_percentage ?? Infinity));
    if (Number.isFinite(maximum)) results.push(constraintResult(`ingredient_max:${item.ingredient_id}`, `${ingredient.name} maximum`, item.percentage, maximum, 'max', '%', bound?.max_percentage !== undefined ? 'User-defined bound and catalog limit' : 'Ingredient catalog limit'));
    if (bound?.min_percentage !== undefined) results.push(constraintResult(`ingredient_min:${item.ingredient_id}`, `${ingredient.name} minimum`, item.percentage, bound.min_percentage, 'min', '%', 'User-defined bound'));
  }
  for (const bound of constraints.ingredient_bounds) {
    if (bound.min_percentage !== undefined && !ids.has(bound.ingredient_id)) results.push(constraintResult(`ingredient_min:${bound.ingredient_id}`, `${byId.get(bound.ingredient_id)?.name || bound.ingredient_id} minimum`, 0, bound.min_percentage, 'min', '%', 'User-defined bound'));
  }
  const maximums = [
    ['max_sugar', 'Maximum sugar', values.sugar_per_100ml, constraints.max_sugar_g_per_100ml, 'g/100 ml'],
    ['max_calories', 'Maximum calories', values.calories_per_100ml, constraints.max_calories_per_100ml, 'kcal/100 ml'],
    ['max_cost', 'Maximum ingredient cost', values.cost_per_liter, constraints.max_cost_per_liter, 'DZD/L'],
    ['max_preservative', 'Maximum preservative content', values.preservative_percent, constraints.maximum_preservative_percent, '%'],
    ['max_caffeine', 'Maximum caffeine ingredient content', values.caffeine_percent, constraints.maximum_caffeine_percent, '%'],
  ];
  for (const [key, label, actual, limit, unit] of maximums) if (limit !== undefined) results.push(constraintResult(key, label, actual, limit, 'max', unit, 'Calculated from catalog composition data'));
  if (constraints.minimum_juice_percent !== undefined) results.push(constraintResult('min_juice', 'Minimum juice content', values.juice_percent, constraints.minimum_juice_percent, 'min', '%', 'Sum of catalog ingredients in the juice category'));
  if (constraints.target_ph_min !== undefined) results.push(constraintResult('ph_min', 'Minimum finished-product pH', null, constraints.target_ph_min, 'min', 'pH', 'Not calculable from ingredient pH ranges; laboratory measurement required'));
  if (constraints.target_ph_max !== undefined) results.push(constraintResult('ph_max', 'Maximum finished-product pH', null, constraints.target_ph_max, 'max', 'pH', 'Not calculable from ingredient pH ranges; laboratory measurement required'));
  if (constraints.maximum_sodium_mg_per_100ml !== undefined) results.push(constraintResult('max_sodium', 'Maximum sodium', null, constraints.maximum_sodium_mg_per_100ml, 'max', 'mg/100 ml', 'Catalog lacks validated sodium composition for all ingredients'));
  return results;
}

function referenceDeviation(composition, referenceIngredients = []) {
  if (!referenceIngredients.length) return null;
  const current = new Map(composition.map(item => [item.ingredient_id, item.percentage]));
  const reference = new Map(referenceIngredients.map(item => [item.ingredient_id, Number(item.percentage)]));
  const ids = new Set([...current.keys(), ...reference.keys()]);
  return round([...ids].reduce((sum, id) => sum + Math.abs((current.get(id) || 0) - (reference.get(id) || 0)), 0) / 2);
}

function dominates(a, b, objectives) {
  const metrics = { cost: 'cost_per_liter', sugar: 'sugar_per_100ml', calories: 'calories_per_100ml', ingredient_count: 'ingredient_count', reference_deviation: 'reference_deviation' };
  const usable = objectives.map(key => metrics[key]).filter(key => key && a.objective_values[key] !== null && b.objective_values[key] !== null);
  return usable.length > 0 && usable.every(key => a.objective_values[key] <= b.objective_values[key] + 1e-9) && usable.some(key => a.objective_values[key] < b.objective_values[key] - 1e-9);
}

export function generateFormulationCandidates(rawConstraints, ingredients, referenceIngredients = []) {
  const constraints = {
    required_ingredient_ids: [], forbidden_ingredient_ids: [], ingredient_bounds: [], objectives: ['cost', 'sugar', 'calories'],
    count: 3, min_ingredients: 5, max_ingredients: 10, ...rawConstraints,
  };
  const signature = inputSignature({ constraints, ingredient_catalog: ingredients.map(item => ({ id: item.id, updated_at: item.updated_at, price: item.base_price_per_kg, sugar: item.sugar_g, calories: item.calories_per_100g, maximum: item.max_percentage })), referenceIngredients });
  const preflight = preflightFormulationGeneration(constraints, ingredients);
  if (!preflight.feasible) return { feasibility: preflight, candidates: [], reproducibility: { deterministic: true, engine_version: FORMULATION_ENGINE_VERSION, input_signature: signature } };
  const byId = new Map(ingredients.map(item => [item.id, item]));
  const forbidden = new Set(constraints.forbidden_ingredient_ids);
  const allowed = ingredients.filter(item => !forbidden.has(item.id));
  const strategies = ['cost', 'sugar', 'calories', 'ingredient_count', 'reference_deviation'];
  const candidates = [];
  for (let index = 0; index < constraints.count; index += 1) {
    const strategy = constraints.objectives[index % constraints.objectives.length] || strategies[index % strategies.length];
    const selected = new Map();
    const add = ingredient => { if (ingredient && !selected.has(ingredient.id)) selected.set(ingredient.id, ingredient); };
    [...constraints.required_ingredient_ids, ...constraints.ingredient_bounds.filter(item => (item.min_percentage ?? 0) > 0).map(item => item.ingredient_id)].map(id => byId.get(id)).forEach(add);
    const base = allowed.filter(item => item.category === 'base').sort((a, b) => compareIngredients(a, b, strategy))[index % allowed.filter(item => item.category === 'base').length];
    add(base);
    if (constraints.minimum_juice_percent > 0) add(allowed.filter(item => item.category === 'juice').sort((a, b) => compareIngredients(a, b, strategy))[index % allowed.filter(item => item.category === 'juice').length]);
    for (const category of ['sweetener', 'acidulant', 'flavor', 'preservative']) {
      if (selected.size >= constraints.max_ingredients) break;
      const pool = allowed.filter(item => item.category === category).sort((a, b) => compareIngredients(a, b, strategy));
      add(pool[index % Math.max(pool.length, 1)]);
    }
    const filler = allowed.filter(item => item.category !== 'base').sort((a, b) => compareIngredients(a, b, strategy));
    for (const ingredient of filler) { if (selected.size >= Math.min(constraints.max_ingredients, constraints.min_ingredients + index)) break; add(ingredient); }
    const strategyFactor = Math.max(0.55, 1 - index * 0.1);
    const composition = [...selected.values()].map(ingredient => ({ ingredient_id: ingredient.id, ingredient_name: ingredient.name, category: ingredient.category, percentage: ingredient.category === 'base' ? 0 : defaultDose(ingredient, constraints, strategyFactor) }));
    const bases = composition.filter(item => item.category === 'base');
    const balance = bases[0];
    const nonBalanceTotal = composition.filter(item => item !== balance).reduce((sum, item) => sum + item.percentage, 0);
    balance.percentage = round(100 - nonBalanceTotal);
    const values = calculateValues(composition, byId);
    Object.keys(values).forEach(key => { values[key] = round(values[key]); });
    const constraintResults = evaluateConstraints(composition, values, constraints, byId);
    const deviation = referenceDeviation(composition, referenceIngredients);
    const failures = constraintResults.filter(item => item.status === 'fail');
    const gaps = constraintResults.filter(item => item.status === 'not_evaluable');
    candidates.push({
      id: `fic-${signature.slice(0, 10)}-${index + 1}`, strategy, ingredients: composition, calculated_values: values,
      constraint_results: constraintResults, feasible: failures.length === 0, hard_constraint_failures: failures.length,
      validation_gaps: gaps.map(item => item.label), validation_status: 'candidate_for_laboratory_validation',
      objective_values: { cost_per_liter: values.cost_per_liter, sugar_per_100ml: values.sugar_per_100ml, calories_per_100ml: values.calories_per_100ml, ingredient_count: composition.length, reference_deviation: deviation },
      reference_comparison: { available: deviation !== null, absolute_percentage_point_deviation: deviation },
      regulatory_screening: { status: failures.some(item => item.key.startsWith('ingredient_max:')) ? 'review_required' : 'locally_screened', note: 'Catalog limits are a screening aid, not a market authorization.' },
      trade_offs: [`Optimized primarily for ${strategy.replace('_', ' ')}; improvements may worsen other objectives.`, ...(gaps.length ? ['Laboratory measurements are required for non-evaluable constraints.'] : [])],
      assumptions: ['1 kg/L planning density used for ingredient-cost screening.', 'Catalog nutrition and prices are planning inputs and require supplier verification.'],
      beverage_type: constraints.beverage_type || 'soft_drink',
      scores: {
        calorie_match: constraints.target_calories === undefined ? 100 : round(constraints.target_calories === 0 ? (values.calories_per_100ml < 0.01 ? 100 : 0) : Math.max(0, 100 - Math.abs(values.calories_per_100ml - constraints.target_calories) / constraints.target_calories * 100)),
        sugar_match: constraints.target_sugar === undefined ? 100 : round(constraints.target_sugar === 0 ? (values.sugar_per_100ml < 0.01 ? 100 : 0) : Math.max(0, 100 - Math.abs(values.sugar_per_100ml - constraints.target_sugar) / constraints.target_sugar * 100)),
        cost_match: constraints.target_cost_per_liter === undefined ? 100 : round(constraints.target_cost_per_liter === 0 ? (values.cost_per_liter < 0.01 ? 100 : 0) : Math.max(0, 100 - Math.abs(values.cost_per_liter - constraints.target_cost_per_liter) / constraints.target_cost_per_liter * 100)),
        compatibility: failures.length ? 0 : 100,
        basis: 'deterministic hard-constraint screening; laboratory validation required',
      },
    });
  }
  const feasibleCandidates = candidates.filter(item => item.feasible);
  for (const candidate of candidates) candidate.pareto_rank = candidate.feasible && !feasibleCandidates.some(other => other.id !== candidate.id && dominates(other, candidate, constraints.objectives)) ? 1 : (candidate.feasible ? 2 : null);
  candidates.sort((a, b) => Number(b.feasible) - Number(a.feasible) || (a.pareto_rank ?? 99) - (b.pareto_rank ?? 99) || a.id.localeCompare(b.id));
  return {
    feasibility: { ...preflight, feasible_candidate_count: feasibleCandidates.length, generated_candidate_count: candidates.length }, candidates,
    reproducibility: { deterministic: true, engine_version: FORMULATION_ENGINE_VERSION, input_signature: signature },
  };
}
