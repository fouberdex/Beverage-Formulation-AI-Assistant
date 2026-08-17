import { getLocalCollections, getStorageConfiguration, persistStore } from './persistentStore.js';
import { getSupabaseAdmin } from '../services/supabaseClient.js';

const COLLECTION_NAMES = [
  'ingredients',
  'formulations',
  'aiVariants',
  'complianceRecords',
  'batchCostCalculations',
  'pricingHistory',
  'targetGenerationRuns',
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

export function snapshotCollections(store) {
  return Object.fromEntries(COLLECTION_NAMES.map(name => [
    name,
    new Map(store[name].map(item => [item.id, JSON.stringify(item)])),
  ]));
}

export function changedRows(current, previous = new Map()) {
  return current.filter(item => previous.get(item.id) !== JSON.stringify(item));
}

export function buildChangeSet(store, auditEvent = null) {
  const changes = Object.fromEntries(COLLECTION_NAMES.map(name => [
    name,
    changedRows(store[name], store.snapshot?.[name]),
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
  const [ingredientRows, formulationRows, variantRows, complianceRows, batchRows, pricingRows, targetRows] = await Promise.all([
    fetchAll(() => client.from('ingredients').select('payload')),
    fetchAll(() => client.from('formulations').select('payload,owner_id').eq('owner_id', ownerId)),
    fetchAll(() => client.from('ai_variants').select('payload,owner_id').eq('owner_id', ownerId)),
    fetchAll(() => client.from('compliance_records').select('payload,owner_id').eq('owner_id', ownerId)),
    fetchAll(() => client.from('batch_cost_calculations').select('payload,owner_id').eq('owner_id', ownerId)),
    fetchAll(() => client.from('pricing_history').select('payload,created_by')),
    fetchAll(() => client.from('target_generation_runs').select('id,owner_id,constraints,candidates,ai_metadata,created_at').eq('owner_id', ownerId)),
  ]);

  const store = {
    ingredients: ingredientRows.map(row => row.payload),
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
  };
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
