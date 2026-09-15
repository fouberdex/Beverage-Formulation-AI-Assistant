create table public.rd_experimental_plans (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id text not null,
  formulation_version_id text not null,
  status text not null check (status in ('draft', 'ready', 'running', 'completed', 'cancelled')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, project_id, id),
  foreign key (owner_id, project_id) references public.rd_projects(owner_id, id) on delete cascade,
  foreign key (owner_id, project_id, formulation_version_id) references public.formulations(owner_id, project_id, id) on delete restrict
);

create table public.rd_pilot_batches (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id text not null,
  experimental_plan_id text not null,
  formulation_version_id text not null,
  batch_code text not null,
  status text not null check (status in ('planned', 'in_progress', 'completed', 'rejected')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, project_id, batch_code),
  unique (owner_id, project_id, id),
  foreign key (owner_id, project_id) references public.rd_projects(owner_id, id) on delete cascade,
  foreign key (owner_id, project_id, experimental_plan_id) references public.rd_experimental_plans(owner_id, project_id, id) on delete restrict,
  foreign key (owner_id, project_id, formulation_version_id) references public.formulations(owner_id, project_id, id) on delete restrict
);

create table public.rd_project_milestones (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id text not null,
  stage text not null check (stage in ('brief', 'concept', 'formulation', 'laboratory', 'sensory', 'validation', 'industrialization', 'launched')),
  status text not null check (status in ('planned', 'in_progress', 'completed', 'blocked')),
  due_date date,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, project_id, id),
  foreign key (owner_id, project_id) references public.rd_projects(owner_id, id) on delete cascade
);

create table public.rd_project_decisions (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete restrict,
  project_id text not null,
  formulation_version_id text,
  milestone_id text,
  outcome text not null check (outcome in ('go', 'no_go', 'hold', 'rework')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  decided_at timestamptz not null default now(),
  unique (owner_id, project_id, id),
  foreign key (owner_id, project_id) references public.rd_projects(owner_id, id) on delete cascade,
  foreign key (owner_id, project_id, formulation_version_id) references public.formulations(owner_id, project_id, id) on delete restrict,
  foreign key (owner_id, project_id, milestone_id) references public.rd_project_milestones(owner_id, project_id, id) on delete restrict
);

create index idx_rd_experimental_plans_project on public.rd_experimental_plans(owner_id, project_id, updated_at desc);
create index idx_rd_pilot_batches_project on public.rd_pilot_batches(owner_id, project_id, updated_at desc);
create index idx_rd_project_milestones_project on public.rd_project_milestones(owner_id, project_id, due_date);
create index idx_rd_project_decisions_project on public.rd_project_decisions(owner_id, project_id, decided_at desc);

alter table public.rd_experimental_plans enable row level security;
alter table public.rd_pilot_batches enable row level security;
alter table public.rd_project_milestones enable row level security;
alter table public.rd_project_decisions enable row level security;

create policy "Users can read owned R&D experimental plans" on public.rd_experimental_plans for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Users can read owned R&D pilot batches" on public.rd_pilot_batches for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Users can read owned R&D milestones" on public.rd_project_milestones for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Users can read owned R&D decisions" on public.rd_project_decisions for select to authenticated using ((select auth.uid()) = owner_id);

grant select on public.rd_experimental_plans, public.rd_pilot_batches, public.rd_project_milestones, public.rd_project_decisions to authenticated;
grant all on public.rd_experimental_plans, public.rd_pilot_batches, public.rd_project_milestones, public.rd_project_decisions to service_role;

create function public.commit_rd_execution_loop(p_changes jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare item jsonb;
begin
  for item in select value from pg_catalog.jsonb_array_elements(coalesce(p_changes->'rdExperimentalPlans', '[]'::jsonb)) loop
    insert into public.rd_experimental_plans (id, owner_id, project_id, formulation_version_id, status, payload, created_at, updated_at)
    values (item->>'id', nullif(item->>'owner_id', '')::uuid, item->>'project_id', item->>'formulation_version_id', item->>'status', item,
      coalesce(nullif(item->>'created_at', '')::timestamptz, pg_catalog.now()), coalesce(nullif(item->>'updated_at', '')::timestamptz, pg_catalog.now()))
    on conflict (id) do update set formulation_version_id = excluded.formulation_version_id, status = excluded.status, payload = excluded.payload, updated_at = excluded.updated_at;
  end loop;

  for item in select value from pg_catalog.jsonb_array_elements(coalesce(p_changes->'rdPilotBatches', '[]'::jsonb)) loop
    insert into public.rd_pilot_batches (id, owner_id, project_id, experimental_plan_id, formulation_version_id, batch_code, status, payload, created_at, updated_at)
    values (item->>'id', nullif(item->>'owner_id', '')::uuid, item->>'project_id', item->>'experimental_plan_id', item->>'formulation_version_id', item->>'batch_code', item->>'status', item,
      coalesce(nullif(item->>'created_at', '')::timestamptz, pg_catalog.now()), coalesce(nullif(item->>'updated_at', '')::timestamptz, pg_catalog.now()))
    on conflict (id) do update set status = excluded.status, payload = excluded.payload, updated_at = excluded.updated_at;
  end loop;

  for item in select value from pg_catalog.jsonb_array_elements(coalesce(p_changes->'rdProjectMilestones', '[]'::jsonb)) loop
    insert into public.rd_project_milestones (id, owner_id, project_id, stage, status, due_date, payload, created_at, updated_at)
    values (item->>'id', nullif(item->>'owner_id', '')::uuid, item->>'project_id', item->>'stage', item->>'status', nullif(item->>'due_date', '')::date, item,
      coalesce(nullif(item->>'created_at', '')::timestamptz, pg_catalog.now()), coalesce(nullif(item->>'updated_at', '')::timestamptz, pg_catalog.now()))
    on conflict (id) do update set stage = excluded.stage, status = excluded.status, due_date = excluded.due_date, payload = excluded.payload, updated_at = excluded.updated_at;
  end loop;

  for item in select value from pg_catalog.jsonb_array_elements(coalesce(p_changes->'rdProjectDecisions', '[]'::jsonb)) loop
    insert into public.rd_project_decisions (id, owner_id, actor_id, project_id, formulation_version_id, milestone_id, outcome, payload, decided_at)
    values (item->>'id', nullif(item->>'owner_id', '')::uuid, nullif(item->>'actor_id', '')::uuid, item->>'project_id', nullif(item->>'formulation_version_id', ''), nullif(item->>'milestone_id', ''), item->>'outcome', item,
      coalesce(nullif(item->>'decided_at', '')::timestamptz, pg_catalog.now()))
    on conflict (id) do nothing;
  end loop;
end;
$$;

revoke all on function public.commit_rd_execution_loop(jsonb) from public, anon, authenticated;
grant execute on function public.commit_rd_execution_loop(jsonb) to service_role;

alter function public.commit_request_changes(jsonb) rename to commit_request_changes_before_rd_execution_loop;
create function public.commit_request_changes(p_changes jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform public.commit_request_changes_before_rd_execution_loop(p_changes);
  perform public.commit_rd_execution_loop(p_changes);
end;
$$;

revoke all on function public.commit_request_changes_before_rd_execution_loop(jsonb) from public, anon, authenticated;
revoke all on function public.commit_request_changes(jsonb) from public, anon, authenticated;
grant execute on function public.commit_request_changes(jsonb) to service_role;
