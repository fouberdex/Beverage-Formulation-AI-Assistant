import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  aiVariants,
  batchCostCalculations,
  categories,
  complianceRecords,
  formulations,
  ingredients,
  pricingHistory,
  targetGenerationRuns,
} from './mockData.js';
import { getSupabaseAdmin, isSupabaseConfigured } from '../services/supabaseClient.js';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultDataFile = path.resolve(moduleDirectory, '../../data/app-data.json');
const collections = {
  ingredients,
  formulations,
  aiVariants,
  complianceRecords,
  batchCostCalculations,
  pricingHistory,
  targetGenerationRuns,
};

let dataFile = defaultDataFile;
let storageMode = 'file';
let persistenceEnabled = true;
let writeQueue = Promise.resolve();
const persistedHashes = new Map();

function replaceContents(target, values) {
  target.splice(0, target.length, ...values);
}

function hashCollection(value) {
  return JSON.stringify(value);
}

async function loadLocalData() {
  try {
    const bundledIngredients = [...ingredients];
    const stored = JSON.parse(await readFile(dataFile, 'utf8'));
    if (Array.isArray(stored.ingredients)) {
      const storedIds = new Set(stored.ingredients.map(item => item.id));
      const bundledById = new Map(bundledIngredients.map(item => [item.id, item]));
      replaceContents(ingredients, [
        ...stored.ingredients.map(item => ({ ...(bundledById.get(item.id) || {}), ...item })),
        ...bundledIngredients.filter(item => !storedIds.has(item.id)),
      ]);
    }
    for (const [name, target] of Object.entries(collections)) {
      if (name !== 'ingredients' && Array.isArray(stored[name])) replaceContents(target, stored[name]);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  replaceContents(categories, [...new Set(ingredients.map(item => item.category))]);
}

async function fetchAll(table, columns) {
  const client = getSupabaseAdmin();
  const result = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client.from(table).select(columns).range(from, from + pageSize - 1);
    if (error) throw error;
    result.push(...data);
    if (data.length < pageSize) return result;
  }
}

function unpackPayload(row, ownershipColumn = 'owner_id') {
  return {
    ...(row.payload || {}),
    ...(row[ownershipColumn] ? { [ownershipColumn]: row[ownershipColumn] } : {}),
  };
}

async function loadSupabaseData() {
  const [ingredientRows, formulationRows, variantRows, complianceRows, batchRows, pricingRows, targetRows] = await Promise.all([
    fetchAll('ingredients', 'payload'),
    fetchAll('formulations', 'payload,owner_id'),
    fetchAll('ai_variants', 'payload,owner_id'),
    fetchAll('compliance_records', 'payload,owner_id'),
    fetchAll('batch_cost_calculations', 'payload,owner_id'),
    fetchAll('pricing_history', 'payload,created_by'),
    fetchAll('target_generation_runs', 'id,owner_id,constraints,candidates,ai_metadata,created_at'),
  ]);

  const hasRemoteData = ingredientRows.length > 0;
  if (hasRemoteData) replaceContents(ingredients, ingredientRows.map(row => row.payload));
  if (formulationRows.length > 0) replaceContents(formulations, formulationRows.map(row => unpackPayload(row)));
  if (variantRows.length > 0) replaceContents(aiVariants, variantRows.map(row => unpackPayload(row)));
  if (complianceRows.length > 0) replaceContents(complianceRecords, complianceRows.map(row => unpackPayload(row)));
  if (batchRows.length > 0) replaceContents(batchCostCalculations, batchRows.map(row => unpackPayload(row)));
  if (pricingRows.length > 0) replaceContents(pricingHistory, pricingRows.map(row => unpackPayload(row, 'created_by')));
  if (targetRows.length > 0) replaceContents(targetGenerationRuns, targetRows.map(row => ({
    id: row.id,
    owner_id: row.owner_id,
    constraints: row.constraints,
    candidates: row.candidates,
    ai: row.ai_metadata,
    created_at: row.created_at,
  })));
  replaceContents(categories, [...new Set(ingredients.map(item => item.category))]);
  return hasRemoteData;
}

async function upsertInChunks(table, rows, onConflict = 'id') {
  if (rows.length === 0) return;
  const client = getSupabaseAdmin();
  for (let index = 0; index < rows.length; index += 200) {
    const { error } = await client.from(table).upsert(rows.slice(index, index + 200), { onConflict });
    if (error) throw error;
  }
}

async function syncIngredients() {
  await upsertInChunks('ingredients', ingredients.map(item => ({
    id: item.id,
    code: item.code,
    name: item.name,
    category: item.category,
    is_active: item.is_active !== false,
    payload: item,
    created_at: item.created_at || new Date().toISOString(),
    updated_at: item.updated_at || new Date().toISOString(),
  })));
}

async function syncFormulations() {
  const client = getSupabaseAdmin();
  await upsertInChunks('formulations', formulations.map(item => ({
    id: item.id,
    owner_id: item.owner_id || null,
    code: item.code,
    name: item.name,
    status: item.status || 'draft',
    parent_formulation_id: item.parent_formulation_id || null,
    payload: item,
    created_at: item.created_at || new Date().toISOString(),
    updated_at: item.updated_at || new Date().toISOString(),
  })));

  const formulationIds = formulations.map(item => item.id);
  if (formulationIds.length > 0) {
    const { error: deleteError } = await client.from('formulation_ingredients').delete().in('formulation_id', formulationIds);
    if (deleteError) throw deleteError;
  }
  const relationRows = formulations.flatMap(formulation => (formulation.ingredients || []).map((item, index) => ({
    formulation_id: formulation.id,
    ingredient_id: item.ingredient_id,
    owner_id: formulation.owner_id || null,
    percentage: item.percentage,
    display_order: item.display_order ?? index,
    payload: item,
  })));
  await upsertInChunks('formulation_ingredients', relationRows, 'formulation_id,ingredient_id');
}

async function syncPayloadCollection(table, collection, mapRow) {
  await upsertInChunks(table, collection.map(mapRow));
}

async function persistSupabase(force = false) {
  const jobs = [];
  const schedule = (name, task) => {
    const nextHash = hashCollection(collections[name]);
    if (force || persistedHashes.get(name) !== nextHash) {
      jobs.push({ name, nextHash, task });
    }
  };

  schedule('ingredients', syncIngredients);
  schedule('formulations', syncFormulations);
  schedule('aiVariants', () => syncPayloadCollection('ai_variants', aiVariants, item => ({
    id: item.id,
    owner_id: item.owner_id || null,
    source_formulation_id: item.source_formulation_id,
    status: item.status || 'generated',
    payload: item,
    created_at: item.created_at || new Date().toISOString(),
    updated_at: item.updated_at || new Date().toISOString(),
  })));
  schedule('complianceRecords', () => syncPayloadCollection('compliance_records', complianceRecords, item => ({
    id: item.id,
    owner_id: item.owner_id || null,
    formulation_id: item.formulation_id,
    payload: item,
    checked_at: item.checked_at || new Date().toISOString(),
  })));
  schedule('batchCostCalculations', () => syncPayloadCollection('batch_cost_calculations', batchCostCalculations, item => ({
    id: item.id,
    owner_id: item.owner_id || null,
    formulation_id: item.formulation_id,
    batch_size_liters: item.batch_size_liters,
    payload: item,
    calculated_at: item.calculated_at || new Date().toISOString(),
  })));
  schedule('pricingHistory', () => syncPayloadCollection('pricing_history', pricingHistory, item => ({
    id: item.id,
    ingredient_id: item.ingredient_id,
    created_by: item.created_by || null,
    price_per_kg: item.price_per_kg,
    currency: item.currency || 'DZD',
    payload: item,
    effective_date: item.effective_date || new Date().toISOString(),
  })));
  schedule('targetGenerationRuns', () => syncPayloadCollection('target_generation_runs', targetGenerationRuns, item => ({
    id: item.id,
    owner_id: item.owner_id,
    constraints: item.constraints || {},
    candidates: item.candidates || [],
    ai_metadata: item.ai || {},
    created_at: item.created_at || new Date().toISOString(),
  })));
  // Preserve foreign-key ordering: ingredients, formulations, then their child records.
  for (const job of jobs) {
    await job.task();
    persistedHashes.set(job.name, job.nextHash);
  }
}

export async function initializePersistentStore() {
  dataFile = path.resolve(process.env.DATA_FILE || defaultDataFile);
  persistenceEnabled = process.env.PERSIST_DATA !== 'false' && !process.env.NODE_TEST_CONTEXT;
  if (!persistenceEnabled) {
    storageMode = 'memory';
    return;
  }

  await loadLocalData();
  if (process.env.STORAGE_MODE === 'supabase') {
    if (!isSupabaseConfigured()) throw new Error('Supabase storage selected but credentials are missing');
    storageMode = 'supabase';
    const hasRemoteData = await loadSupabaseData();
    await persistSupabase(!hasRemoteData);
  } else {
    storageMode = 'file';
  }
  for (const [name, value] of Object.entries(collections)) persistedHashes.set(name, hashCollection(value));
}

export async function persistStore() {
  if (!persistenceEnabled) return;
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    if (storageMode === 'supabase') {
      await persistSupabase();
      return;
    }
    await mkdir(path.dirname(dataFile), { recursive: true });
    const temporaryFile = `${dataFile}.tmp`;
    const data = { version: 1, saved_at: new Date().toISOString(), ...collections };
    await writeFile(temporaryFile, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await rename(temporaryFile, dataFile);
  });
  await writeQueue;
}

export async function claimUnownedData(userId) {
  let changed = false;
  for (const collection of [formulations, aiVariants, complianceRecords, batchCostCalculations]) {
    for (const item of collection) {
      if (!item.owner_id) {
        item.owner_id = userId;
        changed = true;
      }
    }
  }
  if (changed) await persistStore();
  return changed;
}

export function getStorageConfiguration() {
  return {
    mode: storageMode,
    persistent: persistenceEnabled,
    data_file: storageMode === 'file' && persistenceEnabled ? dataFile : null,
    supabase_url: storageMode === 'supabase' ? process.env.SUPABASE_URL : null,
  };
}
