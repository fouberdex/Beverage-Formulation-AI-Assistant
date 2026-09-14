begin;
select plan(10);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000', '77777777-7777-4777-8777-777777777777', 'authenticated', 'authenticated',
   'projects-a@example.test', extensions.crypt('test-password-a', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '88888888-8888-4888-8888-888888888888', 'authenticated', 'authenticated',
   'projects-b@example.test', extensions.crypt('test-password-b', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

insert into public.profiles (id, display_name, role) values
  ('77777777-7777-4777-8777-777777777777', 'Projects Tenant A', 'formulator'),
  ('88888888-8888-4888-8888-888888888888', 'Projects Tenant B', 'formulator');

set local role service_role;
insert into public.rd_projects (id, owner_id, code, name, payload) values
  ('project-a', '77777777-7777-4777-8777-777777777777', 'RD-A', 'Project A', '{"id":"project-a"}'),
  ('project-b', '88888888-8888-4888-8888-888888888888', 'RD-B', 'Project B', '{"id":"project-b"}');
insert into public.rd_project_events (id, owner_id, project_id, event_type, payload) values
  ('event-a', '77777777-7777-4777-8777-777777777777', 'project-a', 'created', '{"id":"event-a"}'),
  ('event-b', '88888888-8888-4888-8888-888888888888', 'project-b', 'created', '{"id":"event-b"}');
insert into public.formulations (id, owner_id, code, name, status, payload) values
  ('trace-form-a', '77777777-7777-4777-8777-777777777777', 'TRACE-A', 'Trace A', 'approved', '{"id":"trace-form-a","project_id":"project-a","version":1}'),
  ('trace-form-b', '88888888-8888-4888-8888-888888888888', 'TRACE-B', 'Trace B', 'approved', '{"id":"trace-form-b","project_id":"project-b","version":1}');
insert into public.laboratory_results (id, owner_id, formulation_id, payload) values
  ('trace-lab-a', '77777777-7777-4777-8777-777777777777', 'trace-form-a', '{"id":"trace-lab-a","project_id":"project-a","formulation_version_id":"trace-form-a"}');
insert into public.sensory_studies (id, owner_id, status, payload) values
  ('trace-study-a', '77777777-7777-4777-8777-777777777777', 'draft', '{"id":"trace-study-a","project_id":"project-a"}');
insert into public.sensory_study_formulation_versions (owner_id, study_id, project_id, formulation_version_id, sample_id) values
  ('77777777-7777-4777-8777-777777777777', 'trace-study-a', 'project-a', 'trace-form-a', 'sample-a');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated"}', true);
select results_eq($$ select id from public.rd_projects $$, array['project-a']::text[], 'tenant A sees only its R&D project');
select results_eq($$ select id from public.rd_project_events $$, array['event-a']::text[], 'tenant A sees only its project event');
select results_eq($$ select formulation_version_id from public.laboratory_results $$, array['trace-form-a']::text[], 'tenant A lab result exposes its exact formulation version');
select results_eq($$ select formulation_version_id from public.sensory_study_formulation_versions $$, array['trace-form-a']::text[], 'tenant A sensory link exposes its exact formulation version');
select throws_ok($$ insert into public.rd_projects (id, owner_id, code, name) values
  ('client-project', '77777777-7777-4777-8777-777777777777', 'RD-CLIENT', 'Client project') $$,
  'permission denied for table rd_projects', 'authenticated clients cannot bypass the project API');
select ok(not has_function_privilege('authenticated', 'public.commit_rd_project_data(jsonb)', 'EXECUTE'), 'authenticated cannot execute project commit RPC');
reset role;

set local role service_role;
select throws_ok($$ insert into public.rd_project_events (id, owner_id, project_id, event_type) values
  ('cross-owner', '77777777-7777-4777-8777-777777777777', 'project-b', 'updated') $$,
  '23503', null, 'composite foreign key rejects a project event attached across owners');
select throws_ok($$ insert into public.rd_projects (id, owner_id, code, name) values
  ('duplicate-code', '77777777-7777-4777-8777-777777777777', 'RD-A', 'Duplicate') $$,
  '23505', null, 'project code is unique within an owner workspace');
select throws_ok($$ insert into public.sensory_study_formulation_versions (owner_id, study_id, project_id, formulation_version_id, sample_id) values
  ('77777777-7777-4777-8777-777777777777', 'trace-study-a', 'project-a', 'trace-form-b', 'cross-version') $$,
  '23503', null, 'sensory study cannot link a formulation version from another project or owner');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"88888888-8888-4888-8888-888888888888","role":"authenticated"}', true);
select results_eq($$ select id from public.rd_projects $$, array['project-b']::text[], 'tenant B sees only its R&D project');
reset role;

select * from finish();
rollback;
