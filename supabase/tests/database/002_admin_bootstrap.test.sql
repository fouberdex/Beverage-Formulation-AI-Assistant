begin;
select plan(6);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated',
   'bootstrap@example.test', extensions.crypt('test-password-a', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-8444-444444444444', 'authenticated', 'authenticated',
   'other@example.test', extensions.crypt('test-password-b', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

set local role service_role;
select lives_ok($$ select public.ensure_profile('33333333-3333-4333-8333-333333333333', 'Bootstrap User') $$,
  'service role can create an ordinary profile');
select is((select role from public.profiles where id = '33333333-3333-4333-8333-333333333333'),
  'formulator', 'ordinary profile creation never grants admin');
select throws_ok($$ select public.bootstrap_admin('33333333-3333-4333-8333-333333333333', 'wrong@example.test') $$,
  'bootstrap rejects an identity mismatch');
select lives_ok($$ select public.bootstrap_admin('33333333-3333-4333-8333-333333333333', 'BOOTSTRAP@example.test') $$,
  'configured identity can claim the one-time bootstrap');
select is((select role from public.profiles where id = '33333333-3333-4333-8333-333333333333'),
  'admin', 'configured identity becomes administrator');
select throws_ok($$ select public.bootstrap_admin('44444444-4444-4444-8444-444444444444', 'other@example.test') $$,
  'a second identity cannot claim administrator bootstrap');
reset role;

select * from finish();
rollback;
