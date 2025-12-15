-- BeverageAI DZ - PostgreSQL Schema
-- Optimized for industrial scale: 1,200+ ingredients, 100,000+ formulations
-- Created for enterprise R&D and IT evaluation

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For text search optimization

-- ============================================================================
-- INGREDIENT INTELLIGENCE SYSTEM
-- ============================================================================

-- Ingredients table: Supports 1,200+ ingredients
CREATE TABLE ingredients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255),
    name_fr VARCHAR(255),
    category VARCHAR(100) NOT NULL, -- e.g., 'sweetener', 'flavor', 'preservative'
    subcategory VARCHAR(100),
    
    -- Chemical attributes
    ph_min DECIMAL(5,2),
    ph_max DECIMAL(5,2),
    solubility_g_per_100ml DECIMAL(10,3),
    density_g_per_ml DECIMAL(10,4),
    molecular_weight DECIMAL(10,2),
    cas_number VARCHAR(50),
    einECS_number VARCHAR(50),
    
    -- Sensory attributes
    taste_profile JSONB, -- {sweet: 0-10, bitter: 0-10, sour: 0-10, etc}
    color VARCHAR(50),
    aroma_profile JSONB,
    
    -- Regulatory attributes
    halal_certified BOOLEAN DEFAULT false,
    kosher_certified BOOLEAN DEFAULT false,
    vegan BOOLEAN DEFAULT false,
    organic BOOLEAN DEFAULT false,
    regulatory_status VARCHAR(50), -- 'approved', 'pending', 'restricted'
    max_percentage DECIMAL(5,2), -- Maximum allowed percentage
    restrictions JSONB, -- Array of restrictions
    
    -- Pricing & sourcing
    base_price_per_kg DECIMAL(12,4) NOT NULL DEFAULT 0,
    currency VARCHAR(3) DEFAULT 'DZD',
    supplier_id UUID,
    lead_time_days INTEGER,
    min_order_quantity_kg DECIMAL(10,2),
    availability_status VARCHAR(50) DEFAULT 'available', -- 'available', 'limited', 'unavailable'
    
    -- Nutritional (per 100g)
    calories_per_100g DECIMAL(10,2),
    protein_g DECIMAL(10,3),
    carbs_g DECIMAL(10,3),
    sugar_g DECIMAL(10,3),
    fat_g DECIMAL(10,3),
    fiber_g DECIMAL(10,3),
    sodium_mg DECIMAL(10,3),
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    is_active BOOLEAN DEFAULT true,
    
    -- Full-text search vector (for advanced search)
    search_vector tsvector GENERATED ALWAYS AS (
        to_tsvector('english', coalesce(name, '') || ' ' || coalesce(name_ar, '') || ' ' || coalesce(name_fr, '') || ' ' || coalesce(code, ''))
    ) STORED
);

-- Indexes for ingredients (critical for 1,200+ ingredients)
CREATE INDEX idx_ingredients_code ON ingredients(code);
CREATE INDEX idx_ingredients_category ON ingredients(category);
CREATE INDEX idx_ingredients_active ON ingredients(is_active) WHERE is_active = true;
CREATE INDEX idx_ingredients_regulatory ON ingredients(regulatory_status);
CREATE INDEX idx_ingredients_search_vector ON ingredients USING GIN(search_vector);
CREATE INDEX idx_ingredients_name_trgm ON ingredients USING GIN(name gin_trgm_ops);
CREATE INDEX idx_ingredients_supplier ON ingredients(supplier_id) WHERE supplier_id IS NOT NULL;

-- ============================================================================
-- COMPATIBILITY MATRIX (1.4M+ pairs)
-- ============================================================================

-- Compatibility table: Stores pre-computed compatibility scores
-- For 1,200 ingredients: 1,200 * 1,199 / 2 = 719,400 pairs (symmetric)
-- With versioning and additional factors: supports 1.4M+ entries
CREATE TABLE ingredient_compatibility (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ingredient_a_id UUID NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
    ingredient_b_id UUID NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
    
    -- Compatibility score (0-100)
    compatibility_score INTEGER NOT NULL CHECK (compatibility_score >= 0 AND compatibility_score <= 100),
    
    -- Risk flags
    chemical_risk BOOLEAN DEFAULT false,
    physical_risk BOOLEAN DEFAULT false, -- e.g., precipitation, phase separation
    sensory_risk BOOLEAN DEFAULT false, -- e.g., off-flavors, color changes
    regulatory_risk BOOLEAN DEFAULT false,
    
    -- Risk details
    risk_description TEXT,
    risk_severity VARCHAR(20), -- 'low', 'medium', 'high', 'critical'
    
    -- Compatibility factors
    ph_compatibility BOOLEAN,
    solubility_compatibility BOOLEAN,
    stability_notes TEXT,
    
    -- Metadata
    calculated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    calculation_version INTEGER DEFAULT 1,
    
    -- Ensure unique pairs (symmetric)
    CONSTRAINT unique_ingredient_pair UNIQUE (
        LEAST(ingredient_a_id, ingredient_b_id),
        GREATEST(ingredient_a_id, ingredient_b_id)
    )
);

