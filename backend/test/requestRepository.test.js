import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChangeSet,
  changedRows,
  commitRequestStore,
  loadRequestStore,
  snapshotCollections,
} from '../src/data/requestRepository.js';

function emptyStore() {
  return {
    ingredients: [],
    formulations: [],
    aiVariants: [],
    complianceRecords: [],
    batchCostCalculations: [],
    pricingHistory: [],
    targetGenerationRuns: [],
    laboratoryResults: [],
    aiLearningExamples: [],
  };
}

test('changedRows includes only new or modified records', () => {
  const previous = new Map([
    ['same', JSON.stringify({ id: 'same', value: 1 })],
    ['changed', JSON.stringify({ id: 'changed', value: 1 })],
  ]);
  assert.deepEqual(changedRows([
    { id: 'same', value: 1 },
    { id: 'changed', value: 2 },
    { id: 'new', value: 3 },
  ], previous), [
    { id: 'changed', value: 2 },
    { id: 'new', value: 3 },
  ]);
});

test('request change sets do not rewrite unchanged collections', () => {
  const store = emptyStore();
  store.ingredients.push({ id: 'ingredient-1', name: 'Water' });
  store.formulations.push({ id: 'formulation-1', owner_id: 'owner-1', status: 'draft' });
  store.snapshot = snapshotCollections(store);

  store.formulations[0].status = 'active';
  store.aiVariants.push({ id: 'variant-1', owner_id: 'owner-1' });
  const auditEvent = { owner_id: 'owner-1', action: 'post', entity_type: 'formulations' };
  const changes = buildChangeSet(store, auditEvent);

  assert.deepEqual(changes.ingredients, []);
  assert.deepEqual(changes.formulations, [store.formulations[0]]);
  assert.deepEqual(changes.aiVariants, [store.aiVariants[0]]);
  assert.deepEqual(changes.auditEvents, [auditEvent]);
  assert.equal(Object.values(changes).flat().length, 3);
});

function createFakeClient(tables) {
  const calls = { rpc: [] };
  return {
    calls,
    from(table) {
      let rows = [...(tables[table] || [])];
      return {
        select() { return this; },
        eq(column, value) {
          rows = rows.filter(row => row[column] === value);
          return this;
        },
        async range(from, to) {
          return { data: rows.slice(from, to + 1), error: null };
        },
      };
    },
    async rpc(name, parameters) {
      calls.rpc.push({ name, parameters });
      return { error: null };
    },
  };
}

test('Supabase request stores contain only the authenticated owner records', async () => {
  const client = createFakeClient({
    ingredients: [{ id: 'water', code: 'WATER', name: 'Water', category: 'base', is_active: true, payload: { id: 'water', name: 'Water', category: 'base' } }],
    formulations: [
      { owner_id: 'owner-1', payload: { id: 'form-1', name: 'One' } },
      { owner_id: 'owner-2', payload: { id: 'form-2', name: 'Two' } },
      { owner_id: null, payload: { id: 'legacy', name: 'Unowned' } },
    ],
  });

  const first = await loadRequestStore('owner-1', { mode: 'supabase', client });
  const second = await loadRequestStore('owner-2', { mode: 'supabase', client });

  assert.deepEqual(first.formulations.map(item => item.id), ['form-1']);
  assert.deepEqual(second.formulations.map(item => item.id), ['form-2']);
  assert.notEqual(first.formulations, second.formulations);
  assert.deepEqual(first.ingredients.map(item => item.id), ['water']);
});

test('Supabase request stores fall back to the bundled catalog when the shared table is empty', async () => {
  const store = await loadRequestStore('owner-1', { mode: 'supabase', client: createFakeClient({}) });
  assert.ok(store.ingredients.length > 300);
  assert.equal(store.using_bundled_ingredient_catalog, true);
});

test('Supabase commits send one change-only transaction', async () => {
  const client = createFakeClient({});
  const store = emptyStore();
  store.formulations.push({ id: 'form-1', owner_id: 'owner-1', status: 'draft' });
  store.snapshot = snapshotCollections(store);
  store.formulations[0].status = 'active';

  await commitRequestStore(store, { owner_id: 'owner-1', action: 'put' }, { mode: 'supabase', client });

  assert.equal(client.calls.rpc.length, 1);
  assert.equal(client.calls.rpc[0].name, 'commit_request_changes');
  const payload = client.calls.rpc[0].parameters.p_changes;
  assert.deepEqual(payload.formulations, [store.formulations[0]]);
  assert.deepEqual(payload.ingredients, []);
  assert.equal(payload.auditEvents.length, 1);
});
