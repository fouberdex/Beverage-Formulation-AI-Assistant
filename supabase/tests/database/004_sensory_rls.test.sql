begin;
select plan(7);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-4555-8555-555555555555', 'authenticated', 'authenticated',
   'sensory-a@example.test', extensions.crypt('test-password-a', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '66666666-6666-4666-8666-666666666666', 'authenticated', 'authenticated',
   'sensory-b@example.test', extensions.crypt('test-password-b', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

insert into public.profiles (id, display_name, role) values
  ('55555555-5555-4555-8555-555555555555', 'Sensory Tenant A', 'formulator'),
  ('66666666-6666-4666-8666-666666666666', 'Sensory Tenant B', 'formulator');

set local role service_role;
insert into public.sensory_studies (id, owner_id, status, payload) values
  ('study-a', '55555555-5555-4555-8555-555555555555', 'active', '{"id":"study-a","name":"A"}'),
  ('study-b', '66666666-6666-4666-8666-666666666666', 'active', '{"id":"study-b","name":"B"}');
insert into public.sensory_responses (id, owner_id, study_id, panelist_code, payload) values
  ('response-a', '55555555-5555-4555-8555-555555555555', 'study-a', 'P-A', '{"id":"response-a"}'),
  ('response-b', '66666666-6666-4666-8666-666666666666', 'study-b', 'P-B', '{"id":"response-b"}');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}', true);
select results_eq($$ select id from public.sensory_studies $$, array['study-a']::text[], 'tenant A sees only its sensory study');
select results_eq($$ select id from public.sensory_responses $$, array['response-a']::text[], 'tenant A sees only its sensory response');
select throws_ok($$ insert into public.sensory_studies (id, owner_id, payload) values
  ('client-study', '55555555-5555-4555-8555-555555555555', '{}') $$,
  'permission denied for table sensory_studies', 'authenticated clients cannot bypass the server study workflow');
select ok(not has_function_privilege('authenticated', 'public.commit_sensory_data(jsonb)', 'EXECUTE'), 'authenticated cannot execute sensory commit RPC');
reset role;

set local role service_role;
select throws_ok($$ insert into public.sensory_responses (id, owner_id, study_id, panelist_code, payload) values
  ('cross-owner', '55555555-5555-4555-8555-555555555555', 'study-b', 'P-X', '{}') $$,
  '23503', null, 'composite foreign key rejects a response attached across owners');
select throws_ok($$ insert into public.sensory_responses (id, owner_id, study_id, panelist_code, payload) values
  ('duplicate-panelist', '55555555-5555-4555-8555-555555555555', 'study-a', 'P-A', '{}') $$,
  '23505', null, 'panelist code is unique within an owned study');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"66666666-6666-4666-8666-666666666666","role":"authenticated"}', true);
select results_eq($$ select id from public.sensory_studies $$, array['study-b']::text[], 'tenant B sees only its sensory study');
reset role;

select * from finish();
rollback;