-- Critical indexes for compatibility lookups (must be fast for 1.4M+ rows)
CREATE INDEX idx_compat_ingredient_a ON ingredient_compatibility(ingredient_a_id);
CREATE INDEX idx_compat_ingredient_b ON ingredient_compatibility(ingredient_b_id);
CREATE INDEX idx_compat_score ON ingredient_compatibility(compatibility_score);
CREATE INDEX idx_compat_risks ON ingredient_compatibility(chemical_risk, physical_risk, sensory_risk, regulatory_risk);
CREATE INDEX idx_compat_pair_lookup ON ingredient_compatibility(
    LEAST(ingredient_a_id, ingredient_b_id),
    GREATEST(ingredient_a_id, ingredient_b_id)
);

-- ============================================================================
-- FORMULATION MANAGEMENT (100,000+ formulations)
-- ============================================================================

-- Formulations table
CREATE TABLE formulations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    beverage_type VARCHAR(100) NOT NULL, -- 'soft_drink', 'juice', 'energy_drink', etc.
    
    -- Versioning
    version INTEGER NOT NULL DEFAULT 1,
    parent_formulation_id UUID REFERENCES formulations(id) ON DELETE SET NULL,
    is_latest_version BOOLEAN DEFAULT true,
    
    -- Status
    status VARCHAR(50) DEFAULT 'draft', -- 'draft', 'active', 'archived', 'rejected'
    
    -- Calculated totals (denormalized for performance)
    total_percentage DECIMAL(6,2) NOT NULL DEFAULT 0 CHECK (total_percentage >= 0 AND total_percentage <= 100),
    total_cost_per_liter DECIMAL(12,4) DEFAULT 0,
    total_calories_per_100ml DECIMAL(10,2) DEFAULT 0,
    total_sugar_per_100ml DECIMAL(10,3) DEFAULT 0,
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_by UUID,
    tenant_id UUID, -- For multi-tenant support
    
    -- Constraints
    CONSTRAINT valid_percentage CHECK (total_percentage >= 0 AND total_percentage <= 100)
);

-- Indexes for formulations
CREATE INDEX idx_formulations_code ON formulations(code);
CREATE INDEX idx_formulations_beverage_type ON formulations(beverage_type);
CREATE INDEX idx_formulations_status ON formulations(status);
CREATE INDEX idx_formulations_parent ON formulations(parent_formulation_id) WHERE parent_formulation_id IS NOT NULL;
CREATE INDEX idx_formulations_latest ON formulations(is_latest_version) WHERE is_latest_version = true;
CREATE INDEX idx_formulations_tenant ON formulations(tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX idx_formulations_created_at ON formulations(created_at DESC);

-- Formulation ingredients (junction table)
-- Supports 5-40 ingredients per formulation with 0.01% precision
CREATE TABLE formulation_ingredients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    formulation_id UUID NOT NULL REFERENCES formulations(id) ON DELETE CASCADE,
    ingredient_id UUID NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
    
    -- Percentage with 0.01% precision
    percentage DECIMAL(6,2) NOT NULL CHECK (percentage >= 0 AND percentage <= 100),
    
    -- Cost contribution (denormalized for performance)
    cost_contribution DECIMAL(12,4) DEFAULT 0,
    
    -- Order in formulation
    display_order INTEGER NOT NULL DEFAULT 0,
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Ensure unique ingredient per formulation
    CONSTRAINT unique_formulation_ingredient UNIQUE (formulation_id, ingredient_id)
);

-- Indexes for formulation ingredients
CREATE INDEX idx_formulation_ingredients_formulation ON formulation_ingredients(formulation_id);
CREATE INDEX idx_formulation_ingredients_ingredient ON formulation_ingredients(ingredient_id);
CREATE INDEX idx_formulation_ingredients_percentage ON formulation_ingredients(percentage);

