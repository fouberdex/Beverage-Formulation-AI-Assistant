import { mockFormulations, mockIngredients, mockComplianceRecords } from '../data/mockData.js';

/**
 * Regulatory & Labeling Service
 * Handles Algerian compliance, Halal validation, and label generation
 */

let complianceRecords = [...(mockComplianceRecords || [])];

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
      name_ar: ingredient?.name_ar || '',
      name_fr: ingredient?.name_fr || '',
      category: ingredient?.category || '',
      halal: ingredient?.halal !== false,
      kosher: ingredient?.kosher !== false,
      vegan: ingredient?.vegan !== false,
      max_percentage: ingredient?.max_percentage || 100,
      regulatory_status: ingredient?.regulatory_status || 'approved',
      sugar_g: ingredient?.sugar_per_100g || 0,
    };
  });

  return {
    ...formulation,
    ingredients: enrichedIngredients,
  };
}

/**
 * Check regulatory compliance for a formulation
 */
export async function checkRegulatoryCompliance(formulationId) {
  const formulation = getFormulationById(formulationId);
  if (!formulation) {
    throw new Error('Formulation not found');
  }

  const ingredients = formulation.ingredients || [];
  const compliance = {
    is_halal_compliant: true,
    is_kosher_compliant: true,
    is_vegan_compliant: true,
    algerian_regulatory_compliant: true,
    violations: [],
    certification_required: [],
    compliance_notes: '',
  };

  // Check each ingredient
  for (const ing of ingredients) {
    // Halal check
    if (!ing.halal) {
      compliance.is_halal_compliant = false;
      compliance.violations.push({
        type: 'halal',
        ingredient: ing.ingredient_name,
        message: 'Ingredient is not Halal certified',
      });
    }

    // Kosher check
    if (!ing.kosher) {
      compliance.is_kosher_compliant = false;
      compliance.violations.push({
        type: 'kosher',
        ingredient: ing.ingredient_name,
        message: 'Ingredient is not Kosher certified',
      });
    }

    // Vegan check
    if (!ing.vegan) {
      compliance.is_vegan_compliant = false;
      compliance.violations.push({
        type: 'vegan',
        ingredient: ing.ingredient_name,
        message: 'Ingredient is not vegan',
      });
    }

    // Algerian regulatory check
    if (ing.regulatory_status === 'restricted') {
      compliance.algerian_regulatory_compliant = false;
      compliance.violations.push({
        type: 'regulatory',
        ingredient: ing.ingredient_name,
        message: 'Ingredient is restricted in Algeria',
      });
    }

    // Max percentage check
    if (ing.max_percentage && ing.percentage > ing.max_percentage) {
      compliance.algerian_regulatory_compliant = false;
      compliance.violations.push({
        type: 'regulatory',
        ingredient: ing.ingredient_name,
        message: `Ingredient exceeds maximum allowed percentage (${ing.max_percentage}%)`,
      });
    }
  }

  // Algerian-specific compliance rules
  const algerianCompliance = checkAlgerianSpecificRules(formulation, ingredients);
  if (!algerianCompliance.compliant) {
    compliance.algerian_regulatory_compliant = false;
    compliance.violations.push(...algerianCompliance.violations);
  }

  // Set compliance notes
  if (compliance.violations.length === 0) {
    compliance.compliance_notes = 'All compliance checks passed. Product is ready for Algerian market.';
  } else {
    compliance.compliance_notes = `${compliance.violations.length} violation(s) detected. Review before market launch.`;
  }

  // Store compliance record
  const record = {
    id: `comp-${Date.now()}`,
    formulation_id: formulationId,
    ...compliance,
    checked_at: new Date().toISOString(),
  };
  complianceRecords.push(record);

  return record;
}

/**
 * Check Algerian-specific regulatory rules
 */
