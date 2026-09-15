begin;
select plan(3);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'authenticated', 'authenticated',
   'role-test@example.test', extensions.crypt('test-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

set local role service_role;

insert into public.profiles (id, display_name, role)
values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Role Test', 'lab');

select is(
  (select role from public.profiles where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
  'lab',
  'the expanded role constraint accepts a specialist role'
);

select lives_ok(
  $$ update public.profiles set role = 'qa' where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' $$,
  'the service role can assign another supported specialist role'
);

select throws_ok(
  $$ update public.profiles set role = 'superuser' where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' $$,
  '23514',
  null,
  'unsupported roles are rejected by the database'
);

select * from finish();
rollback;