-- ============================================================================
-- AI RECOMMENDATION ENGINE
-- ============================================================================

-- AI-generated formulation variants
CREATE TABLE ai_formulation_variants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_formulation_id UUID REFERENCES formulations(id) ON DELETE CASCADE,
    
    -- AI generation metadata
    generation_type VARCHAR(50) NOT NULL, -- 'optimization', 'alternative', 'constraint_based'
    prompt_text TEXT,
    model_version VARCHAR(50),
    
    -- Variant formulation (stored as JSON for flexibility)
    variant_data JSONB NOT NULL, -- {ingredients: [{id, percentage}], ...}
    
    -- AI confidence and explanation
    confidence_score DECIMAL(5,2) CHECK (confidence_score >= 0 AND confidence_score <= 100),
    explanation TEXT,
    
    -- Comparison metrics
    cost_difference_percent DECIMAL(8,2),
    calorie_difference_percent DECIMAL(8,2),
    sugar_difference_percent DECIMAL(8,2),
    
    -- Status
    status VARCHAR(50) DEFAULT 'generated', -- 'generated', 'reviewed', 'accepted', 'rejected'
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    reviewed_by UUID
);

-- Indexes for AI variants
CREATE INDEX idx_ai_variants_source ON ai_formulation_variants(source_formulation_id);
CREATE INDEX idx_ai_variants_type ON ai_formulation_variants(generation_type);
CREATE INDEX idx_ai_variants_confidence ON ai_formulation_variants(confidence_score DESC);
CREATE INDEX idx_ai_variants_status ON ai_formulation_variants(status);
CREATE INDEX idx_ai_variants_created ON ai_formulation_variants(created_at DESC);

-- ============================================================================
-- REGULATORY & LABELING
-- ============================================================================

-- Regulatory compliance records
CREATE TABLE regulatory_compliance (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    formulation_id UUID NOT NULL REFERENCES formulations(id) ON DELETE CASCADE,
    
    -- Compliance checks
    is_halal_compliant BOOLEAN DEFAULT false,
    is_kosher_compliant BOOLEAN DEFAULT false,
    is_vegan_compliant BOOLEAN DEFAULT false,
    algerian_regulatory_compliant BOOLEAN DEFAULT false,
    
    -- Compliance details
    compliance_notes TEXT,
    violations JSONB, -- Array of violation objects
    certification_required JSONB, -- Array of required certifications
    
    -- Labeling
    label_data_ar JSONB, -- Arabic label data
    label_data_fr JSONB, -- French label data
    label_data_en JSONB, -- English label data
    
    -- Metadata
    checked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    checked_by UUID,
    compliance_version INTEGER DEFAULT 1
);

-- Indexes for regulatory compliance
CREATE INDEX idx_regulatory_formulation ON regulatory_compliance(formulation_id);
CREATE INDEX idx_regulatory_halal ON regulatory_compliance(is_halal_compliant);
CREATE INDEX idx_regulatory_algerian ON regulatory_compliance(algerian_regulatory_compliant);

-- ============================================================================
-- COST & ROI MODULE
-- ============================================================================

-- Pricing history (36 months support)
CREATE TABLE ingredient_pricing_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ingredient_id UUID NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
    
    price_per_kg DECIMAL(12,4) NOT NULL,
    currency VARCHAR(3) DEFAULT 'DZD',
    
    -- Pricing metadata
    effective_date DATE NOT NULL,
    supplier_id UUID,
    volume_tier VARCHAR(50), -- 'retail', 'bulk_1k', 'bulk_10k', etc.
    
    -- Metadata
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    source VARCHAR(100) -- 'manual', 'api', 'import'
);

-- Indexes for pricing history
CREATE INDEX idx_pricing_ingredient ON ingredient_pricing_history(ingredient_id);
CREATE INDEX idx_pricing_date ON ingredient_pricing_history(effective_date DESC);
CREATE INDEX idx_pricing_ingredient_date ON ingredient_pricing_history(ingredient_id, effective_date DESC);

