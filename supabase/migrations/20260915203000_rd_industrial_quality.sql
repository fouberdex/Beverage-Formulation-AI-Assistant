create table public.rd_production_trials (
  id text primary key, owner_id uuid not null references auth.users(id) on delete cascade,
  project_id text not null, formulation_version_id text not null, packaging_configuration_id text,
  batch_code text not null, status text not null check (status in ('planned','running','completed','cancelled')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload)='object'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(owner_id,project_id,id), unique(owner_id,project_id,batch_code),
  foreign key(owner_id,project_id) references public.rd_projects(owner_id,id) on delete cascade,
  foreign key(owner_id,project_id,formulation_version_id) references public.formulations(owner_id,project_id,id) on delete restrict,
  foreign key(owner_id,project_id,packaging_configuration_id) references public.rd_packaging_configurations(owner_id,project_id,id) on delete restrict
);

create table public.rd_qc_releases (
  id text primary key, owner_id uuid not null references auth.users(id) on delete cascade,
  project_id text not null, production_trial_id text not null, formulation_version_id text not null, specification_id text not null,
  disposition text not null check (disposition in ('released','hold','rejected','out_of_specification')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload)='object'), decided_at timestamptz not null default now(),
  unique(owner_id,project_id,id), unique(owner_id,production_trial_id),
  foreign key(owner_id,project_id,production_trial_id) references public.rd_production_trials(owner_id,project_id,id) on delete restrict,
  foreign key(owner_id,project_id,formulation_version_id) references public.formulations(owner_id,project_id,id) on delete restrict,
  foreign key(owner_id,project_id,specification_id) references public.rd_product_specifications(owner_id,project_id,id) on delete restrict
);

create table public.rd_quality_events (
  id text primary key, owner_id uuid not null references auth.users(id) on delete cascade,
  project_id text not null, production_trial_id text, qc_release_id text,
  event_type text not null check (event_type in ('deviation','out_of_specification','nonconformance')),
  status text not null check (status in ('open','investigating','capa_required','closed')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload)='object'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(owner_id,project_id,id),
  foreign key(owner_id,project_id) references public.rd_projects(owner_id,id) on delete cascade,
  foreign key(owner_id,project_id,production_trial_id) references public.rd_production_trials(owner_id,project_id,id) on delete restrict,
  foreign key(owner_id,project_id,qc_release_id) references public.rd_qc_releases(owner_id,project_id,id) on delete restrict
);

create table public.rd_capa_actions (
  id text primary key, owner_id uuid not null references auth.users(id) on delete cascade,
  project_id text not null, quality_event_id text not null,
  action_type text not null check (action_type in ('corrective','preventive')),
  status text not null check (status in ('planned','in_progress','implemented','effectiveness_verified','ineffective','cancelled')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload)='object'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(owner_id,project_id,id),
  foreign key(owner_id,project_id,quality_event_id) references public.rd_quality_events(owner_id,project_id,id) on delete restrict
);

create index idx_rd_production_trials_project on public.rd_production_trials(owner_id,project_id,updated_at desc);
create index idx_rd_qc_releases_project on public.rd_qc_releases(owner_id,project_id,decided_at desc);
create index idx_rd_quality_events_project on public.rd_quality_events(owner_id,project_id,status,updated_at desc);
create index idx_rd_capa_actions_event on public.rd_capa_actions(owner_id,project_id,quality_event_id,updated_at desc);

alter table public.rd_production_trials enable row level security;
alter table public.rd_qc_releases enable row level security;
alter table public.rd_quality_events enable row level security;
alter table public.rd_capa_actions enable row level security;
create policy "Users can read owned production trials" on public.rd_production_trials for select to authenticated using ((select auth.uid())=owner_id);
create policy "Users can read owned QC releases" on public.rd_qc_releases for select to authenticated using ((select auth.uid())=owner_id);
create policy "Users can read owned quality events" on public.rd_quality_events for select to authenticated using ((select auth.uid())=owner_id);
create policy "Users can read owned CAPA actions" on public.rd_capa_actions for select to authenticated using ((select auth.uid())=owner_id);
grant select on public.rd_production_trials,public.rd_qc_releases,public.rd_quality_events,public.rd_capa_actions to authenticated;
grant all on public.rd_production_trials,public.rd_qc_releases,public.rd_quality_events,public.rd_capa_actions to service_role;

