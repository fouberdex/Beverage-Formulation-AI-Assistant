create table public.rd_stability_programs (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id text not null,
  formulation_version_id text not null,
  status text not null check (status in ('draft', 'running', 'completed', 'cancelled')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, project_id, id),
  foreign key (owner_id, project_id) references public.rd_projects(owner_id, id) on delete cascade,
  foreign key (owner_id, project_id, formulation_version_id) references public.formulations(owner_id, project_id, id) on delete restrict
);

create table public.rd_stability_observations (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id text not null,
  program_id text not null,
  formulation_version_id text not null,
  laboratory_result_id text not null,
  condition_id text not null,
  timepoint_days integer not null check (timepoint_days >= 0),
  replicate integer not null check (replicate between 1 and 20),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  recorded_at timestamptz not null default now(),
  unique (owner_id, laboratory_result_id),
  unique (owner_id, project_id, program_id, condition_id, timepoint_days, replicate),
  foreign key (owner_id, project_id, program_id) references public.rd_stability_programs(owner_id, project_id, id) on delete restrict,
  foreign key (owner_id, project_id, formulation_version_id) references public.formulations(owner_id, project_id, id) on delete restrict,
  foreign key (owner_id, laboratory_result_id) references public.laboratory_results(owner_id, id) on delete restrict
);

create table public.rd_product_specifications (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id text not null,
  formulation_version_id text not null,
  version integer not null check (version > 0),
  status text not null check (status in ('draft', 'approved', 'superseded', 'withdrawn')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, project_id, id),
  unique (owner_id, project_id, formulation_version_id, version),
  foreign key (owner_id, project_id) references public.rd_projects(owner_id, id) on delete cascade,
  foreign key (owner_id, project_id, formulation_version_id) references public.formulations(owner_id, project_id, id) on delete restrict
);

create table public.rd_specification_approvals (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete restrict,
  project_id text not null,
  specification_id text not null,
  outcome text not null check (outcome in ('approved', 'withdrawn')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  decided_at timestamptz not null default now(),
  unique (owner_id, project_id, id),
  foreign key (owner_id, project_id, specification_id) references public.rd_product_specifications(owner_id, project_id, id) on delete restrict
);

create index idx_rd_stability_programs_project on public.rd_stability_programs(owner_id, project_id, updated_at desc);
create index idx_rd_stability_observations_program on public.rd_stability_observations(owner_id, project_id, program_id, timepoint_days);
create index idx_rd_product_specifications_project on public.rd_product_specifications(owner_id, project_id, formulation_version_id, version desc);
create index idx_rd_specification_approvals_specification on public.rd_specification_approvals(owner_id, project_id, specification_id, decided_at desc);

alter table public.rd_stability_programs enable row level security;
alter table public.rd_stability_observations enable row level security;
alter table public.rd_product_specifications enable row level security;
alter table public.rd_specification_approvals enable row level security;

create policy "Users can read owned stability programs" on public.rd_stability_programs for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Users can read owned stability observations" on public.rd_stability_observations for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Users can read owned product specifications" on public.rd_product_specifications for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Users can read owned specification approvals" on public.rd_specification_approvals for select to authenticated using ((select auth.uid()) = owner_id);

grant select on public.rd_stability_programs, public.rd_stability_observations, public.rd_product_specifications, public.rd_specification_approvals to authenticated;
grant all on public.rd_stability_programs, public.rd_stability_observations, public.rd_product_specifications, public.rd_specification_approvals to service_role;

create function public.commit_rd_stability_and_specifications(p_changes jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare item jsonb;
begin
  for item in select value from pg_catalog.jsonb_array_elements(coalesce(p_changes->'rdStabilityPrograms', '[]'::jsonb)) loop
    insert into public.rd_stability_programs (id, owner_id, project_id, formulation_version_id, status, payload, created_at, updated_at)
    values (item->>'id', nullif(item->>'owner_id', '')::uuid, item->>'project_id', item->>'formulation_version_id', item->>'status', item,
      coalesce(nullif(item->>'created_at', '')::timestamptz, pg_catalog.now()), coalesce(nullif(item->>'updated_at', '')::timestamptz, pg_catalog.now()))
    on conflict (id) do update set status = excluded.status, payload = excluded.payload, updated_at = excluded.updated_at;
  end loop;

  for item in select value from pg_catalog.jsonb_array_elements(coalesce(p_changes->'rdStabilityObservations', '[]'::jsonb)) loop
    insert into public.rd_stability_observations (id, owner_id, project_id, program_id, formulation_version_id, laboratory_result_id, condition_id, timepoint_days, replicate, payload, recorded_at)
    values (item->>'id', nullif(item->>'owner_id', '')::uuid, item->>'project_id', item->>'program_id', item->>'formulation_version_id', item->>'laboratory_result_id', item->>'condition_id', (item->>'timepoint_days')::integer, (item->>'replicate')::integer, item,
      coalesce(nullif(item->>'recorded_at', '')::timestamptz, pg_catalog.now()))
    on conflict (id) do nothing;
  end loop;

  for item in select value from pg_catalog.jsonb_array_elements(coalesce(p_changes->'rdProductSpecifications', '[]'::jsonb)) loop
    insert into public.rd_product_specifications (id, owner_id, project_id, formulation_version_id, version, status, payload, created_at, updated_at)
    values (item->>'id', nullif(item->>'owner_id', '')::uuid, item->>'project_id', item->>'formulation_version_id', (item->>'version')::integer, item->>'status', item,
      coalesce(nullif(item->>'created_at', '')::timestamptz, pg_catalog.now()), coalesce(nullif(item->>'updated_at', '')::timestamptz, pg_catalog.now()))
    on conflict (id) do update set status = excluded.status, payload = excluded.payload, updated_at = excluded.updated_at;
  end loop;

  for item in select value from pg_catalog.jsonb_array_elements(coalesce(p_changes->'rdSpecificationApprovals', '[]'::jsonb)) loop
    insert into public.rd_specification_approvals (id, owner_id, actor_id, project_id, specification_id, outcome, payload, decided_at)
    values (item->>'id', nullif(item->>'owner_id', '')::uuid, nullif(item->>'actor_id', '')::uuid, item->>'project_id', item->>'specification_id', item->>'outcome', item,
      coalesce(nullif(item->>'decided_at', '')::timestamptz, pg_catalog.now()))
    on conflict (id) do nothing;
  end loop;
end;
$$;

revoke all on function public.commit_rd_stability_and_specifications(jsonb) from public, anon, authenticated;
grant execute on function public.commit_rd_stability_and_specifications(jsonb) to service_role;

alter function public.commit_request_changes(jsonb) rename to commit_request_changes_before_rd_stability;
create function public.commit_request_changes(p_changes jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform public.commit_request_changes_before_rd_stability(p_changes);
  perform public.commit_rd_stability_and_specifications(p_changes);
end;
$$;

revoke all on function public.commit_request_changes_before_rd_stability(jsonb) from public, anon, authenticated;
revoke all on function public.commit_request_changes(jsonb) from public, anon, authenticated;
grant execute on function public.commit_request_changes(jsonb) to service_role;
