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

export interface LaboratoryResult {
  id: string;
  formulation_id: string;
  batch_code?: string;
  tested_at: string;
  measurements: { ph?: number; brix?: number; titratable_acidity?: number; viscosity?: number; density?: number; turbidity?: number; stability_score?: number };
  sensory: { appearance?: number; aroma?: number; taste?: number; mouthfeel?: number; overall_acceptance?: number };
  notes?: string;
  include_in_ai_learning: boolean;
  created_at: string;
  updated_at?: string;
}

export interface SensoryAttributeAnalytics {
  key: string;
  label: string;
  count: number;
  missing: number;
  mean: number | null;
  median: number | null;
  standard_deviation: number | null;
  minimum: number | null;
  maximum: number | null;
  confidence_interval_95: { lower: number; upper: number } | null;
  distribution: Array<{ label: string; count: number }>;
  outliers: Array<{
    result_id: string;
    batch_code?: string | null;
    tested_at: string;
    value: number;
    reason: string;
  }>;
}

export interface SensoryAnalytics {
  methodology: {
    observation_unit: string;
    score_range: { minimum: number; maximum: number };
    confidence_interval: string;
    standard_deviation: string;
    outlier_rule: string;
    composite_score: string;
  };
  coverage: {
    result_count: number;
    observed_scores: number;
    expected_scores: number;
    completion_percent: number;
  };
  attributes: SensoryAttributeAnalytics[];
  ranked_batches: Array<{
    result_id: string;
    batch_code?: string | null;
    tested_at: string;
    composite_score: number;
    completed_attributes: number;
    total_attributes: number;
    scores: Record<string, number | null>;
  }>;
  trend: Array<{
    result_id: string;
    batch_code?: string | null;
    tested_at: string;
    composite_score: number;
    completed_attributes: number;
    total_attributes: number;
    scores: Record<string, number | null>;
  }>;
  warnings: Array<{ code: string; message: string }>;
}

export interface SensoryStudyAttribute {
  key: string;
  label: string;
  category: 'appearance' | 'aroma' | 'taste' | 'mouthfeel' | 'aftertaste' | 'overall' | 'custom';
}

export interface SensoryStudySample {
  id: string;
  formulation_id?: string;
  sample_code: string;
  blind_code: string;
  label: string;
  batch_code?: string;
}

export interface SensoryStudy {
  id: string;
  name: string;
  objective: string;
  test_type: 'hedonic' | 'descriptive' | 'preference' | 'jar' | 'combined';
  panel_type: 'trained' | 'expert' | 'consumer' | 'internal';
  planned_panelists: number;
  scale_min: number;
  scale_max: number;
  status: 'draft' | 'active' | 'completed' | 'archived';
  attributes: SensoryStudyAttribute[];
  samples: SensoryStudySample[];
  protocol: {
    randomize_order: boolean;
    serving_temperature_c?: number;
    serving_volume_ml?: number;
    palate_cleanser?: string;
    environment?: string;
    instructions?: string;
  };
  response_count?: number;
  created_at: string;
  updated_at: string;
}

export interface SensoryStudyAnalytics {
  generated_at: string;
  coverage: {
    response_count: number;
    evaluation_count: number;
    expected_evaluations: number;
    score_completion_percent: number;
    segment_count: number;
  };
  overall_attribute_key: string;
  samples: Array<{
    sample_id: string;
    sample_code: string;
    blind_code: string;
    label: string;
    response_count: number;
    overall: SensoryAttributeAnalytics;
    purchase_intent: SensoryAttributeAnalytics;
    preference_rank: SensoryAttributeAnalytics;
    attributes: SensoryAttributeAnalytics[];
  }>;
  ranking: SensoryStudyAnalytics['samples'];
  anova: Array<{
    attribute_key: string;
    attribute_label: string;
    result: null | {
      f_statistic: number | null;
      infinite_f: boolean;
      p_value: number | null;
      df_between: number;
      df_within: number;
      eta_squared: number;
      significant_at_0_05: boolean;
    };
  }>;
  correlations: Array<{ row: string; column: string; value: number | null; count: number }>;
  jar_penalty: Array<{ sample_id: string; dimension: string; direction: string; count: number; percent: number; mean_drop: number | null; actionable: boolean }>;
  segments: Array<{ segment: string; sample_id: string; count: number; mean: number | null }>;
  quality: { flags: Array<{ type: string; panelist_code: string; sample_id?: string; message: string }>; outliers: Array<Record<string, any>> };
  warnings: Array<{ code: string; message: string }>;
  methodology: Record<string, string>;
}








