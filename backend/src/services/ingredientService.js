import { query } from '../db/connection.js';

/**
 * Ingredient Intelligence Service
 * Handles operations for 1,200+ ingredients
 */

export async function getAllIngredients(filters = {}) {
  const {
    category,
    regulatory_status,
    is_active = true,
    search,
    limit = 100,
    offset = 0,
  } = filters;

  let sql = `
    SELECT 
      id, code, name, name_ar, name_fr, category, subcategory,
      ph_min, ph_max, solubility_g_per_100ml, density_g_per_ml,
      taste_profile, color, aroma_profile,
      halal_certified, kosher_certified, vegan, organic,
      regulatory_status, max_percentage, restrictions,
      base_price_per_kg, currency, supplier_id,
      calories_per_100g, protein_g, carbs_g, sugar_g, fat_g,
      created_at, updated_at, is_active
    FROM ingredients
    WHERE 1=1
  `;
  const params = [];
  let paramCount = 0;

  if (is_active !== undefined) {
    paramCount++;
    sql += ` AND is_active = $${paramCount}`;
    params.push(is_active);
  }

  if (category) {
    paramCount++;
    sql += ` AND category = $${paramCount}`;
    params.push(category);
  }

  if (regulatory_status) {
    paramCount++;
    sql += ` AND regulatory_status = $${paramCount}`;
    params.push(regulatory_status);
  }

  if (search) {
    paramCount++;
    sql += ` AND search_vector @@ plainto_tsquery('english', $${paramCount})`;
    params.push(search);
  }

  sql += ` ORDER BY name LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
  params.push(limit, offset);

  const result = await query(sql, params);
  return result.rows;
}

export async function getIngredientById(id) {
  const result = await query(
    'SELECT * FROM ingredients WHERE id = $1',
    [id]
  );
  return result.rows[0];
}

export async function getIngredientByCode(code) {
  const result = await query(
    'SELECT * FROM ingredients WHERE code = $1',
    [code]
  );
  return result.rows[0];
}

export async function createIngredient(ingredientData) {
  const {
    code,
    name,
    name_ar,
    name_fr,
    category,
    subcategory,
    ph_min,
    ph_max,
    solubility_g_per_100ml,
    density_g_per_ml,
    molecular_weight,
    cas_number,
    einECS_number,
    taste_profile,
    color,
    aroma_profile,
    halal_certified = false,
    kosher_certified = false,
    vegan = false,
    organic = false,
    regulatory_status = 'approved',
    max_percentage,
    restrictions,
    base_price_per_kg = 0,
    currency = 'DZD',
    supplier_id,
    lead_time_days,
    min_order_quantity_kg,
    availability_status = 'available',
    calories_per_100g,
    protein_g,
    carbs_g,
    sugar_g,
    fat_g,
    fiber_g,
    sodium_mg,
    created_by,
  } = ingredientData;

  const result = await query(
    `INSERT INTO ingredients (
      code, name, name_ar, name_fr, category, subcategory,
      ph_min, ph_max, solubility_g_per_100ml, density_g_per_ml,
      molecular_weight, cas_number, einECS_number,
      taste_profile, color, aroma_profile,
      halal_certified, kosher_certified, vegan, organic,
      regulatory_status, max_percentage, restrictions,
      base_price_per_kg, currency, supplier_id,
      lead_time_days, min_order_quantity_kg, availability_status,
      calories_per_100g, protein_g, carbs_g, sugar_g, fat_g,
      fiber_g, sodium_mg, created_by
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
      $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
      $31, $32, $33, $34, $35, $36
    ) RETURNING *`,
    [
      code, name, name_ar, name_fr, category, subcategory,
      ph_min, ph_max, solubility_g_per_100ml, density_g_per_ml,
      molecular_weight, cas_number, einECS_number,
      JSON.stringify(taste_profile), color, JSON.stringify(aroma_profile),
      halal_certified, kosher_certified, vegan, organic,
      regulatory_status, max_percentage, JSON.stringify(restrictions),
      base_price_per_kg, currency, supplier_id,
      lead_time_days, min_order_quantity_kg, availability_status,
      calories_per_100g, protein_g, carbs_g, sugar_g, fat_g,
      fiber_g, sodium_mg, created_by,
    ]
  );

  return result.rows[0];
}

export async function updateIngredient(id, ingredientData) {
  const fields = [];
  const values = [];
  let paramCount = 0;

  const allowedFields = [
    'name', 'name_ar', 'name_fr', 'category', 'subcategory',
    'ph_min', 'ph_max', 'solubility_g_per_100ml', 'density_g_per_ml',
    'molecular_weight', 'cas_number', 'einECS_number',
    'taste_profile', 'color', 'aroma_profile',
    'halal_certified', 'kosher_certified', 'vegan', 'organic',
    'regulatory_status', 'max_percentage', 'restrictions',
    'base_price_per_kg', 'currency', 'supplier_id',
    'lead_time_days', 'min_order_quantity_kg', 'availability_status',
    'calories_per_100g', 'protein_g', 'carbs_g', 'sugar_g', 'fat_g',
    'fiber_g', 'sodium_mg', 'is_active',
  ];

  for (const [key, value] of Object.entries(ingredientData)) {
    if (allowedFields.includes(key) && value !== undefined) {
      paramCount++;
      fields.push(`${key} = $${paramCount}`);
      // Handle JSON fields
      if (['taste_profile', 'aroma_profile', 'restrictions'].includes(key)) {
        values.push(JSON.stringify(value));
      } else {
        values.push(value);
      }
    }
  }

  if (fields.length === 0) {
    throw new Error('No valid fields to update');
  }

  paramCount++;
  values.push(id);

  const sql = `UPDATE ingredients SET ${fields.join(', ')} WHERE id = $${paramCount} RETURNING *`;
  const result = await query(sql, values);
  return result.rows[0];
}

export async function deleteIngredient(id) {
  // Soft delete
  const result = await query(
    'UPDATE ingredients SET is_active = false WHERE id = $1 RETURNING *',
    [id]
  );
  return result.rows[0];
}

export async function getIngredientCategories() {
  const result = await query(
    'SELECT DISTINCT category FROM ingredients WHERE is_active = true ORDER BY category'
  );
  return result.rows.map(row => row.category);
}

export async function getIngredientCount() {
  const result = await query(
    'SELECT COUNT(*) as count FROM ingredients WHERE is_active = true'
  );
  return parseInt(result.rows[0].count);
}


