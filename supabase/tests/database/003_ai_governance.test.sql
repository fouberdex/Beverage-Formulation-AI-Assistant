begin;
select plan(12);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated',
   'ai-a@example.test', extensions.crypt('test-password-a', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-8444-444444444444', 'authenticated', 'authenticated',
   'ai-b@example.test', extensions.crypt('test-password-b', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

insert into public.profiles (id, display_name, role) values
  ('33333333-3333-4333-8333-333333333333', 'AI Tenant A', 'formulator'),
  ('44444444-4444-4444-8444-444444444444', 'AI Tenant B', 'formulator');
insert into public.ai_preferences (owner_id, external_processing_enabled) values
  ('33333333-3333-4333-8333-333333333333', true),
  ('44444444-4444-4444-8444-444444444444', false);
insert into public.ai_usage_events (owner_id, request_id, operation, provider, model, outcome) values
  ('33333333-3333-4333-8333-333333333333', 'seed-a', 'variant_review', 'google-gemini', 'test-model', 'succeeded'),
  ('44444444-4444-4444-8444-444444444444', 'seed-b', 'target_review', 'google-gemini', 'test-model', 'failed');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
select results_eq($$ select owner_id from public.ai_preferences $$,
  array['33333333-3333-4333-8333-333333333333']::uuid[], 'tenant A sees only its AI preference');
select is((select count(*)::integer from public.ai_usage_events), 1, 'tenant A sees only its AI usage');
select is((with changed as (update public.ai_preferences set include_formulation_name = true
  where owner_id = '44444444-4444-4444-8444-444444444444' returning 1) select count(*)::integer from changed), 0,
  'tenant A cannot update tenant B AI preferences');
select lives_ok($$ update public.ai_preferences set include_formulation_name = true
  where owner_id = '33333333-3333-4333-8333-333333333333' $$, 'tenant A can update its AI preference');
select throws_ok($$ insert into public.ai_usage_events
  (owner_id, request_id, operation, provider, model) values
  ('33333333-3333-4333-8333-333333333333', 'client-write', 'variant_review', 'x', 'x') $$,
  'permission denied for table ai_usage_events', 'clients cannot forge AI usage events');
select ok(not has_function_privilege('authenticated', 'public.reserve_ai_quota(uuid,text,text,text,text,integer,integer)', 'EXECUTE'),
  'authenticated cannot reserve provider quota directly');
select ok(not has_function_privilege('authenticated', 'public.complete_ai_usage(uuid,bigint,text,integer,integer,integer)', 'EXECUTE'),
  'authenticated cannot complete provider usage directly');
reset role;

set local role service_role;
select results_eq($$ select daily_used from public.reserve_ai_quota(
  '33333333-3333-4333-8333-333333333333', 'request-a-2', 'variant_review', 'google-gemini', 'test-model', 2, 3) $$,
  array[2]::integer[], 'server atomically reserves the remaining daily quota');
select throws_ok($$ select * from public.reserve_ai_quota(
  '33333333-3333-4333-8333-333333333333', 'request-a-3', 'target_review', 'google-gemini', 'test-model', 2, 3) $$,
  'AI_DAILY_QUOTA_EXCEEDED', 'daily quota rejects the next reservation');
select lives_ok($$ select public.complete_ai_usage(
  '33333333-3333-4333-8333-333333333333',
  (select id from public.ai_usage_events where request_id = 'request-a-2'),
  'succeeded', 10, 5, 15) $$, 'server records provider token usage');
select is((select total_tokens from public.ai_usage_events where request_id = 'request-a-2'), 15,
  'token accounting is stored without prompt content');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}', true);
select is((select count(*)::integer from public.ai_usage_events), 1, 'tenant B still sees only its own usage');
reset role;

select * from finish();
rollback;
