import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const supabaseDirectory = new URL('../../supabase/', import.meta.url);

test('Supabase migrations form an ordered, complete database workflow', async () => {
  const migrationNames = (await readdir(new URL('migrations/', supabaseDirectory))).sort();

  assert.deepEqual(migrationNames, [
    '20260808173228_beverageai_core_schema.sql',
    '20260808173856_add_foreign_key_indexes.sql',
    '20260809173835_add_roles_and_atomic_formulation_sync.sql',
    '20260817141428_initial_schema.sql',
    '20260817141437_request_scoped_transactional_repository.sql',
    '20260817141448_controlled_admin_bootstrap.sql',
    '20260817141804_enforce_tenant_relational_integrity.sql',
    '20260817150124_ai_governance.sql',
    '20260817160122_request_scoped_transactional_repository.sql',
    '20260817160127_controlled_admin_bootstrap.sql',
    '20260817160134_enforce_tenant_relational_integrity.sql',
    '20260817160139_ai_governance.sql',
    '20260823120000_laboratory_results_feedback.sql',
    '20260823142210_laboratory_feedback_tables.sql',
    '20260823142231_laboratory_feedback_commit.sql',
    '20260825202029_sensory_studies_and_responses.sql',
    '20260914180000_rd_projects_foundation.sql',
    '20260914230000_rd_traceability_spine.sql',
    '20260914234500_rd_execution_loop.sql',
    '20260915113000_rd_stability_and_specifications.sql',
    '20260915170000_rd_suppliers_documents_packaging.sql',
  ]);

  const bootstrap = await readFile(
    new URL('migrations/20260817141448_controlled_admin_bootstrap.sql', supabaseDirectory),
    'utf8',
  );
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

test('sensory migration isolates studies and responses and keeps writes server-controlled', async () => {
  const migrationNames = (await readdir(new URL('migrations/', supabaseDirectory))).sort();
  const sensory = await readFile(new URL(`migrations/${migrationNames.find(name => name.endsWith('_sensory_studies_and_responses.sql'))}`, supabaseDirectory), 'utf8');
  assert.match(sensory, /create table public\.sensory_studies/);
  assert.match(sensory, /create table public\.sensory_responses/);
  assert.match(sensory, /unique \(owner_id, study_id, panelist_code\)/);
  assert.match(sensory, /foreign key \(owner_id, study_id\)/);
  assert.match(sensory, /enable row level security/g);
  assert.match(sensory, /grant select on public\.sensory_studies, public\.sensory_responses to authenticated/);
  assert.match(sensory, /revoke all on function public\.commit_sensory_data\(jsonb\) from public, anon, authenticated/);
});

test('R&D project migration provides tenant isolation, lifecycle fields and an append-only event commit', async () => {
  const migration = await readFile(new URL('migrations/20260914180000_rd_projects_foundation.sql', supabaseDirectory), 'utf8');
  assert.match(migration, /create table public\.rd_projects/);
  assert.match(migration, /create table public\.rd_project_events/);
  assert.match(migration, /stage in \('brief'.*'launched'\)/s);
  assert.match(migration, /foreign key \(owner_id, project_id\)/);
  assert.match(migration, /enable row level security/g);
  assert.match(migration, /on conflict \(id\) do nothing/);
  assert.match(migration, /revoke all on function public\.commit_rd_project_data\(jsonb\) from public, anon, authenticated/);
});

test('R&D traceability migration links exact formulation versions to lab and sensory records', async () => {
  const migration = await readFile(new URL('migrations/20260914230000_rd_traceability_spine.sql', supabaseDirectory), 'utf8');
  assert.match(migration, /add column project_id text generated always as/);
  assert.match(migration, /add column formulation_version_id text generated always as/);
  assert.match(migration, /laboratory_exact_formulation_version_fk/);
  assert.match(migration, /create table public\.sensory_study_formulation_versions/);
  assert.match(migration, /foreign key \(owner_id, project_id, formulation_version_id\)/);
  assert.match(migration, /deferrable initially deferred/g);
  assert.match(migration, /commit_rd_traceability/);
});

test('R&D execution migration persists controlled plans, pilot batches, milestones and immutable decisions', async () => {
  const migration = await readFile(new URL('migrations/20260914234500_rd_execution_loop.sql', supabaseDirectory), 'utf8');
  assert.match(migration, /create table public\.rd_experimental_plans/);
  assert.match(migration, /create table public\.rd_pilot_batches/);
  assert.match(migration, /create table public\.rd_project_milestones/);
  assert.match(migration, /create table public\.rd_project_decisions/);
  assert.match(migration, /foreign key \(owner_id, project_id, formulation_version_id\)/g);
  assert.match(migration, /on conflict \(id\) do nothing/);
  assert.match(migration, /enable row level security/g);
  assert.match(migration, /revoke all on function public\.commit_rd_execution_loop\(jsonb\) from public, anon, authenticated/);
});

test('stability migration persists exact-version programs, laboratory observations and immutable specification approvals', async () => {
  const migration = await readFile(new URL('migrations/20260915113000_rd_stability_and_specifications.sql', supabaseDirectory), 'utf8');
  assert.match(migration, /create table public\.rd_stability_programs/);
  assert.match(migration, /create table public\.rd_stability_observations/);
  assert.match(migration, /create table public\.rd_product_specifications/);
  assert.match(migration, /create table public\.rd_specification_approvals/);
  assert.match(migration, /foreign key \(owner_id, laboratory_result_id\) references public\.laboratory_results/);
  assert.match(migration, /on conflict \(id\) do nothing/g);
  assert.match(migration, /enable row level security/g);
  assert.match(migration, /revoke all on function public\.commit_rd_stability_and_specifications\(jsonb\) from public, anon, authenticated/);
});

test('stability database test covers tenant isolation, API-only writes and cross-tenant foreign keys', async () => {
  const suite = await readFile(new URL('tests/database/006_stability_specifications_rls.test.sql', supabaseDirectory), 'utf8');
  assert.match(suite, /tenant A sees only its stability program/);
  assert.match(suite, /authenticated clients cannot mutate an approved specification/);
  assert.match(suite, /authenticated cannot execute the stability commit RPC/);
  assert.match(suite, /a stability observation cannot link another tenant laboratory result/);
  assert.match(suite, /tenant B sees only its product specification/);
});

test('supply-chain migration isolates suppliers and documents and links packaging to exact product versions', async () => {
  const migration = await readFile(new URL('migrations/20260915170000_rd_suppliers_documents_packaging.sql', supabaseDirectory), 'utf8');
  assert.match(migration, /create table public\.rd_suppliers/);
  assert.match(migration, /create table public\.rd_supplier_materials/);
  assert.match(migration, /create table public\.rd_material_specifications/);
  assert.match(migration, /create table public\.rd_documents/);
  assert.match(migration, /sha256 text not null/);
  assert.match(migration, /create table public\.rd_packaging_components/);
  assert.match(migration, /create table public\.rd_packaging_configurations/);
  assert.match(migration, /foreign key \(owner_id, project_id, formulation_version_id\)/);
  assert.match(migration, /enable row level security/g);
  assert.match(migration, /revoke all on function public\.commit_rd_suppliers_documents_packaging\(jsonb\) from public, anon, authenticated/);
});

test('supply-chain RLS suite covers tenant reads, server-only writes and relational isolation', async () => {
  const suite = await readFile(new URL('tests/database/007_supply_chain_rls.test.sql', supabaseDirectory), 'utf8');
  assert.match(suite, /tenant A sees only its suppliers/);
  assert.match(suite, /authenticated clients cannot mutate reviewed documents/);
  assert.match(suite, /authenticated cannot execute supply-chain commit RPC/);
  assert.match(suite, /supplier material cannot cross tenant ownership/);
  assert.match(suite, /packaging configuration cannot link another tenant formulation/);
  assert.match(suite, /tenant B sees only its suppliers/);
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

test('sensory RLS integration suite covers study, response, RPC and relational isolation', async () => {
  const suite = await readFile(new URL('tests/database/004_sensory_rls.test.sql', supabaseDirectory), 'utf8');
  assert.match(suite, /tenant A sees only its sensory study/);
  assert.match(suite, /authenticated clients cannot bypass the server study workflow/);
  assert.match(suite, /authenticated cannot execute sensory commit RPC/);
  assert.match(suite, /composite foreign key rejects a response attached across owners/);
  assert.match(suite, /panelist code is unique within an owned study/);
});

test('R&D project RLS integration suite covers ownership, server-only writes and relational isolation', async () => {
  const suite = await readFile(new URL('tests/database/005_rd_projects_rls.test.sql', supabaseDirectory), 'utf8');
  assert.match(suite, /tenant A sees only its R&D project/);
  assert.match(suite, /authenticated clients cannot bypass the project API/);
  assert.match(suite, /authenticated cannot execute project commit RPC/);
  assert.match(suite, /composite foreign key rejects a project event attached across owners/);
  assert.match(suite, /project code is unique within an owner workspace/);
  assert.match(suite, /lab result exposes its exact formulation version/);
  assert.match(suite, /sensory study cannot link a formulation version from another project or owner/);
});
