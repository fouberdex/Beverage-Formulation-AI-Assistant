// Type definitions for BeverageAI DZ

export interface Ingredient {
  id: string;
  code: string;
  name: string;
  name_ar?: string;
  name_fr?: string;
  category: string;
  subcategory?: string;
  ph_min?: number;
  ph_max?: number;
  solubility_g_per_100ml?: number;
  density_g_per_ml?: number;
  taste_profile?: Record<string, number>;
  color?: string;
  halal_certified: boolean;
  kosher_certified: boolean;
  vegan: boolean;
  organic: boolean;
  regulatory_status: string;
  max_percentage?: number;
  base_price_per_kg: number;
  currency: string;
  calories_per_100g?: number;
  protein_g?: number;
  carbs_g?: number;
  sugar_g?: number;
  fat_g?: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Formulation {
  id: string;
  code: string;
  name: string;
  description?: string;
  beverage_type: string;
  version: number;
  parent_formulation_id?: string;
  is_latest_version: boolean;
  status: string;
  total_percentage: number;
  total_cost_per_liter: number;
  total_calories_per_100ml: number;
  total_sugar_per_100ml: number;
  created_at: string;
  updated_at: string;
  ingredients?: FormulationIngredient[];
}

export interface FormulationIngredient {
  id: string;
  ingredient_id: string;
  ingredient_code?: string;
  ingredient_name?: string;
  percentage: number;
  cost_contribution: number;
  display_order: number;
}

export interface CompatibilityScore {
  id: string;
  ingredient_a_id: string;
  ingredient_b_id: string;
  compatibility_score: number;
  chemical_risk: boolean;
  physical_risk: boolean;
  sensory_risk: boolean;
  regulatory_risk: boolean;
  risk_description?: string;
  risk_severity?: string;
}

export interface FormulationCompatibility {
  overall_score: number;
  risks: Array<{
    type: string;
    severity: string;
    description: string;
  }>;
  warnings: Array<{
    type: string;
    severity: string;
    description: string;
  }>;
  details: CompatibilityScore[];
  evaluation_time_ms: number;
}

export interface AIFormulationVariant {
  id: string;
  source_formulation_id: string;
  generation_type: string;
  variant_data: {
    ingredients: Array<{
      id: string;
      percentage: number;
      display_order: number;
    }>;
  };
  confidence_score: number;
  explanation: string;
  cost_difference_percent: number;
  calorie_difference_percent: number;
  sugar_difference_percent: number;
  status: string;
  created_at: string;
}

export interface RegulatoryCompliance {
  id: string;
  formulation_id: string;
  is_halal_compliant: boolean;
  is_kosher_compliant: boolean;
  is_vegan_compliant: boolean;
  algerian_regulatory_compliant: boolean;
  compliance_notes?: string;
  violations?: Array<{
    type: string;
    ingredient?: string;
    message: string;
  }>;
  label_data_ar?: any;
  label_data_fr?: any;
  label_data_en?: any;
}

export interface BatchCostCalculation {
  id: string;
  formulation_id: string;
  batch_size_liters: number;
  total_cost: number;
  ingredient_cost: number;
  overhead_cost: number;
  margin_amount: number;
  final_price: number;
  estimated_revenue: number;
  estimated_profit: number;
  roi_percent: number;
  calculated_at: string;
}

export interface TargetGenerationConstraints {
  target_calories?: number;
  target_sugar?: number;
  target_cost_per_liter?: number;
  beverage_type?: string;
  max_ingredients?: number;
  min_ingredients?: number;
  count?: number;
}


