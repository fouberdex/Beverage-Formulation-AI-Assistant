create table public.sensory_studies (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'active', 'completed', 'archived')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id)
);

create table public.sensory_responses (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  study_id text not null,
  panelist_code text not null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, study_id, panelist_code),
  foreign key (owner_id, study_id) references public.sensory_studies(owner_id, id) on delete cascade
);

create index idx_sensory_studies_owner_updated on public.sensory_studies(owner_id, updated_at desc);
create index idx_sensory_responses_owner_study_completed on public.sensory_responses(owner_id, study_id, completed_at desc);

alter table public.sensory_studies enable row level security;
alter table public.sensory_responses enable row level security;

create policy "Users can read owned sensory studies" on public.sensory_studies
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Users can read owned sensory responses" on public.sensory_responses
  for select to authenticated using ((select auth.uid()) = owner_id);

grant select on public.sensory_studies, public.sensory_responses to authenticated;
grant all on public.sensory_studies, public.sensory_responses to service_role;

create function public.commit_sensory_data(p_changes jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare item jsonb;
begin
  for item in select value from pg_catalog.jsonb_array_elements(coalesce(p_changes->'sensoryStudies', '[]'::jsonb)) loop
    insert into public.sensory_studies (id, owner_id, status, payload, created_at, updated_at)
    values (
      item->>'id', nullif(item->>'owner_id', '')::uuid, coalesce(nullif(item->>'status', ''), 'draft'), item,
      coalesce(nullif(item->>'created_at', '')::timestamptz, pg_catalog.now()),
      coalesce(nullif(item->>'updated_at', '')::timestamptz, pg_catalog.now())
    )
    on conflict (id) do update set status = excluded.status, payload = excluded.payload, updated_at = excluded.updated_at;
  end loop;

  for item in select value from pg_catalog.jsonb_array_elements(coalesce(p_changes->'sensoryResponses', '[]'::jsonb)) loop
    insert into public.sensory_responses (id, owner_id, study_id, panelist_code, payload, completed_at, created_at)
    values (
      item->>'id', nullif(item->>'owner_id', '')::uuid, item->>'study_id', item->>'panelist_code', item,
      coalesce(nullif(item#>>'{session,completed_at}', '')::timestamptz, pg_catalog.now()),
      coalesce(nullif(item->>'created_at', '')::timestamptz, pg_catalog.now())
    )
    on conflict (id) do update set panelist_code = excluded.panelist_code, payload = excluded.payload, completed_at = excluded.completed_at;
  end loop;
end;
$$;

revoke all on function public.commit_sensory_data(jsonb) from public, anon, authenticated;
grant execute on function public.commit_sensory_data(jsonb) to service_role;

alter function public.commit_request_changes(jsonb) rename to commit_request_changes_before_sensory;
create function public.commit_request_changes(p_changes jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform public.commit_request_changes_before_sensory(p_changes);
  perform public.commit_sensory_data(p_changes);
end;
$$;

revoke all on function public.commit_request_changes_before_sensory(jsonb) from public, anon, authenticated;
revoke all on function public.commit_request_changes(jsonb) from public, anon, authenticated;
grant execute on function public.commit_request_changes(jsonb) to service_role;