function checkAlgerianSpecificRules(formulation, ingredients) {
  const violations = [];
  let compliant = true;

  // Rule 1: Total percentage must be 100%
  const totalPercentage = ingredients.reduce((sum, ing) => sum + ing.percentage, 0);
  if (Math.abs(totalPercentage - 100) > 0.01) {
    violations.push({
      type: 'formulation',
      message: `Total percentage is ${totalPercentage.toFixed(2)}%, must be 100%`,
    });
    compliant = false;
  }

  // Rule 2: Certain categories have maximum limits
  const categoryLimits = {
    preservative: 0.5,
    colorant: 0.1,
    sweetener: 10,
    acidulant: 1,
  };

  const categoryTotals = {};
  for (const ing of ingredients) {
    const category = ing.category?.toLowerCase();
    if (categoryLimits[category]) {
      categoryTotals[category] = (categoryTotals[category] || 0) + ing.percentage;
    }
  }

  for (const [category, limit] of Object.entries(categoryLimits)) {
    if (categoryTotals[category] && categoryTotals[category] > limit) {
      violations.push({
        type: 'regulatory',
        message: `${category} category exceeds maximum limit of ${limit}%`,
      });
      compliant = false;
    }
  }

  // Rule 3: Sugar content labeling requirements
  const totalSugar = ingredients.reduce((sum, ing) => 
    sum + (ing.percentage / 100) * (ing.sugar_g || 0), 0
  );

  if (totalSugar > 11) {
    violations.push({
      type: 'labeling',
      severity: 'warning',
      message: 'High sugar content - special labeling may be required',
    });
  }

  return { compliant, violations };
}

/**
 * Generate labels in AR/FR/EN
 */
export async function generateLabels(formulationId) {
  const formulation = getFormulationById(formulationId);
  if (!formulation) {
    throw new Error('Formulation not found');
  }

  const ingredients = formulation.ingredients || [];

  // Calculate nutrition
  let totalCalories = 0;
  let totalSugar = 0;
  for (const ing of ingredients) {
    const ingredient = mockIngredients.find(i => i.id === ing.ingredient_id);
    if (ingredient) {
      totalCalories += (ing.percentage / 100) * (ingredient.calories_per_100g || 0);
      totalSugar += (ing.percentage / 100) * (ingredient.sugar_per_100g || 0);
    }
  }

  const nutrition = {
    calories: totalCalories.toFixed(1),
    sugar: totalSugar.toFixed(1),
  };

  // Generate labels
  const labelAr = generateArabicLabel(formulation, ingredients, nutrition);
  const labelFr = generateFrenchLabel(formulation, ingredients, nutrition);
  const labelEn = generateEnglishLabel(formulation, ingredients, nutrition);

  return {
    ar: labelAr,
    fr: labelFr,
    en: labelEn,
  };
}

/**
 * Generate Arabic label
 */
function generateArabicLabel(formulation, ingredients, nutrition) {
  return {
    name: formulation.name,
    name_display: formulation.name,
    ingredients: ingredients.map(ing => ({
      name: ing.name_ar || ing.ingredient_name,
      percentage: ing.percentage,
    })).sort((a, b) => b.percentage - a.percentage),
    nutrition: {
      calories: nutrition.calories,
      sugar: nutrition.sugar,
    },
    halal: true,
    net_content: '1 لتر',
    manufacturer: 'BeverageAI DZ',
    country_of_origin: 'الجزائر',
  };
}

/**
 * Generate French label
 */
function generateFrenchLabel(formulation, ingredients, nutrition) {
  return {
    name: formulation.name,
    name_display: formulation.name,
    ingredients: ingredients.map(ing => ({
      name: ing.name_fr || ing.ingredient_name,
      percentage: ing.percentage,
    })).sort((a, b) => b.percentage - a.percentage),
    nutrition: {
      calories: nutrition.calories,
      sugar: nutrition.sugar,
    },
    halal: true,
    net_content: '1 Litre',
    manufacturer: 'BeverageAI DZ',
    country_of_origin: 'Algérie',
  };
}

/**
 * Generate English label
 */
function generateEnglishLabel(formulation, ingredients, nutrition) {
  return {
    name: formulation.name,
    name_display: formulation.name,
    ingredients: ingredients.map(ing => ({
      name: ing.ingredient_name,
      percentage: ing.percentage,
    })).sort((a, b) => b.percentage - a.percentage),
    nutrition: {
      calories: nutrition.calories,
      sugar: nutrition.sugar,
    },
    halal: true,
    net_content: '1 Liter',
    manufacturer: 'BeverageAI DZ',
    country_of_origin: 'Algeria',
  };
}

/**
 * Get compliance record for formulation
 */
export async function getComplianceRecord(formulationId) {
  const records = complianceRecords.filter(r => r.formulation_id === formulationId);
  return records.length > 0 ? records[records.length - 1] : null;
}
