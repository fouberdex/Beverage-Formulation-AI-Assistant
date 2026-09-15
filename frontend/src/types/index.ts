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
  project_id?: string | null;
  locked_at?: string | null;
  locked_by?: string | null;
  approval_note?: string;
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

export type ProjectStage = 'brief' | 'concept' | 'formulation' | 'laboratory' | 'sensory' | 'validation' | 'industrialization' | 'launched';
export type ProjectStatus = 'draft' | 'active' | 'on_hold' | 'completed' | 'archived';

export interface RDProjectEvent {
  id: string;
  project_id: string;
  event_type: 'created' | 'updated' | 'stage_transition' | string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface RDExperimentalPlan {
  id: string; project_id: string; formulation_version_id: string; name: string; objective: string; hypothesis: string;
  status: 'draft' | 'ready' | 'running' | 'completed' | 'cancelled'; planned_runs: number; due_date?: string | null;
  protocol: { method: string; variables: string[]; controls: string[]; procedure_steps: string[]; acceptance_criteria: string[] };
  design?: RDDesign;
  created_at: string; updated_at: string;
}

export interface RDDesign {
  engine_version: string; signature: string; design_type: 'full_factorial' | 'response_surface'; run_count: number; center_points: number; replicates: number;
  factors: Array<{ key: string; label: string; low: number; high: number; unit: string }>;
  responses: Array<{ key: string; label: string; goal: 'maximize' | 'minimize' | 'target'; target?: number | null; unit: string }>;
  runs: Array<{ id: string; standard_order: number; replicate: number; factor_settings: Record<string, { coded: number; value: number; unit: string }> }>;
}

export interface RDDesignAnalysis {
  engine_version: string; design_signature: string; observation_count: number; completed_run_count: number; remaining_run_count: number;
  models: Record<string, { status: string; observations: number; required?: number; coefficients?: Record<string, number>; diagnostics?: { r_squared: number; adjusted_r_squared: number | null; rmse: number; residual_degrees_of_freedom: number }; anova?: { f_statistic: number | null; p_value: number | null; note: string }; lack_of_fit?: { status: string; pure_error_degrees_of_freedom: number; lack_of_fit_degrees_of_freedom: number; f_statistic: number | 'Infinity' | null; p_value: number | null; conclusion: string }; surface?: null | { kind: 'curve' | 'surface'; x_factor: { key: string; label: string; unit: string }; y_factor: null | { key: string; label: string; unit: string }; points: Array<{ x: number; y: number | null; prediction: number }> } }>;
  next_run: null | { run_id: string; standard_order: number; factor_settings: Record<string, { coded: number; value: number; unit: string }>; predicted_primary_response: number | null; response_key: string; basis: string; warning: string };
  applicability: { inferential_claims_allowed: boolean; reason: string };
}

export interface RDPilotBatch {
  id: string; project_id: string; experimental_plan_id: string; formulation_version_id: string; batch_code: string; batch_size_liters: number;
  status: 'planned' | 'in_progress' | 'completed' | 'rejected'; scheduled_at?: string | null; produced_at?: string | null;
  actual_quantities: Array<{ material_name: string; ingredient_id?: string; quantity: number; unit: 'g' | 'kg' | 'ml' | 'l'; lot_code: string }>;
  doe_run_id?: string | null; factor_settings?: Record<string, { coded: number; value: number; unit: string }>; response_values?: Record<string, number>;
  procedure_notes: string; deviations: string[]; observations: string; conclusion: string; created_at: string; updated_at: string;
}

export interface RDProjectMilestone {
  id: string; project_id: string; title: string; description: string; stage: ProjectStage;
  status: 'planned' | 'in_progress' | 'completed' | 'blocked'; due_date?: string | null; responsible: string; success_criteria: string[];
  created_at: string; updated_at: string;
}

export interface RDProjectDecision {
  id: string; project_id: string; actor_id: string; title: string; outcome: 'go' | 'no_go' | 'hold' | 'rework'; rationale: string;
  evidence_refs: string[]; formulation_version_id?: string | null; milestone_id?: string | null; decided_at: string;
}

export interface RDProjectDevelopmentState {
  engine_version: string;
  calculated_at: string;
  project_id: string;
  target_formulation_version_id: string | null;
  current_stage: string;
  next_controlled_action: { key: string; label: string; detail: string };
  blockers: Array<{ code: string; message: string; entity_type: string; entity_id: string }>;
  evidence_chain: Record<string, string[]>;
  readiness: { status: 'blocked' | 'in_progress' | 'evidence_complete'; score_percent: number; passed_gates: number; total_gates: number; gates: Array<{ key: string; label: string; status: 'pass' | 'missing'; entity_ids: string[] }> };
  reformulation_required: { required: boolean; trigger: 'explicit_rework_decision'|'stability_failure'|'quality_issue'|'process_issue'|'pilot_rejection'|'packaging_issue'|null; recommended_path: 'formulation_review'|'stability_investigation'|'quality_investigation'|'process_review'|'pilot_investigation'|'packaging_review'|'continue_controlled_workflow'; reason: string; entity_ids: string[] };
  release_eligible: boolean;
}

export interface RDProject {
  id: string;
  code: string;
  name: string;
  business_objective: string;
  target_market: string;
  beverage_category: string;
  target_claims: string[];
  brief_status: 'draft' | 'validated';
  ingredient_constraints: { required: string[]; forbidden: string[]; notes: string };
  cost_objectives: { max_cost_per_liter?: number; currency: string };
  nutrition_objectives: { max_sugar_g_per_100ml?: number; max_calories_per_100ml?: number; target_ph_min?: number; target_ph_max?: number };
  regulatory_constraints: { markets: string[]; certifications: string[]; forbidden_additives: string[] };
  success_criteria: string[];
  priority: 'low' | 'normal' | 'high' | 'critical';
  due_date?: string | null;
  stage: ProjectStage;
  status: ProjectStatus;
  event_count?: number;
  execution_available?: boolean;
  stability_available?: boolean;
  supply_chain_available?: boolean;
  industrial_quality_available?: boolean;
  development_state?: RDProjectDevelopmentState;
  product_passport?: RDProductPassport;
  events?: RDProjectEvent[];
  traceability?: {
    formulations: Array<{ id: string; code: string; name: string; version: number; status: string; locked_at?: string | null }>;
    laboratory_results: Array<{ id: string; formulation_version_id: string; batch_code?: string; tested_at: string; measurements?: Record<string, number>; sensory?: Record<string, number> }>;
    sensory_studies: Array<{ id: string; name: string; status: string; formulation_version_ids: string[] }>;
    experimental_plans: RDExperimentalPlan[];
    pilot_batches: RDPilotBatch[];
    milestones: RDProjectMilestone[];
    decisions: RDProjectDecision[];
    stability_programs: RDStabilityProgram[];
    stability_observations: RDStabilityObservation[];
    product_specifications: RDProductSpecification[];
    specification_approvals: RDSpecificationApproval[];
    documents: RDDocument[];
    packaging_configurations: RDPackagingConfiguration[];
    production_trials: RDProductionTrial[];
    qc_releases: RDQcRelease[];
    quality_events: RDQualityEvent[];
    capa_actions: RDCapaAction[];
  };
  created_at: string;
  updated_at: string;
}

export interface RDStabilityLimit { key: string; label: string; source: 'measurements' | 'sensory'; unit: string; lower?: number; upper?: number; max_change_from_baseline?: number }
export interface RDStabilityProgram { id: string; project_id: string; formulation_version_id: string; name: string; status: 'draft' | 'running' | 'completed' | 'cancelled'; protocol: string; storage_conditions: Array<{ id: string; label: string; temperature_c: number; relative_humidity_percent?: number; light_exposure: 'dark' | 'ambient' | 'controlled_light' }>; timepoints_days: number[]; replicates_per_timepoint: number; parameters: RDStabilityLimit[]; created_at: string; updated_at: string }
export interface RDStabilityObservation { id: string; project_id: string; program_id: string; formulation_version_id: string; laboratory_result_id: string; condition_id: string; timepoint_days: number; replicate: number; values: Record<string, number>; laboratory_tested_at: string; recorded_at: string }
export interface RDProductSpecification { id: string; project_id: string; formulation_version_id: string; name: string; version: number; status: 'draft' | 'approved' | 'superseded' | 'withdrawn'; markets: string[]; effective_date?: string | null; notes: string; limits: RDStabilityLimit[]; approved_at?: string; created_at: string; updated_at: string }
export interface RDSpecificationApproval { id: string; project_id: string; specification_id: string; outcome: 'approved' | 'withdrawn'; rationale: string; evidence_refs: string[]; decided_at: string }
export interface RDStabilityAnalysis { engine_version: string; program_id: string; formulation_version_id: string; observation_count: number; overall_status: string; conclusion: string; extrapolation: { performed: false; reason: string }; conditions: Array<{ id: string; label: string; temperature_c: number; expected_observations: number; recorded_observations: number; completion_percent: number; status: string; parameters: Array<{ key: string; label: string; unit: string; baseline: number | null; first_observed_failure_day: number | null; status: string; trend: { status: string; slope_per_day: number | null; slope_per_30_days?: number | null; r_squared: number | null }; points: Array<{ day: number; value: number; status: string; absolute_change_from_baseline: number | null }> }> }>; specification: null | { id: string; version: number; status: string; limits: Array<{ key: string; label: string; evaluated_observations: number; failed_observations: number; status: string }> } }

export interface RDSupplier { id: string; name: string; status: 'prospect' | 'qualified' | 'conditionally_qualified' | 'suspended' | 'rejected'; country: string; contact_name: string; contact_email: string; phone: string; certifications: string[]; qualification_score: number; last_audit_date?: string | null; qualification_expiry_date?: string | null; notes: string; created_at: string; updated_at: string }
export interface RDSupplierMaterial { id: string; supplier_id: string; material_code: string; name: string; ingredient_id?: string | null; status: 'candidate' | 'approved' | 'restricted' | 'discontinued'; manufacturing_site: string; currency: string; price_per_kg: number; moq_kg: number; lead_time_days: number; allergens: string[]; certifications: string[]; notes: string; created_at: string; updated_at: string }
export interface RDMaterialSpecification { id: string; supplier_material_id: string; name: string; version: number; status: 'draft' | 'approved' | 'superseded' | 'withdrawn'; effective_date?: string | null; limits: Array<{ key: string; label: string; unit: string; lower?: number; upper?: number; method: string }>; notes: string; rationale?: string; evidence_refs?: string[]; approved_by?: string; approved_at?: string; created_at: string; updated_at: string }
export interface RDDocument { id: string; project_id: string; supplier_id?: string | null; supplier_material_id?: string | null; formulation_version_id?: string | null; document_type: string; title: string; file_name: string; mime_type: string; size_bytes: number; sha256: string; storage_reference: string; source: string; issued_date?: string | null; expires_date?: string | null; extraction_status: string; extracted_text: string; review_status: 'pending' | 'accepted' | 'rejected' | 'expired'; review_notes?: string; reviewed_at?: string; created_at: string; updated_at: string }
export interface RDPackagingComponent { id: string; supplier_id?: string | null; code: string; name: string; component_type: string; material: string; status: 'candidate' | 'approved' | 'restricted' | 'discontinued'; capacity_ml?: number | null; mass_g: number; recycled_content_percent: number; unit_cost: number; currency: string; barrier: { oxygen_transmission_rate_cc_m2_day?: number | null; water_vapor_transmission_rate_g_m2_day?: number | null; light_transmission_percent?: number | null }; food_contact_compliant: boolean; markets: string[]; notes: string; created_at: string; updated_at: string }
export interface RDPackagingAnalysis { engine_version: string; configuration_id: string; component_count: number; economics: { currency: string; cost_per_sale_unit: number }; sustainability: { total_packaging_mass_g: number; recycled_content_percent_by_mass: number }; barrier_screen: { maximum_oxygen_transmission_rate_cc_m2_day: number | null; maximum_water_vapor_transmission_rate_g_m2_day: number | null; maximum_light_transmission_percent: number | null; note: string }; stability_link: { intended_shelf_life_days: number; recorded_coverage_days: number; coverage_sufficient: boolean }; readiness: 'ready' | 'review_required'; warnings: string[] }
export interface RDPackagingConfiguration { id: string; project_id: string; formulation_version_id: string; name: string; version: number; status: 'draft' | 'approved' | 'superseded' | 'withdrawn'; currency: string; intended_shelf_life_days: number; filling_process: string; components: Array<{ component_id: string; role: 'primary_container' | 'closure' | 'label' | 'secondary' | 'tertiary' | 'other'; quantity: number }>; transport_conditions: string; notes: string; analysis: RDPackagingAnalysis; evidence_refs?: string[]; created_at: string; updated_at: string }
export interface RDProductionTrial { id:string;project_id:string;formulation_version_id:string;packaging_configuration_id?:string|null;batch_code:string;site:string;line:string;status:'planned'|'running'|'completed'|'cancelled';scheduled_at?:string|null;produced_at?:string|null;reference_batch_size_liters:number;planned_batch_size_liters:number;saleable_output_liters:number;rejected_output_liters:number;material_lots:Array<{supplier_material_id?:string|null;material_name:string;lot_code:string;quantity:number;unit:'g'|'kg'|'ml'|'l'}>;process_parameters:Array<{key:string;label:string;unit:string;lower?:number;upper?:number;actual:number}>;deviations:string[];notes:string;analysis:{engine_version:string;mass_balance:{yield_percent:number;reject_percent:number;unaccounted_loss_liters:number;scale_factor:number|null};process_parameters:Array<{key:string;label:string;status:string}>;status:string;warnings:string[]};created_at:string;updated_at:string }
export interface RDQcRelease { id:string;project_id:string;production_trial_id:string;formulation_version_id:string;specification_id:string;laboratory_result_ids:string[];disposition:'released'|'hold'|'rejected'|'out_of_specification';notes:string;evaluation:{engine_version:string;reason:string;checks:Array<{key:string;label:string;unit:string;observation_count:number;failure_count:number;status:string}>};decided_at:string }
export interface RDQualityEvent { id:string;project_id:string;production_trial_id?:string|null;qc_release_id?:string|null;event_type:'deviation'|'out_of_specification'|'nonconformance';severity:'minor'|'major'|'critical';title:string;description:string;immediate_action:string;owner:string;due_date?:string|null;status:'open'|'investigating'|'capa_required'|'closed';root_cause:string;investigation_notes:string;disposition:string;created_at:string;updated_at:string }
export interface RDCapaAction { id:string;project_id:string;quality_event_id:string;action_type:'corrective'|'preventive';title:string;action:string;owner:string;due_date?:string|null;status:'planned'|'in_progress'|'implemented'|'effectiveness_verified'|'ineffective'|'cancelled';effectiveness_criteria:string;effectiveness_evidence:string;verified_at?:string;created_at:string;updated_at:string }
export interface RDProductPassport { engine_version:string;project_id:string;formulation_version_id:string|null;formulation_version:number|null;generated_at:string;project:{id:string;code:string;name:string;stage:string;status:string;target_market:string;beverage_category:string};readiness:{score_percent:number;passed_gates:number;total_gates:number;status:'blocked'|'in_progress'|'evidence_complete';gates:Array<{key:string;label:string;status:'pass'|'fail'|'missing'|'blocked';entity_ids:string[];explanation:string}>};evidence_chain:Record<string,string[]>;graph:{nodes:Array<{id:string;entity_type:string;entity_id:string;label:string;status:string}>;edges:Array<{from:string;to:string;relation:string}>;node_count:number;edge_count:number};unresolved_blockers:Array<{code:string;message:string;entity_type:string;entity_id:string}>;summary:Record<string,number>;limitations:string[] }
export interface WorkspaceSearchResult { id:string;type:string;title:string;subtitle:string;reference:string;status:string;project_id?:string|null;updated_at?:string;route:string;score:number }

export interface LaboratoryResult {
  id: string;
  formulation_id: string;
  formulation_version_id?: string;
  project_id?: string | null;
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
  project_id?: string | null;
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








