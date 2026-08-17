begin;
select plan(18);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated',
   'tenant-a@example.test', extensions.crypt('test-password-a', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated',
   'tenant-b@example.test', extensions.crypt('test-password-b', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

insert into public.profiles (id, display_name, role) values
  ('11111111-1111-4111-8111-111111111111', 'Tenant A', 'formulator'),
  ('22222222-2222-4222-8222-222222222222', 'Tenant B', 'formulator');

insert into public.ingredients (id, code, name, category, is_active, payload) values
  ('rls-active', 'RLS-ACTIVE', 'RLS Active', 'test', true, '{}'),
  ('rls-inactive', 'RLS-INACTIVE', 'RLS Inactive', 'test', false, '{}');

insert into public.formulations (id, owner_id, code, name, payload) values
  ('tenant-a-form', '11111111-1111-4111-8111-111111111111', 'A-001', 'Tenant A Formula', '{}'),
  ('tenant-b-form', '22222222-2222-4222-8222-222222222222', 'B-001', 'Tenant B Formula', '{}');
insert into public.formulation_ingredients (formulation_id, ingredient_id, owner_id, percentage, payload) values
  ('tenant-a-form', 'rls-active', '11111111-1111-4111-8111-111111111111', 100, '{}'),
  ('tenant-b-form', 'rls-active', '22222222-2222-4222-8222-222222222222', 100, '{}');
insert into public.ai_variants (id, owner_id, source_formulation_id, payload) values
  ('variant-a', '11111111-1111-4111-8111-111111111111', 'tenant-a-form', '{}'),
  ('variant-b', '22222222-2222-4222-8222-222222222222', 'tenant-b-form', '{}');
insert into public.compliance_records (id, owner_id, formulation_id, payload) values
  ('compliance-a', '11111111-1111-4111-8111-111111111111', 'tenant-a-form', '{}'),
  ('compliance-b', '22222222-2222-4222-8222-222222222222', 'tenant-b-form', '{}');
insert into public.batch_cost_calculations (id, owner_id, formulation_id, batch_size_liters, payload) values
  ('cost-a', '11111111-1111-4111-8111-111111111111', 'tenant-a-form', 10, '{}'),
  ('cost-b', '22222222-2222-4222-8222-222222222222', 'tenant-b-form', 10, '{}');
insert into public.target_generation_runs (id, owner_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222');
insert into public.audit_logs (owner_id, action, entity_type) values
  ('11111111-1111-4111-8111-111111111111', 'create', 'formulation'),
  ('22222222-2222-4222-8222-222222222222', 'create', 'formulation');

set local role anon;
select results_eq($$ select id from public.ingredients where id like 'rls-%' order by id $$,
  array['rls-active']::text[], 'anonymous users see only active shared ingredients');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
select results_eq($$ select id from public.profiles order by id $$,
  array['11111111-1111-4111-8111-111111111111']::uuid[], 'tenant A sees only its profile');
select results_eq($$ select id from public.formulations order by id $$,
  array['tenant-a-form']::text[], 'tenant A sees only its formulation');
select results_eq($$ select formulation_id from public.formulation_ingredients order by formulation_id $$,
  array['tenant-a-form']::text[], 'tenant A sees only its formulation ingredients');
select results_eq($$ select id from public.ai_variants order by id $$,
  array['variant-a']::text[], 'tenant A sees only its AI variants');
select results_eq($$ select id from public.compliance_records order by id $$,
  array['compliance-a']::text[], 'tenant A sees only its compliance records');
select results_eq($$ select id from public.batch_cost_calculations order by id $$,
  array['cost-a']::text[], 'tenant A sees only its batch calculations');
select results_eq($$ select id from public.target_generation_runs order by id $$,
  array['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']::uuid[], 'tenant A sees only its generation runs');
select is((select count(*)::integer from public.audit_logs), 1, 'tenant A sees only its audit events');
select throws_ok($$ insert into public.formulations (id, owner_id, code, name) values
  ('cross-tenant-insert', '22222222-2222-4222-8222-222222222222', 'X-001', 'Cross tenant') $$,
  'tenant A cannot insert rows owned by tenant B');
select throws_ok($$ update public.formulations set owner_id = '22222222-2222-4222-8222-222222222222'
  where id = 'tenant-a-form' $$, 'tenant A cannot transfer ownership to tenant B');
select throws_ok($$ insert into public.formulation_ingredients
  (formulation_id, ingredient_id, owner_id, percentage)
  values ('tenant-b-form', 'rls-active', '11111111-1111-4111-8111-111111111111', 50) $$,
  'tenant A cannot attach a child record to tenant B formulation');
select throws_ok($$ update public.profiles set role = 'admin'
  where id = '11111111-1111-4111-8111-111111111111' $$, 'users cannot promote their own profile');
select ok(not has_function_privilege('authenticated', 'public.ensure_profile(uuid,text)', 'EXECUTE'),
  'authenticated cannot call the server-only profile helper');
select ok(not has_function_privilege('authenticated', 'public.bootstrap_admin(uuid,text)', 'EXECUTE'),
  'authenticated cannot call the admin bootstrap function');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
select results_eq($$ select id from public.formulations order by id $$,
  array['tenant-b-form']::text[], 'tenant B sees only its formulation');
select results_eq($$ select formulation_id from public.formulation_ingredients order by formulation_id $$,
  array['tenant-b-form']::text[], 'tenant B sees only its formulation ingredients');
select is((select count(*)::integer from public.audit_logs), 1, 'tenant B sees only its audit events');
reset role;

select * from finish();
rollback;
