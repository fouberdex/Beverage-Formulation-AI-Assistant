import { getLocalCollections, getStorageConfiguration, persistStore } from './persistentStore.js';
import { getSupabaseAdmin } from '../services/supabaseClient.js';
import { ingredients as bundledIngredients } from './mockData.js';

const COLLECTION_NAMES = [
  'ingredients',
  'formulations',
  'aiVariants',
  'complianceRecords',
  'batchCostCalculations',
  'pricingHistory',
  'targetGenerationRuns',
  'laboratoryResults',
  'aiLearningExamples',
];

function unpackPayload(row, ownershipColumn = 'owner_id') {
  return {
    ...(row.payload || {}),
    ...(row[ownershipColumn] ? { [ownershipColumn]: row[ownershipColumn] } : {}),
  };
}

async function fetchAll(queryFactory) {
  const result = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await queryFactory().range(from, from + pageSize - 1);
    if (error) throw error;
    result.push(...data);
    if (data.length < pageSize) return result;
  }
}

async function fetchOptionalCollection(queryFactory) {
  try {
    return await fetchAll(queryFactory);
  } catch (error) {
    // During a rolling deployment, application code can briefly arrive before
    // its additive table migration. Optional features must not take the core
    // ingredient/formulation API down in that window.
    if (error?.code === 'PGRST205') return [];
    throw error;
  }
}

export function snapshotCollections(store) {
  return Object.fromEntries(COLLECTION_NAMES.map(name => [
    name,
    new Map((store[name] || []).map(item => [item.id, JSON.stringify(item)])),
  ]));
}

export function changedRows(current, previous = new Map()) {
  return current.filter(item => previous.get(item.id) !== JSON.stringify(item));
}

export function buildChangeSet(store, auditEvent = null) {
  const changes = Object.fromEntries(COLLECTION_NAMES.map(name => [
    name,
    changedRows(store[name] || [], store.snapshot?.[name]),
  ]));
  if (auditEvent) changes.auditEvents = [auditEvent];
  return changes;
}

export async function loadRequestStore(ownerId, options = {}) {
  const mode = options.mode || getStorageConfiguration().mode;
  if (mode !== 'supabase') {
    return { ...getLocalCollections(), snapshot: null };
  }
  if (!ownerId) throw new Error('An authenticated owner is required for Supabase data access');

  const client = options.client || getSupabaseAdmin();
  const [ingredientRows, formulationRows, variantRows, complianceRows, batchRows, pricingRows, targetRows, laboratoryRows, learningRows] = await Promise.all([
    fetchAll(() => client.from('ingredients').select('id,code,name,category,is_active,payload')),
    fetchAll(() => client.from('formulations').select('payload,owner_id').eq('owner_id', ownerId)),
    fetchAll(() => client.from('ai_variants').select('payload,owner_id').eq('owner_id', ownerId)),
    fetchAll(() => client.from('compliance_records').select('payload,owner_id').eq('owner_id', ownerId)),
    fetchAll(() => client.from('batch_cost_calculations').select('payload,owner_id').eq('owner_id', ownerId)),
    fetchAll(() => client.from('pricing_history').select('payload,created_by')),
    fetchAll(() => client.from('target_generation_runs').select('id,owner_id,constraints,candidates,ai_metadata,created_at').eq('owner_id', ownerId)),
    fetchOptionalCollection(() => client.from('laboratory_results').select('payload,owner_id').eq('owner_id', ownerId)),
    fetchOptionalCollection(() => client.from('ai_learning_examples').select('payload,owner_id').eq('owner_id', ownerId)),
  ]);

  // A newly connected Supabase project can have no shared catalog rows until
  // its seed migration is applied. Keep the application usable with the
  // bundled, read-only catalog in that case; user-created catalog rows still
  // take precedence as soon as the database contains them.
  const storedIngredients = ingredientRows.map(row => ({
    ...(row.payload || {}),
    id: row.id,
    code: row.code,
    name: row.name,
    category: row.category,
    is_active: row.is_active !== false,
  }));
  const store = {
    ingredients: storedIngredients.length > 0 ? storedIngredients : bundledIngredients.map(item => ({ ...item })),
    formulations: formulationRows.map(row => unpackPayload(row)),
    aiVariants: variantRows.map(row => unpackPayload(row)),
    complianceRecords: complianceRows.map(row => unpackPayload(row)),
    batchCostCalculations: batchRows.map(row => unpackPayload(row)),
    pricingHistory: pricingRows.map(row => unpackPayload(row, 'created_by')),
    targetGenerationRuns: targetRows.map(row => ({
      id: row.id,
      owner_id: row.owner_id,
      constraints: row.constraints,
      candidates: row.candidates,
      ai: row.ai_metadata,
      created_at: row.created_at,
    })),
    laboratoryResults: laboratoryRows.map(row => unpackPayload(row)),
    aiLearningExamples: learningRows.map(row => unpackPayload(row)),
  };
  store.using_bundled_ingredient_catalog = storedIngredients.length === 0;
  store.categories = [...new Set(store.ingredients.map(item => item.category))];
  store.snapshot = snapshotCollections(store);
  return store;
}

export async function commitRequestStore(store, auditEvent = null, options = {}) {
  if (!store) return;
  const mode = options.mode || getStorageConfiguration().mode;
  if (mode !== 'supabase') {
    await persistStore();
    return;
  }

  const changes = buildChangeSet(store, auditEvent);
  const hasChanges = Object.values(changes).some(rows => rows.length > 0);
  if (!hasChanges) return;

  const client = options.client || getSupabaseAdmin();
  const { error } = await client.rpc('commit_request_changes', { p_changes: changes });
  if (error) throw error;
  store.snapshot = snapshotCollections(store);
}
