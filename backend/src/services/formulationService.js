import { query, transaction } from '../db/connection.js';
import { recalculateFormulationTotals } from './formulationCalculations.js';

/**
 * Formulation Management Service
 * Handles operations for 100,000+ formulations with versioning
 */

export async function getAllFormulations(filters = {}) {
  const {
    beverage_type,
    status,
    tenant_id,
    is_latest_version = true,
    limit = 50,
    offset = 0,
    search,
  } = filters;

  let sql = `
    SELECT 
      f.id, f.code, f.name, f.description, f.beverage_type,
      f.version, f.parent_formulation_id, f.is_latest_version,
      f.status, f.total_percentage, f.total_cost_per_liter,
      f.total_calories_per_100ml, f.total_sugar_per_100ml,
      f.created_at, f.updated_at, f.created_by, f.tenant_id,
      COUNT(fi.id) as ingredient_count
    FROM formulations f
    LEFT JOIN formulation_ingredients fi ON f.id = fi.formulation_id
    WHERE 1=1
  `;
  const params = [];
  let paramCount = 0;

  if (is_latest_version !== undefined) {
    paramCount++;
    sql += ` AND f.is_latest_version = $${paramCount}`;
    params.push(is_latest_version);
  }

  if (beverage_type) {
    paramCount++;
    sql += ` AND f.beverage_type = $${paramCount}`;
    params.push(beverage_type);
  }

  if (status) {
    paramCount++;
    sql += ` AND f.status = $${paramCount}`;
    params.push(status);
  }

  if (tenant_id) {
    paramCount++;
    sql += ` AND f.tenant_id = $${paramCount}`;
    params.push(tenant_id);
  }

  if (search) {
    paramCount++;
    sql += ` AND (f.name ILIKE $${paramCount} OR f.code ILIKE $${paramCount})`;
    params.push(`%${search}%`);
  }

  sql += ` GROUP BY f.id ORDER BY f.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
  params.push(limit, offset);

  const result = await query(sql, params);
  return result.rows;
}

export async function getFormulationById(id, includeIngredients = true) {
  const formulationResult = await query(
    'SELECT * FROM formulations WHERE id = $1',
    [id]
  );

  if (formulationResult.rows.length === 0) {
    return null;
  }

  const formulation = formulationResult.rows[0];

  if (includeIngredients) {
    const ingredientsResult = await query(
      `SELECT 
        fi.id, fi.percentage, fi.cost_contribution, fi.display_order,
        i.id as ingredient_id, i.code as ingredient_code, i.name as ingredient_name,
        i.category, i.base_price_per_kg, i.calories_per_100g, i.sugar_g
      FROM formulation_ingredients fi
      JOIN ingredients i ON fi.ingredient_id = i.id
      WHERE fi.formulation_id = $1
      ORDER BY fi.display_order, i.name`,
      [id]
    );
    formulation.ingredients = ingredientsResult.rows;
  }

  return formulation;
}

export async function createFormulation(formulationData) {
  const {
    code,
    name,
    description,
    beverage_type,
    status = 'draft',
    tenant_id,
    created_by,
    ingredients = [],
  } = formulationData;

  return await transaction(async (client) => {
    // Create formulation
    const formulationResult = await client.query(
      `INSERT INTO formulations (
        code, name, description, beverage_type, status, tenant_id, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [code, name, description, beverage_type, status, tenant_id, created_by]
    );

    const formulation = formulationResult.rows[0];

    // Add ingredients
    if (ingredients.length > 0) {
      await addIngredientsToFormulation(client, formulation.id, ingredients);
    }

    // Recalculate totals
    await recalculateFormulationTotals(client, formulation.id);

    // Fetch complete formulation
    return await getFormulationById(formulation.id);
  });
}

export async function addIngredientsToFormulation(client, formulationId, ingredients) {
  const values = [];
  const placeholders = [];
  let paramCount = 0;

  for (let i = 0; i < ingredients.length; i++) {
    const ing = ingredients[i];
    const base = paramCount * 4;
    placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
    values.push(
      formulationId,
      ing.ingredient_id,
      ing.percentage,
      ing.display_order || i
    );
    paramCount++;
  }

  const sql = `
    INSERT INTO formulation_ingredients (formulation_id, ingredient_id, percentage, display_order)
    VALUES ${placeholders.join(', ')}
    ON CONFLICT (formulation_id, ingredient_id) 
    DO UPDATE SET percentage = EXCLUDED.percentage, display_order = EXCLUDED.display_order
  `;

  await client.query(sql, values);
}

