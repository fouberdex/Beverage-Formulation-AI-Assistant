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
    'ai_governance.sql',
    'laboratory_results_feedback.sql',
  ]);

  const bootstrap = await readFile(new URL(`migrations/${migrationNames[2]}`, supabaseDirectory), 'utf8');
  assert.match(bootstrap, /values \(p_user_id, nullif[\s\S]*'formulator'/);
  assert.match(bootstrap, /create or replace function public\.bootstrap_admin/);
  assert.match(bootstrap, /security definer/);
  assert.match(bootstrap, /revoke all on function public\.bootstrap_admin\(uuid, text\) from public, anon, authenticated/);
  assert.match(bootstrap, /grant execute on function public\.bootstrap_admin\(uuid, text\) to service_role/);
  assert.doesNotMatch(bootstrap, /first account|case when exists/i);
});

test('AI governance migration enforces consent ownership and server-only atomic quotas', async () => {
  const migrationNames = (await readdir(new URL('migrations/', supabaseDirectory))).sort();
  const governance = await readFile(new URL(`migrations/${migrationNames.find(name => name.endsWith('_ai_governance.sql'))}`, supabaseDirectory), 'utf8');
  assert.match(governance, /create table public\.ai_preferences/);
  assert.match(governance, /external_processing_enabled boolean not null default false/);
  assert.match(governance, /create table public\.ai_usage_events/);
  assert.match(governance, /pg_advisory_xact_lock/);
  assert.match(governance, /enable row level security/g);
  assert.match(governance, /revoke all on function public\.reserve_ai_quota[\s\S]*authenticated/);
  assert.doesNotMatch(governance, /prompt(_content)?\s+(text|jsonb)|response(_content)?\s+(text|jsonb)/i);
});

test('laboratory feedback migration keeps results tenant-isolated and consented learning local', async () => {
  const migrationNames = (await readdir(new URL('migrations/', supabaseDirectory))).sort();
  const laboratory = await readFile(new URL(`migrations/${migrationNames.find(name => name.endsWith('_laboratory_results_feedback.sql'))}`, supabaseDirectory), 'utf8');
  assert.match(laboratory, /create table public\.laboratory_results/);
  assert.match(laboratory, /create table public\.ai_learning_examples/);
  assert.match(laboratory, /enable row level security/g);
  assert.match(laboratory, /foreign key \(owner_id, formulation_id\)/);
  assert.match(laboratory, /commit_laboratory_feedback/);
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

test('AI governance integration suite covers tenant isolation and quota enforcement', async () => {
  const suite = await readFile(new URL('tests/database/003_ai_governance.test.sql', supabaseDirectory), 'utf8');

  assert.match(suite, /33333333-3333-4333-8333-333333333333/);
  assert.match(suite, /44444444-4444-4444-8444-444444444444/);
  assert.match(suite, /tenant A sees only its AI preference/);
  assert.match(suite, /authenticated cannot reserve provider quota directly/);
  assert.match(suite, /AI_DAILY_QUOTA_EXCEEDED/);
  assert.match(suite, /tenant B still sees only its own usage/);
});