-- Batch costing calculations
CREATE TABLE batch_cost_calculations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    formulation_id UUID NOT NULL REFERENCES formulations(id) ON DELETE CASCADE,
    
    -- Batch parameters
    batch_size_liters DECIMAL(10,2) NOT NULL, -- 1L to 10,000L
    volume_tier VARCHAR(50),
    
    -- Cost breakdown
    total_cost DECIMAL(15,4) NOT NULL,
    ingredient_cost DECIMAL(15,4) NOT NULL,
    overhead_percent DECIMAL(5,2) DEFAULT 0,
    overhead_cost DECIMAL(15,4) DEFAULT 0,
    margin_percent DECIMAL(5,2) DEFAULT 0,
    margin_amount DECIMAL(15,4) DEFAULT 0,
    final_price DECIMAL(15,4),
    
    -- ROI estimates
    estimated_revenue DECIMAL(15,4),
    estimated_profit DECIMAL(15,4),
    roi_percent DECIMAL(8,2),
    
    -- Metadata
    calculated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    calculated_by UUID,
    pricing_snapshot_date DATE
);

-- Indexes for batch costing
CREATE INDEX idx_batch_cost_formulation ON batch_cost_calculations(formulation_id);
CREATE INDEX idx_batch_cost_size ON batch_cost_calculations(batch_size_liters);
CREATE INDEX idx_batch_cost_date ON batch_cost_calculations(calculated_at DESC);

-- ============================================================================
-- MULTI-TENANT SUPPORT
-- ============================================================================

-- Tenants table (for enterprise multi-tenant usage)
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    code VARCHAR(100) UNIQUE NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_tenants_code ON tenants(code);
CREATE INDEX idx_tenants_active ON tenants(is_active) WHERE is_active = true;

-- ============================================================================
-- TRIGGERS & FUNCTIONS
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at triggers
CREATE TRIGGER update_ingredients_updated_at BEFORE UPDATE ON ingredients
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_formulations_updated_at BEFORE UPDATE ON formulations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_formulation_ingredients_updated_at BEFORE UPDATE ON formulation_ingredients
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to recalculate formulation totals
CREATE OR REPLACE FUNCTION recalculate_formulation_totals(formulation_uuid UUID)
RETURNS VOID AS $$
DECLARE
    total_pct DECIMAL(6,2);
    total_cost DECIMAL(12,4);
    total_cal DECIMAL(10,2);
    total_sugar DECIMAL(10,3);
BEGIN
    -- Calculate totals from formulation_ingredients
    SELECT 
        COALESCE(SUM(fi.percentage), 0),
        COALESCE(SUM(fi.cost_contribution), 0),
        COALESCE(SUM((fi.percentage / 100.0) * i.calories_per_100g), 0),
        COALESCE(SUM((fi.percentage / 100.0) * i.sugar_g), 0)
    INTO total_pct, total_cost, total_cal, total_sugar
    FROM formulation_ingredients fi
    JOIN ingredients i ON fi.ingredient_id = i.id
    WHERE fi.formulation_id = formulation_uuid;
    
    -- Update formulation
    UPDATE formulations
    SET 
        total_percentage = total_pct,
        total_cost_per_liter = total_cost,
        total_calories_per_100ml = total_cal,
        total_sugar_per_100ml = total_sugar,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = formulation_uuid;
END;
$$ LANGUAGE plpgsql;

-- Trigger to recalculate totals when formulation_ingredients change
CREATE OR REPLACE FUNCTION trigger_recalculate_formulation_totals()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM recalculate_formulation_totals(COALESCE(NEW.formulation_id, OLD.formulation_id));
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER recalc_totals_on_ingredient_change
    AFTER INSERT OR UPDATE OR DELETE ON formulation_ingredients
    FOR EACH ROW EXECUTE FUNCTION trigger_recalculate_formulation_totals();

-- ============================================================================
-- PERFORMANCE OPTIMIZATIONS
-- ============================================================================

-- Analyze tables for query planner
ANALYZE ingredients;
ANALYZE ingredient_compatibility;
ANALYZE formulations;
ANALYZE formulation_ingredients;

-- Comments for documentation
COMMENT ON TABLE ingredients IS 'Master ingredients table supporting 1,200+ ingredients with comprehensive attributes';
COMMENT ON TABLE ingredient_compatibility IS 'Pre-computed compatibility matrix supporting 1.4M+ ingredient pairs';
COMMENT ON TABLE formulations IS 'Formulation management supporting 100,000+ formulations with versioning';
COMMENT ON TABLE formulation_ingredients IS 'Junction table supporting 5-40 ingredients per formulation with 0.01% precision';
COMMENT ON TABLE ai_formulation_variants IS 'AI-generated formulation alternatives with confidence scores';
COMMENT ON TABLE batch_cost_calculations IS 'Batch costing calculations for volumes from 1L to 10,000L';

