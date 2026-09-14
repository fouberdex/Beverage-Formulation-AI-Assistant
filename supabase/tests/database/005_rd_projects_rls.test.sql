begin;
select plan(7);

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
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated"}', true);
select results_eq($$ select id from public.rd_projects $$, array['project-a']::text[], 'tenant A sees only its R&D project');
select results_eq($$ select id from public.rd_project_events $$, array['event-a']::text[], 'tenant A sees only its project event');
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
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"88888888-8888-4888-8888-888888888888","role":"authenticated"}', true);
select results_eq($$ select id from public.rd_projects $$, array['project-b']::text[], 'tenant B sees only its R&D project');
reset role;

select * from finish();
rollback;
