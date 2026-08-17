import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const supabaseDirectory = new URL('../../supabase/', import.meta.url);

test('Supabase migrations form an ordered, complete database workflow', async () => {
  const migrationNames = (await readdir(new URL('migrations/', supabaseDirectory))).sort();

  assert.deepEqual(migrationNames.map(name => name.replace(/^\d+_/, '')), [
    'initial_schema.sql',
    'request_scoped_transactional_repository.sql',
    'controlled_admin_bootstrap.sql',
    'enforce_tenant_relational_integrity.sql',
  ]);

  const bootstrap = await readFile(new URL(`migrations/${migrationNames[2]}`, supabaseDirectory), 'utf8');
  assert.match(bootstrap, /values \(p_user_id, nullif[\s\S]*'formulator'/);
  assert.match(bootstrap, /create or replace function public\.bootstrap_admin/);
  assert.match(bootstrap, /security definer/);
  assert.match(bootstrap, /revoke all on function public\.bootstrap_admin\(uuid, text\) from public, anon, authenticated/);
  assert.match(bootstrap, /grant execute on function public\.bootstrap_admin\(uuid, text\) to service_role/);
  assert.doesNotMatch(bootstrap, /first account|case when exists/i);
});

test('Supabase seed data contains shared catalog rows only', async () => {
  const seed = await readFile(new URL('seed.sql', supabaseDirectory), 'utf8');
  const insertedTables = [...seed.matchAll(/insert\s+into\s+([\w.]+)/gi)].map(match => match[1].toLowerCase());

  assert.deepEqual(insertedTables, ['public.ingredients']);
  assert.doesNotMatch(seed, /insert\s+into\s+auth\./i);
  assert.doesNotMatch(seed, /insert\s+into\s+public\.(profiles|formulations|audit_logs)/i);
});

test('RLS integration suite exercises two tenants and cross-tenant denial', async () => {
  const suite = await readFile(new URL('tests/database/001_tenant_rls.test.sql', supabaseDirectory), 'utf8');

  assert.match(suite, /set local role anon/);
  assert.match(suite, /set local role authenticated/);
  assert.match(suite, /11111111-1111-4111-8111-111111111111/);
  assert.match(suite, /22222222-2222-4222-8222-222222222222/);
  assert.match(suite, /cannot insert rows owned by tenant B/);
  assert.match(suite, /cannot attach a child record to tenant B formulation/);
});
