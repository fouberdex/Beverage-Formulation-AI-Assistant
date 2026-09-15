begin;
select plan(12);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000', '99999999-9999-4999-8999-999999999999', 'authenticated', 'authenticated',
   'stability-a@example.test', extensions.crypt('test-password-a', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'authenticated', 'authenticated',
   'stability-b@example.test', extensions.crypt('test-password-b', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

insert into public.profiles (id, display_name, role) values
  ('99999999-9999-4999-8999-999999999999', 'Stability Tenant A', 'formulator'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Stability Tenant B', 'formulator');

set local role service_role;
insert into public.rd_projects (id, owner_id, code, name, payload) values
  ('stability-project-a', '99999999-9999-4999-8999-999999999999', 'STAB-A', 'Stability A', '{"id":"stability-project-a"}'),
  ('stability-project-b', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'STAB-B', 'Stability B', '{"id":"stability-project-b"}');
insert into public.formulations (id, owner_id, code, name, status, payload) values
  ('stability-form-a', '99999999-9999-4999-8999-999999999999', 'STAB-F-A', 'Formula A', 'approved', '{"id":"stability-form-a","project_id":"stability-project-a","version":1}'),
  ('stability-form-b', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'STAB-F-B', 'Formula B', 'approved', '{"id":"stability-form-b","project_id":"stability-project-b","version":1}');
insert into public.laboratory_results (id, owner_id, formulation_id, payload) values
  ('stability-lab-a', '99999999-9999-4999-8999-999999999999', 'stability-form-a', '{"id":"stability-lab-a","project_id":"stability-project-a","formulation_version_id":"stability-form-a"}');
insert into public.rd_stability_programs (id, owner_id, project_id, formulation_version_id, status, payload) values
  ('stability-program-a', '99999999-9999-4999-8999-999999999999', 'stability-project-a', 'stability-form-a', 'running', '{"id":"stability-program-a"}'),
  ('stability-program-b', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'stability-project-b', 'stability-form-b', 'draft', '{"id":"stability-program-b"}');
insert into public.rd_stability_observations
  (id, owner_id, project_id, program_id, formulation_version_id, laboratory_result_id, condition_id, timepoint_days, replicate, payload) values
  ('stability-observation-a', '99999999-9999-4999-8999-999999999999', 'stability-project-a', 'stability-program-a', 'stability-form-a', 'stability-lab-a', 'ambient', 0, 1, '{"id":"stability-observation-a"}');
insert into public.rd_product_specifications
  (id, owner_id, project_id, formulation_version_id, version, status, payload) values
  ('stability-spec-a', '99999999-9999-4999-8999-999999999999', 'stability-project-a', 'stability-form-a', 1, 'approved', '{"id":"stability-spec-a"}'),
  ('stability-spec-b', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'stability-project-b', 'stability-form-b', 1, 'draft', '{"id":"stability-spec-b"}');
insert into public.rd_specification_approvals
  (id, owner_id, actor_id, project_id, specification_id, outcome, payload) values
  ('stability-approval-a', '99999999-9999-4999-8999-999999999999', '99999999-9999-4999-8999-999999999999', 'stability-project-a', 'stability-spec-a', 'approved', '{"id":"stability-approval-a"}');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"99999999-9999-4999-8999-999999999999","role":"authenticated"}', true);
select results_eq($$ select id from public.rd_stability_programs $$, array['stability-program-a']::text[], 'tenant A sees only its stability program');
select results_eq($$ select id from public.rd_stability_observations $$, array['stability-observation-a']::text[], 'tenant A sees only its stability observations');
select results_eq($$ select id from public.rd_product_specifications $$, array['stability-spec-a']::text[], 'tenant A sees only its product specification');
select results_eq($$ select id from public.rd_specification_approvals $$, array['stability-approval-a']::text[], 'tenant A sees only its specification approvals');
select throws_ok($$ insert into public.rd_stability_programs (id, owner_id, project_id, formulation_version_id, status) values
  ('client-stability-program', '99999999-9999-4999-8999-999999999999', 'stability-project-a', 'stability-form-a', 'draft') $$,
  'permission denied for table rd_stability_programs', 'authenticated clients cannot bypass the stability API');
select throws_ok($$ update public.rd_product_specifications set status = 'withdrawn' where id = 'stability-spec-a' $$,
  'permission denied for table rd_product_specifications', 'authenticated clients cannot mutate an approved specification');
select ok(not has_function_privilege('authenticated', 'public.commit_rd_stability_and_specifications(jsonb)', 'EXECUTE'), 'authenticated cannot execute the stability commit RPC');
reset role;

set local role service_role;
select throws_ok($$ insert into public.rd_stability_programs (id, owner_id, project_id, formulation_version_id, status) values
  ('cross-stability-program', '99999999-9999-4999-8999-999999999999', 'stability-project-a', 'stability-form-b', 'draft') $$,
  '23503', null, 'a stability program cannot link another tenant formulation');
select throws_ok($$ insert into public.rd_stability_observations
  (id, owner_id, project_id, program_id, formulation_version_id, laboratory_result_id, condition_id, timepoint_days, replicate) values
  ('cross-stability-observation', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'stability-project-b', 'stability-program-b', 'stability-form-b', 'stability-lab-a', 'ambient', 0, 1) $$,
  '23503', null, 'a stability observation cannot link another tenant laboratory result');
select throws_ok($$ insert into public.rd_specification_approvals
  (id, owner_id, actor_id, project_id, specification_id, outcome) values
  ('cross-stability-approval', '99999999-9999-4999-8999-999999999999', '99999999-9999-4999-8999-999999999999', 'stability-project-a', 'stability-spec-b', 'approved') $$,
  '23503', null, 'a specification approval cannot link another tenant specification');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}', true);
select results_eq($$ select id from public.rd_stability_programs $$, array['stability-program-b']::text[], 'tenant B sees only its stability program');
select results_eq($$ select id from public.rd_product_specifications $$, array['stability-spec-b']::text[], 'tenant B sees only its product specification');
reset role;

select * from finish();
rollback;
