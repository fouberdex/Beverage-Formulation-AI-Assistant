-- BeverageAI Supabase schema.
-- Public Data API access is opt-in through explicit grants and protected by RLS.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ingredients (
  id text primary key,
  code text not null unique,
  name text not null,
  category text not null,
  is_active boolean not null default true,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.formulations (
  id text primary key,
  owner_id uuid references auth.users(id) on delete cascade,
  code text not null,
  name text not null,
  status text not null default 'draft',
  parent_formulation_id text references public.formulations(id) on delete set null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, code)
);

create table if not exists public.formulation_ingredients (
  formulation_id text not null references public.formulations(id) on delete cascade,
  ingredient_id text not null references public.ingredients(id) on delete restrict,
  owner_id uuid references auth.users(id) on delete cascade,
  percentage numeric(10,6) not null check (percentage > 0 and percentage <= 100),
  display_order integer not null default 0 check (display_order >= 0),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  primary key (formulation_id, ingredient_id)
);

create table if not exists public.ai_variants (
  id text primary key,
  owner_id uuid references auth.users(id) on delete cascade,
  source_formulation_id text not null references public.formulations(id) on delete cascade,
  status text not null default 'generated',
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.compliance_records (
  id text primary key,
  owner_id uuid references auth.users(id) on delete cascade,
  formulation_id text not null unique references public.formulations(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  checked_at timestamptz not null default now()
);

create table if not exists public.batch_cost_calculations (
  id text primary key,
  owner_id uuid references auth.users(id) on delete cascade,
  formulation_id text not null references public.formulations(id) on delete cascade,
  batch_size_liters numeric(14,4) not null check (batch_size_liters > 0),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  calculated_at timestamptz not null default now()
);

create table if not exists public.pricing_history (
  id text primary key,
  ingredient_id text not null references public.ingredients(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  price_per_kg numeric(14,4) not null check (price_per_kg >= 0),
  currency text not null default 'DZD',
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  effective_date timestamptz not null default now()
);

create table if not exists public.target_generation_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  constraints jsonb not null default '{}'::jsonb check (jsonb_typeof(constraints) = 'object'),
  candidates jsonb not null default '[]'::jsonb check (jsonb_typeof(candidates) = 'array'),
  ai_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(ai_metadata) = 'object'),
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  owner_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists idx_ingredients_active_category on public.ingredients(category, name) where is_active;
create index if not exists idx_formulations_owner_updated on public.formulations(owner_id, updated_at desc);
create index if not exists idx_formulations_parent on public.formulations(parent_formulation_id) where parent_formulation_id is not null;
create index if not exists idx_formulation_ingredients_owner on public.formulation_ingredients(owner_id, formulation_id);
create index if not exists idx_formulation_ingredients_ingredient on public.formulation_ingredients(ingredient_id);
create index if not exists idx_ai_variants_owner_source on public.ai_variants(owner_id, source_formulation_id, created_at desc);
create index if not exists idx_ai_variants_source on public.ai_variants(source_formulation_id);
create index if not exists idx_compliance_owner_formulation on public.compliance_records(owner_id, formulation_id);
create index if not exists idx_batch_cost_owner_formulation on public.batch_cost_calculations(owner_id, formulation_id, calculated_at desc);
create index if not exists idx_batch_cost_formulation on public.batch_cost_calculations(formulation_id);
create index if not exists idx_pricing_ingredient_date on public.pricing_history(ingredient_id, effective_date desc);
create index if not exists idx_pricing_created_by on public.pricing_history(created_by) where created_by is not null;
create index if not exists idx_target_runs_owner_created on public.target_generation_runs(owner_id, created_at desc);
create index if not exists idx_audit_owner_created on public.audit_logs(owner_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.ingredients enable row level security;
alter table public.formulations enable row level security;
alter table public.formulation_ingredients enable row level security;
alter table public.ai_variants enable row level security;
alter table public.compliance_records enable row level security;
alter table public.batch_cost_calculations enable row level security;
alter table public.pricing_history enable row level security;
alter table public.target_generation_runs enable row level security;
alter table public.audit_logs enable row level security;

create policy "Public can read active ingredients" on public.ingredients for select to anon, authenticated
  using (is_active);

create policy "Users can read their profile" on public.profiles for select to authenticated
  using ((select auth.uid()) = id);
create policy "Users can create their profile" on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id);
create policy "Users can update their profile" on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "Users can read owned formulations" on public.formulations for select to authenticated
  using ((select auth.uid()) = owner_id or owner_id is null);
create policy "Users can create owned formulations" on public.formulations for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy "Users can update owned formulations" on public.formulations for update to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "Users can delete owned formulations" on public.formulations for delete to authenticated
  using ((select auth.uid()) = owner_id);

create policy "Users can read owned formulation ingredients" on public.formulation_ingredients for select to authenticated
  using ((select auth.uid()) = owner_id or owner_id is null);
create policy "Users can create owned formulation ingredients" on public.formulation_ingredients for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy "Users can update owned formulation ingredients" on public.formulation_ingredients for update to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "Users can delete owned formulation ingredients" on public.formulation_ingredients for delete to authenticated
  using ((select auth.uid()) = owner_id);

create policy "Users can read owned AI variants" on public.ai_variants for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "Users can read owned compliance records" on public.compliance_records for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "Users can read owned batch calculations" on public.batch_cost_calculations for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "Users can read pricing history" on public.pricing_history for select to authenticated
  using (true);
create policy "Users can read owned target runs" on public.target_generation_runs for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "Users can create owned target runs" on public.target_generation_runs for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy "Users can read owned audit logs" on public.audit_logs for select to authenticated
  using ((select auth.uid()) = owner_id);

revoke all on all tables in schema public from anon, authenticated;
grant select on public.ingredients to anon, authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.formulations, public.formulation_ingredients to authenticated;
grant select on public.ai_variants, public.compliance_records, public.batch_cost_calculations,
  public.pricing_history, public.audit_logs to authenticated;
grant select, insert on public.target_generation_runs to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;
