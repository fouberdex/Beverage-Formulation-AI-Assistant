begin;
select plan(10);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'authenticated', 'authenticated', 'supply-a@example.test', extensions.crypt('password-a', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'authenticated', 'authenticated', 'supply-b@example.test', extensions.crypt('password-b', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
insert into public.profiles (id, display_name, role) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Supply Tenant A', 'formulator'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Supply Tenant B', 'formulator');

set local role service_role;
insert into public.rd_projects (id, owner_id, code, name, payload) values
  ('supply-project-a', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'SUP-A', 'Supply A', '{"id":"supply-project-a"}'),
  ('supply-project-b', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'SUP-B', 'Supply B', '{"id":"supply-project-b"}');
insert into public.formulations (id, owner_id, code, name, status, payload) values
  ('supply-form-a', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'SUP-F-A', 'Formula A', 'approved', '{"id":"supply-form-a","project_id":"supply-project-a","version":1}'),
  ('supply-form-b', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'SUP-F-B', 'Formula B', 'approved', '{"id":"supply-form-b","project_id":"supply-project-b","version":1}');
insert into public.rd_suppliers (id, owner_id, name, status, payload) values
  ('supplier-a', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Supplier A', 'qualified', '{"id":"supplier-a"}'),
  ('supplier-b', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Supplier B', 'qualified', '{"id":"supplier-b"}');
insert into public.rd_supplier_materials (id, owner_id, supplier_id, material_code, status, payload) values
  ('material-a', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'supplier-a', 'MAT-A', 'approved', '{"id":"material-a"}'),
  ('material-b', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'supplier-b', 'MAT-B', 'approved', '{"id":"material-b"}');
insert into public.rd_material_specifications (id, owner_id, supplier_material_id, version, status, payload) values
  ('material-spec-a', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'material-a', 1, 'approved', '{"id":"material-spec-a"}');
insert into public.rd_documents (id, owner_id, project_id, supplier_id, supplier_material_id, document_type, sha256, review_status, payload) values
  ('document-a', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'supply-project-a', 'supplier-a', 'material-a', 'technical_data_sheet', repeat('a',64), 'accepted', '{"id":"document-a"}');
insert into public.rd_packaging_components (id, owner_id, supplier_id, code, status, payload) values
  ('component-a', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'supplier-a', 'PACK-A', 'approved', '{"id":"component-a"}');
insert into public.rd_packaging_configurations (id, owner_id, project_id, formulation_version_id, version, status, payload) values
  ('configuration-a', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'supply-project-a', 'supply-form-a', 1, 'approved', '{"id":"configuration-a"}');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}', true);
select results_eq($$ select id from public.rd_suppliers $$, array['supplier-a']::text[], 'tenant A sees only its suppliers');
select results_eq($$ select id from public.rd_supplier_materials $$, array['material-a']::text[], 'tenant A sees only its supplier materials');
select results_eq($$ select id from public.rd_documents $$, array['document-a']::text[], 'tenant A sees only its controlled documents');
select results_eq($$ select id from public.rd_packaging_components $$, array['component-a']::text[], 'tenant A sees only its packaging components');
select results_eq($$ select id from public.rd_packaging_configurations $$, array['configuration-a']::text[], 'tenant A sees only its packaging configurations');
select throws_ok($$ update public.rd_documents set review_status='rejected' where id='document-a' $$, 'permission denied for table rd_documents', 'authenticated clients cannot mutate reviewed documents');
select ok(not has_function_privilege('authenticated', 'public.commit_rd_suppliers_documents_packaging(jsonb)', 'EXECUTE'), 'authenticated cannot execute supply-chain commit RPC');
reset role;

set local role service_role;
select throws_ok($$ insert into public.rd_supplier_materials (id, owner_id, supplier_id, material_code, status) values ('cross-material', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'supplier-b', 'CROSS', 'candidate') $$, '23503', null, 'supplier material cannot cross tenant ownership');
select throws_ok($$ insert into public.rd_packaging_configurations (id, owner_id, project_id, formulation_version_id, version, status) values ('cross-pack', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'supply-project-a', 'supply-form-b', 1, 'draft') $$, '23503', null, 'packaging configuration cannot link another tenant formulation');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated"}', true);
select results_eq($$ select id from public.rd_suppliers $$, array['supplier-b']::text[], 'tenant B sees only its suppliers');
reset role;
select * from finish();
rollback;