export async function updateFormulation(id, formulationData) {
  const {
    name,
    description,
    beverage_type,
    status,
    ingredients,
  } = formulationData;

  return await transaction(async (client) => {
    // Update formulation
    const updates = [];
    const values = [];
    let paramCount = 0;

    if (name !== undefined) {
      paramCount++;
      updates.push(`name = $${paramCount}`);
      values.push(name);
    }
    if (description !== undefined) {
      paramCount++;
      updates.push(`description = $${paramCount}`);
      values.push(description);
    }
    if (beverage_type !== undefined) {
      paramCount++;
      updates.push(`beverage_type = $${paramCount}`);
      values.push(beverage_type);
    }
    if (status !== undefined) {
      paramCount++;
      updates.push(`status = $${paramCount}`);
      values.push(status);
    }

    if (updates.length > 0) {
      paramCount++;
      values.push(id);
      await client.query(
        `UPDATE formulations SET ${updates.join(', ')} WHERE id = $${paramCount}`,
        values
      );
    }

    // Update ingredients if provided
    if (ingredients !== undefined) {
      // Delete existing ingredients
      await client.query(
        'DELETE FROM formulation_ingredients WHERE formulation_id = $1',
        [id]
      );

      // Add new ingredients
      if (ingredients.length > 0) {
        await addIngredientsToFormulation(client, id, ingredients);
      }
    }

    // Recalculate totals
    await recalculateFormulationTotals(client, id);

    return await getFormulationById(id);
  });
}

export async function createFormulationVersion(parentId, versionData) {
  const parent = await getFormulationById(parentId);
  if (!parent) {
    throw new Error('Parent formulation not found');
  }

  return await transaction(async (client) => {
    // Mark parent as not latest
    await client.query(
      'UPDATE formulations SET is_latest_version = false WHERE id = $1',
      [parentId]
    );

    // Get next version number
    const versionResult = await client.query(
      'SELECT MAX(version) as max_version FROM formulations WHERE parent_formulation_id = $1 OR id = $1',
      [parentId]
    );
    const nextVersion = (versionResult.rows[0].max_version || parent.version) + 1;

    // Create new version
    const {
      name = parent.name,
      description = parent.description,
      status = 'draft',
      ingredients = parent.ingredients || [],
    } = versionData;

    const formulationResult = await client.query(
      `INSERT INTO formulations (
        code, name, description, beverage_type, version, parent_formulation_id,
        is_latest_version, status, tenant_id, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        `${parent.code}-v${nextVersion}`,
        name,
        description,
        parent.beverage_type,
        nextVersion,
        parentId,
        true,
        status,
        parent.tenant_id,
        parent.created_by,
      ]
    );

    const newFormulation = formulationResult.rows[0];

    // Copy ingredients
    if (ingredients.length > 0) {
      await addIngredientsToFormulation(client, newFormulation.id, ingredients);
    }

    // Recalculate totals
    await recalculateFormulationTotals(client, newFormulation.id);

    return await getFormulationById(newFormulation.id);
  });
}

export async function deleteFormulation(id) {
  // Soft delete by archiving
  const result = await query(
    'UPDATE formulations SET status = $1 WHERE id = $2 RETURNING *',
    ['archived', id]
  );
  return result.rows[0];
}

export async function getFormulationVersions(parentId) {
  const result = await query(
    `SELECT * FROM formulations 
     WHERE parent_formulation_id = $1 OR id = $1
     ORDER BY version ASC`,
    [parentId]
  );
  return result.rows;
}

export async function getFormulationCount(filters = {}) {
  const { beverage_type, status, tenant_id, is_latest_version = true } = filters;

  let sql = 'SELECT COUNT(*) as count FROM formulations WHERE 1=1';
  const params = [];
  let paramCount = 0;

  if (is_latest_version !== undefined) {
    paramCount++;
    sql += ` AND is_latest_version = $${paramCount}`;
    params.push(is_latest_version);
  }

  if (beverage_type) {
    paramCount++;
    sql += ` AND beverage_type = $${paramCount}`;
    params.push(beverage_type);
  }

  if (status) {
    paramCount++;
    sql += ` AND status = $${paramCount}`;
    params.push(status);
  }

  if (tenant_id) {
    paramCount++;
    sql += ` AND tenant_id = $${paramCount}`;
    params.push(tenant_id);
  }

  const result = await query(sql, params);
  return parseInt(result.rows[0].count);
}


