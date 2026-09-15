create table public.rd_suppliers (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  status text not null check (status in ('prospect', 'qualified', 'conditionally_qualified', 'suspended', 'rejected')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (owner_id, id), unique (owner_id, name)
);

create table public.rd_supplier_materials (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  supplier_id text not null,
  material_code text not null,
  status text not null check (status in ('candidate', 'approved', 'restricted', 'discontinued')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (owner_id, id), unique (owner_id, supplier_id, material_code),
  foreign key (owner_id, supplier_id) references public.rd_suppliers(owner_id, id) on delete restrict
);

create table public.rd_material_specifications (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  supplier_material_id text not null,
  version integer not null check (version > 0),
  status text not null check (status in ('draft', 'approved', 'superseded', 'withdrawn')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (owner_id, id), unique (owner_id, supplier_material_id, version),
  foreign key (owner_id, supplier_material_id) references public.rd_supplier_materials(owner_id, id) on delete restrict
);

create table public.rd_documents (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id text,
  supplier_id text,
  supplier_material_id text,
  document_type text not null,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  review_status text not null check (review_status in ('pending', 'accepted', 'rejected', 'expired')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (owner_id, id), unique (owner_id, sha256),
  foreign key (owner_id, project_id) references public.rd_projects(owner_id, id) on delete cascade,
  foreign key (owner_id, supplier_id) references public.rd_suppliers(owner_id, id) on delete restrict,
  foreign key (owner_id, supplier_material_id) references public.rd_supplier_materials(owner_id, id) on delete restrict
);

create table public.rd_packaging_components (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  supplier_id text,
  code text not null,
  status text not null check (status in ('candidate', 'approved', 'restricted', 'discontinued')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (owner_id, id), unique (owner_id, code),
  foreign key (owner_id, supplier_id) references public.rd_suppliers(owner_id, id) on delete restrict
);

create table public.rd_packaging_configurations (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id text not null,
  formulation_version_id text not null,
  version integer not null check (version > 0),
  status text not null check (status in ('draft', 'approved', 'superseded', 'withdrawn')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (owner_id, project_id, id), unique (owner_id, project_id, formulation_version_id, version),
  foreign key (owner_id, project_id) references public.rd_projects(owner_id, id) on delete cascade,
  foreign key (owner_id, project_id, formulation_version_id) references public.formulations(owner_id, project_id, id) on delete restrict
);

create index idx_rd_supplier_materials_supplier on public.rd_supplier_materials(owner_id, supplier_id, updated_at desc);
create index idx_rd_material_specs_material on public.rd_material_specifications(owner_id, supplier_material_id, version desc);
create index idx_rd_documents_project on public.rd_documents(owner_id, project_id, updated_at desc);
create index idx_rd_documents_supplier on public.rd_documents(owner_id, supplier_id, updated_at desc);
create index idx_rd_packaging_config_project on public.rd_packaging_configurations(owner_id, project_id, formulation_version_id, version desc);

alter table public.rd_suppliers enable row level security;
alter table public.rd_supplier_materials enable row level security;
alter table public.rd_material_specifications enable row level security;
alter table public.rd_documents enable row level security;
alter table public.rd_packaging_components enable row level security;
alter table public.rd_packaging_configurations enable row level security;

create policy "Users can read owned suppliers" on public.rd_suppliers for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Users can read owned supplier materials" on public.rd_supplier_materials for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Users can read owned material specifications" on public.rd_material_specifications for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Users can read owned documents" on public.rd_documents for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Users can read owned packaging components" on public.rd_packaging_components for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Users can read owned packaging configurations" on public.rd_packaging_configurations for select to authenticated using ((select auth.uid()) = owner_id);

grant select on public.rd_suppliers, public.rd_supplier_materials, public.rd_material_specifications, public.rd_documents, public.rd_packaging_components, public.rd_packaging_configurations to authenticated;
grant all on public.rd_suppliers, public.rd_supplier_materials, public.rd_material_specifications, public.rd_documents, public.rd_packaging_components, public.rd_packaging_configurations to service_role;

create function public.commit_rd_suppliers_documents_packaging(p_changes jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare item jsonb;
begin
  for item in select value from pg_catalog.jsonb_array_elements(coalesce(p_changes->'rdSuppliers', '[]'::jsonb)) loop
    insert into public.rd_suppliers (id, owner_id, name, status, payload, created_at, updated_at)
    values (item->>'id', nullif(item->>'owner_id','')::uuid, item->>'name', item->>'status', item, coalesce(nullif(item->>'created_at','')::timestamptz, now()), coalesce(nullif(item->>'updated_at','')::timestamptz, now()))
    on conflict (id) do update set name=excluded.name, status=excluded.status, payload=excluded.payload, updated_at=excluded.updated_at;
  end loop;
  for item in select value from pg_catalog.jsonb_array_elements(coalesce(p_changes->'rdSupplierMaterials', '[]'::jsonb)) loop
    insert into public.rd_supplier_materials (id, owner_id, supplier_id, material_code, status, payload, created_at, updated_at)
    values (item->>'id', nullif(item->>'owner_id','')::uuid, item->>'supplier_id', item->>'material_code', item->>'status', item, coalesce(nullif(item->>'created_at','')::timestamptz, now()), coalesce(nullif(item->>'updated_at','')::timestamptz, now()))
    on conflict (id) do update set material_code=excluded.material_code, status=excluded.status, payload=excluded.payload, updated_at=excluded.updated_at;
  end loop;
  for item in select value from pg_catalog.jsonb_array_elements(coalesce(p_changes->'rdMaterialSpecifications', '[]'::jsonb)) loop
    insert into public.rd_material_specifications (id, owner_id, supplier_material_id, version, status, payload, created_at, updated_at)
    values (item->>'id', nullif(item->>'owner_id','')::uuid, item->>'supplier_material_id', (item->>'version')::integer, item->>'status', item, coalesce(nullif(item->>'created_at','')::timestamptz, now()), coalesce(nullif(item->>'updated_at','')::timestamptz, now()))
    on conflict (id) do update set status=excluded.status, payload=excluded.payload, updated_at=excluded.updated_at;
  end loop;
  for item in select value from pg_catalog.jsonb_array_elements(coalesce(p_changes->'rdDocuments', '[]'::jsonb)) loop
    insert into public.rd_documents (id, owner_id, project_id, supplier_id, supplier_material_id, document_type, sha256, review_status, payload, created_at, updated_at)
    values (item->>'id', nullif(item->>'owner_id','')::uuid, nullif(item->>'project_id',''), nullif(item->>'supplier_id',''), nullif(item->>'supplier_material_id',''), item->>'document_type', item->>'sha256', item->>'review_status', item, coalesce(nullif(item->>'created_at','')::timestamptz, now()), coalesce(nullif(item->>'updated_at','')::timestamptz, now()))
    on conflict (id) do update set review_status=excluded.review_status, payload=excluded.payload, updated_at=excluded.updated_at;
  end loop;
  for item in select value from pg_catalog.jsonb_array_elements(coalesce(p_changes->'rdPackagingComponents', '[]'::jsonb)) loop
    insert into public.rd_packaging_components (id, owner_id, supplier_id, code, status, payload, created_at, updated_at)
    values (item->>'id', nullif(item->>'owner_id','')::uuid, nullif(item->>'supplier_id',''), item->>'code', item->>'status', item, coalesce(nullif(item->>'created_at','')::timestamptz, now()), coalesce(nullif(item->>'updated_at','')::timestamptz, now()))
    on conflict (id) do update set supplier_id=excluded.supplier_id, code=excluded.code, status=excluded.status, payload=excluded.payload, updated_at=excluded.updated_at;
  end loop;
  for item in select value from pg_catalog.jsonb_array_elements(coalesce(p_changes->'rdPackagingConfigurations', '[]'::jsonb)) loop
    insert into public.rd_packaging_configurations (id, owner_id, project_id, formulation_version_id, version, status, payload, created_at, updated_at)
    values (item->>'id', nullif(item->>'owner_id','')::uuid, item->>'project_id', item->>'formulation_version_id', (item->>'version')::integer, item->>'status', item, coalesce(nullif(item->>'created_at','')::timestamptz, now()), coalesce(nullif(item->>'updated_at','')::timestamptz, now()))
    on conflict (id) do update set status=excluded.status, payload=excluded.payload, updated_at=excluded.updated_at;
  end loop;
end;
$$;

revoke all on function public.commit_rd_suppliers_documents_packaging(jsonb) from public, anon, authenticated;
grant execute on function public.commit_rd_suppliers_documents_packaging(jsonb) to service_role;

alter function public.commit_request_changes(jsonb) rename to commit_request_changes_before_rd_supply_chain;
create function public.commit_request_changes(p_changes jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform public.commit_request_changes_before_rd_supply_chain(p_changes);
  perform public.commit_rd_suppliers_documents_packaging(p_changes);
end;
$$;
revoke all on function public.commit_request_changes_before_rd_supply_chain(jsonb) from public, anon, authenticated;
revoke all on function public.commit_request_changes(jsonb) from public, anon, authenticated;
grant execute on function public.commit_request_changes(jsonb) to service_role;