create function public.commit_rd_industrial_quality(p_changes jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare item jsonb;
begin
  for item in select value from pg_catalog.jsonb_array_elements(coalesce(p_changes->'rdProductionTrials','[]'::jsonb)) loop
    insert into public.rd_production_trials(id,owner_id,project_id,formulation_version_id,packaging_configuration_id,batch_code,status,payload,created_at,updated_at)
    values(item->>'id',nullif(item->>'owner_id','')::uuid,item->>'project_id',item->>'formulation_version_id',nullif(item->>'packaging_configuration_id',''),item->>'batch_code',item->>'status',item,coalesce(nullif(item->>'created_at','')::timestamptz,now()),coalesce(nullif(item->>'updated_at','')::timestamptz,now()))
    on conflict(id) do update set status=excluded.status,payload=excluded.payload,updated_at=excluded.updated_at;
  end loop;
  for item in select value from pg_catalog.jsonb_array_elements(coalesce(p_changes->'rdQcReleases','[]'::jsonb)) loop
    insert into public.rd_qc_releases(id,owner_id,project_id,production_trial_id,formulation_version_id,specification_id,disposition,payload,decided_at)
    values(item->>'id',nullif(item->>'owner_id','')::uuid,item->>'project_id',item->>'production_trial_id',item->>'formulation_version_id',item->>'specification_id',item->>'disposition',item,coalesce(nullif(item->>'decided_at','')::timestamptz,now()))
    on conflict(id) do nothing;
  end loop;
  for item in select value from pg_catalog.jsonb_array_elements(coalesce(p_changes->'rdQualityEvents','[]'::jsonb)) loop
    insert into public.rd_quality_events(id,owner_id,project_id,production_trial_id,qc_release_id,event_type,status,payload,created_at,updated_at)
    values(item->>'id',nullif(item->>'owner_id','')::uuid,item->>'project_id',nullif(item->>'production_trial_id',''),nullif(item->>'qc_release_id',''),item->>'event_type',item->>'status',item,coalesce(nullif(item->>'created_at','')::timestamptz,now()),coalesce(nullif(item->>'updated_at','')::timestamptz,now()))
    on conflict(id) do update set status=excluded.status,payload=excluded.payload,updated_at=excluded.updated_at;
  end loop;
  for item in select value from pg_catalog.jsonb_array_elements(coalesce(p_changes->'rdCapaActions','[]'::jsonb)) loop
    insert into public.rd_capa_actions(id,owner_id,project_id,quality_event_id,action_type,status,payload,created_at,updated_at)
    values(item->>'id',nullif(item->>'owner_id','')::uuid,item->>'project_id',item->>'quality_event_id',item->>'action_type',item->>'status',item,coalesce(nullif(item->>'created_at','')::timestamptz,now()),coalesce(nullif(item->>'updated_at','')::timestamptz,now()))
    on conflict(id) do update set status=excluded.status,payload=excluded.payload,updated_at=excluded.updated_at;
  end loop;
end;
$$;
revoke all on function public.commit_rd_industrial_quality(jsonb) from public,anon,authenticated;
grant execute on function public.commit_rd_industrial_quality(jsonb) to service_role;
alter function public.commit_request_changes(jsonb) rename to commit_request_changes_before_rd_industrial_quality;
create function public.commit_request_changes(p_changes jsonb)
returns void language plpgsql security invoker set search_path='' as $$
begin
  perform public.commit_request_changes_before_rd_industrial_quality(p_changes);
  perform public.commit_rd_industrial_quality(p_changes);
end;
$$;
revoke all on function public.commit_request_changes_before_rd_industrial_quality(jsonb) from public,anon,authenticated;
revoke all on function public.commit_request_changes(jsonb) from public,anon,authenticated;
grant execute on function public.commit_request_changes(jsonb) to service_role;
