create table public.rd_projects (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  code text not null,
  name text not null,
  stage text not null default 'brief' check (stage in ('brief', 'concept', 'formulation', 'laboratory', 'sensory', 'validation', 'industrialization', 'launched')),
  status text not null default 'draft' check (status in ('draft', 'active', 'on_hold', 'completed', 'archived')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'critical')),
  due_date date,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, code)
);

create table public.rd_project_events (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  unique (owner_id, id),
  foreign key (owner_id, project_id) references public.rd_projects(owner_id, id) on delete cascade
);

create index idx_rd_projects_owner_updated on public.rd_projects(owner_id, updated_at desc);
create index idx_rd_projects_owner_stage on public.rd_projects(owner_id, stage, status);
create index idx_rd_project_events_owner_project_created on public.rd_project_events(owner_id, project_id, created_at desc);

alter table public.rd_projects enable row level security;
alter table public.rd_project_events enable row level security;

create policy "Users can read owned R&D projects" on public.rd_projects
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Users can read owned R&D project events" on public.rd_project_events
  for select to authenticated using ((select auth.uid()) = owner_id);

grant select on public.rd_projects, public.rd_project_events to authenticated;
grant all on public.rd_projects, public.rd_project_events to service_role;

create function public.commit_rd_project_data(p_changes jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare item jsonb;
begin
  for item in select value from pg_catalog.jsonb_array_elements(coalesce(p_changes->'rdProjects', '[]'::jsonb)) loop
    if exists (select 1 from public.rd_projects where id = item->>'id' and owner_id <> nullif(item->>'owner_id', '')::uuid) then
      raise exception 'R&D project ownership mismatch';
    end if;
    insert into public.rd_projects (id, owner_id, code, name, stage, status, priority, due_date, payload, created_at, updated_at)
    values (
      item->>'id', nullif(item->>'owner_id', '')::uuid, item->>'code', item->>'name',
      coalesce(nullif(item->>'stage', ''), 'brief'), coalesce(nullif(item->>'status', ''), 'draft'),
      coalesce(nullif(item->>'priority', ''), 'normal'), nullif(item->>'due_date', '')::date, item,
      coalesce(nullif(item->>'created_at', '')::timestamptz, pg_catalog.now()),
      coalesce(nullif(item->>'updated_at', '')::timestamptz, pg_catalog.now())
    )
    on conflict (id) do update set
      code = excluded.code, name = excluded.name, stage = excluded.stage, status = excluded.status,
      priority = excluded.priority, due_date = excluded.due_date, payload = excluded.payload,
      updated_at = excluded.updated_at;
  end loop;

  for item in select value from pg_catalog.jsonb_array_elements(coalesce(p_changes->'rdProjectEvents', '[]'::jsonb)) loop
    insert into public.rd_project_events (id, owner_id, project_id, event_type, payload, created_at)
    values (
      item->>'id', nullif(item->>'owner_id', '')::uuid, item->>'project_id', item->>'event_type', item,
      coalesce(nullif(item->>'created_at', '')::timestamptz, pg_catalog.now())
    )
    on conflict (id) do nothing;
  end loop;
end;
$$;

revoke all on function public.commit_rd_project_data(jsonb) from public, anon, authenticated;
grant execute on function public.commit_rd_project_data(jsonb) to service_role;

alter function public.commit_request_changes(jsonb) rename to commit_request_changes_before_rd_projects;
create function public.commit_request_changes(p_changes jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform public.commit_request_changes_before_rd_projects(p_changes);
  perform public.commit_rd_project_data(p_changes);
end;
$$;

revoke all on function public.commit_request_changes_before_rd_projects(jsonb) from public, anon, authenticated;
revoke all on function public.commit_request_changes(jsonb) from public, anon, authenticated;
grant execute on function public.commit_request_changes(jsonb) to service_role;
