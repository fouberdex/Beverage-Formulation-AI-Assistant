begin;
select plan(10);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'authenticated', 'authenticated', 'quality-a@example.test', extensions.crypt('password-a', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'authenticated', 'authenticated', 'quality-b@example.test', extensions.crypt('password-b', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
insert into public.profiles (id, display_name, role) values
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Quality Tenant A', 'formulator'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'Quality Tenant B', 'formulator');

set local role service_role;
insert into public.rd_projects (id, owner_id, code, name, payload) values
  ('quality-project-a', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'QUAL-A', 'Quality A', '{"id":"quality-project-a"}'),
  ('quality-project-b', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'QUAL-B', 'Quality B', '{"id":"quality-project-b"}');
insert into public.formulations (id, owner_id, code, name, status, payload) values
  ('quality-form-a', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'QUAL-F-A', 'Formula A', 'approved', '{"id":"quality-form-a","project_id":"quality-project-a","version":1}'),
  ('quality-form-b', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'QUAL-F-B', 'Formula B', 'approved', '{"id":"quality-form-b","project_id":"quality-project-b","version":1}');
insert into public.rd_product_specifications (id, owner_id, project_id, formulation_version_id, version, status, payload) values
  ('quality-spec-a', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'quality-project-a', 'quality-form-a', 1, 'approved', '{"id":"quality-spec-a"}'),
  ('quality-spec-b', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'quality-project-b', 'quality-form-b', 1, 'approved', '{"id":"quality-spec-b"}');
insert into public.rd_production_trials (id, owner_id, project_id, formulation_version_id, batch_code, status, payload) values
  ('quality-trial-a', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'quality-project-a', 'quality-form-a', 'BATCH-A', 'completed', '{"id":"quality-trial-a"}'),
  ('quality-trial-a2', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'quality-project-a', 'quality-form-a', 'BATCH-A2', 'completed', '{"id":"quality-trial-a2"}'),
  ('quality-trial-b', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'quality-project-b', 'quality-form-b', 'BATCH-B', 'completed', '{"id":"quality-trial-b"}');
insert into public.rd_qc_releases (id, owner_id, project_id, production_trial_id, formulation_version_id, specification_id, disposition, payload) values
  ('quality-release-a', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'quality-project-a', 'quality-trial-a', 'quality-form-a', 'quality-spec-a', 'released', '{"id":"quality-release-a"}');
insert into public.rd_quality_events (id, owner_id, project_id, production_trial_id, qc_release_id, event_type, status, payload) values
  ('quality-event-a', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'quality-project-a', 'quality-trial-a', 'quality-release-a', 'out_of_specification', 'capa_required', '{"id":"quality-event-a"}');
insert into public.rd_capa_actions (id, owner_id, project_id, quality_event_id, action_type, status, payload) values
  ('quality-capa-a', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'quality-project-a', 'quality-event-a', 'corrective', 'planned', '{"id":"quality-capa-a"}');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"authenticated"}', true);
select results_eq($$ select id from public.rd_production_trials order by id $$, array['quality-trial-a','quality-trial-a2']::text[], 'tenant A sees only its production trials');
select results_eq($$ select id from public.rd_qc_releases $$, array['quality-release-a']::text[], 'tenant A sees only its QC release');
select results_eq($$ select id from public.rd_quality_events $$, array['quality-event-a']::text[], 'tenant A sees only its quality event');
select results_eq($$ select id from public.rd_capa_actions $$, array['quality-capa-a']::text[], 'tenant A sees only its CAPA');
select throws_ok($$ update public.rd_qc_releases set disposition='rejected' where id='quality-release-a' $$, 'permission denied for table rd_qc_releases', 'authenticated clients cannot mutate immutable QC decisions');
select ok(not has_function_privilege('authenticated', 'public.commit_rd_industrial_quality(jsonb)', 'EXECUTE'), 'authenticated cannot execute industrial quality commit RPC');
reset role;

set local role service_role;
select throws_ok($$ insert into public.rd_production_trials (id, owner_id, project_id, formulation_version_id, batch_code, status) values ('cross-trial', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'quality-project-a', 'quality-form-b', 'CROSS', 'planned') $$, '23503', null, 'production trial cannot link another tenant formulation');
select throws_ok($$ insert into public.rd_qc_releases (id, owner_id, project_id, production_trial_id, formulation_version_id, specification_id, disposition) values ('cross-release', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'quality-project-a', 'quality-trial-a2', 'quality-form-a', 'quality-spec-b', 'hold') $$, '23503', null, 'QC release cannot link another tenant specification');
select throws_ok($$ insert into public.rd_quality_events (id, owner_id, project_id, production_trial_id, event_type, status) values ('cross-event', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'quality-project-a', 'quality-trial-b', 'deviation', 'open') $$, '23503', null, 'quality event cannot link another tenant production trial');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee","role":"authenticated"}', true);
select results_eq($$ select id from public.rd_production_trials $$, array['quality-trial-b']::text[], 'tenant B sees only its production trial');
reset role;
select * from finish();
rollback;
