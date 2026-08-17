-- Local-development seed data must remain tenant neutral. Do not insert Auth
-- users, profiles, formulations, audit events, or any other owner-scoped row.
insert into public.ingredients (id, code, name, category, is_active, payload)
values
  ('ing-water-001', 'WATER-001', 'Purified Water', 'base', true,
   '{"name_en":"Purified Water","price_per_kg":5,"currency":"DZD","calories_per_100g":0,"sugar_per_100g":0,"halal":true,"vegan":true,"regulatory_status":"approved","max_percentage":100,"source_scope":"Local development seed; verify supplier specifications before production use."}'::jsonb),
  ('ing-sweet-001', 'SWEET-001', 'Cane Sugar', 'sweetener', true,
   '{"name_en":"Cane Sugar","price_per_kg":120,"currency":"DZD","calories_per_100g":387,"sugar_per_100g":100,"halal":true,"vegan":true,"regulatory_status":"approved","max_percentage":20,"source_scope":"Local development seed; verify supplier specifications before production use."}'::jsonb),
  ('ing-acid-001', 'ACID-001', 'Citric Acid', 'acidulant', true,
   '{"name_en":"Citric Acid","price_per_kg":150,"currency":"DZD","calories_per_100g":0,"sugar_per_100g":0,"halal":true,"vegan":true,"regulatory_status":"approved","max_percentage":1,"source_scope":"Local development seed; verify supplier specifications before production use."}'::jsonb),
  ('ing-flav-001', 'FLAV-001', 'Orange Flavor', 'flavor', true,
   '{"name_en":"Orange Flavor","price_per_kg":450,"currency":"DZD","calories_per_100g":0,"sugar_per_100g":0,"halal":true,"vegan":true,"regulatory_status":"approved","max_percentage":2,"source_scope":"Local development seed; verify supplier specifications before production use."}'::jsonb),
  ('ing-pres-001', 'PRES-001', 'Sodium Benzoate', 'preservative', true,
   '{"name_en":"Sodium Benzoate","price_per_kg":180,"currency":"DZD","calories_per_100g":0,"sugar_per_100g":0,"halal":true,"vegan":true,"regulatory_status":"approved","max_percentage":0.1,"source_scope":"Local development seed; verify supplier specifications before production use."}'::jsonb),
  ('ing-retired-test', 'TEST-INACTIVE-001', 'Inactive Test Ingredient', 'test', false,
   '{"source_scope":"Local RLS visibility test only."}'::jsonb)
on conflict (id) do update set
  code = excluded.code,
  name = excluded.name,
  category = excluded.category,
  is_active = excluded.is_active,
  payload = excluded.payload,
  updated_at = pg_catalog.now();
