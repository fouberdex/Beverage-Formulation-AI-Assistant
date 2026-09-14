alter table public.formulations
  add column project_id text generated always as (nullif(payload->>'project_id', '')) stored;
alter table public.formulations
  add constraint formulations_owner_project_fk foreign key (owner_id, project_id)
  references public.rd_projects(owner_id, id) on delete restrict deferrable initially deferred;
alter table public.formulations add constraint formulations_owner_project_version_unique unique (owner_id, project_id, id);
create index idx_formulations_owner_project_version on public.formulations(owner_id, project_id, updated_at desc) where project_id is not null;

alter table public.laboratory_results
  add column project_id text generated always as (nullif(payload->>'project_id', '')) stored,
  add column formulation_version_id text generated always as (coalesce(nullif(payload->>'formulation_version_id', ''), formulation_id)) stored;
alter table public.laboratory_results
  add constraint laboratory_owner_project_fk foreign key (owner_id, project_id)
  references public.rd_projects(owner_id, id) on delete restrict deferrable initially deferred;
alter table public.laboratory_results
  add constraint laboratory_exact_formulation_version_fk foreign key (owner_id, project_id, formulation_version_id)
  references public.formulations(owner_id, project_id, id) on delete restrict deferrable initially deferred;
create index idx_laboratory_owner_project_version on public.laboratory_results(owner_id, project_id, formulation_version_id, tested_at desc) where project_id is not null;

alter table public.sensory_studies
  add column project_id text generated always as (nullif(payload->>'project_id', '')) stored;
alter table public.sensory_studies
  add constraint sensory_studies_owner_project_fk foreign key (owner_id, project_id)
  references public.rd_projects(owner_id, id) on delete restrict deferrable initially deferred;
create index idx_sensory_studies_owner_project on public.sensory_studies(owner_id, project_id, updated_at desc) where project_id is not null;

create table public.sensory_study_formulation_versions (
  owner_id uuid not null references auth.users(id) on delete cascade,
  study_id text not null,
  project_id text not null,
  formulation_version_id text not null,
  sample_id text not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, study_id, sample_id),
  foreign key (owner_id, study_id) references public.sensory_studies(owner_id, id) on delete cascade,
  foreign key (owner_id, project_id) references public.rd_projects(owner_id, id) on delete restrict,
  foreign key (owner_id, project_id, formulation_version_id) references public.formulations(owner_id, project_id, id) on delete restrict
);
create index idx_sensory_version_links_project on public.sensory_study_formulation_versions(owner_id, project_id, formulation_version_id);
alter table public.sensory_study_formulation_versions enable row level security;
create policy "Users can read owned sensory formulation links" on public.sensory_study_formulation_versions
  for select to authenticated using ((select auth.uid()) = owner_id);
grant select on public.sensory_study_formulation_versions to authenticated;
grant all on public.sensory_study_formulation_versions to service_role;

create function public.commit_rd_traceability(p_changes jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare study jsonb; sample jsonb; linked_project text;
begin
  for study in select value from pg_catalog.jsonb_array_elements(coalesce(p_changes->'sensoryStudies', '[]'::jsonb)) loop
    delete from public.sensory_study_formulation_versions
      where owner_id = nullif(study->>'owner_id', '')::uuid and study_id = study->>'id';
    linked_project := nullif(study->>'project_id', '');
    if linked_project is not null then
      for sample in select value from pg_catalog.jsonb_array_elements(coalesce(study->'samples', '[]'::jsonb)) loop
        if nullif(sample->>'formulation_id', '') is not null then
          insert into public.sensory_study_formulation_versions (
            owner_id, study_id, project_id, formulation_version_id, sample_id
          ) values (
            nullif(study->>'owner_id', '')::uuid, study->>'id', linked_project,
            sample->>'formulation_id', sample->>'id'
          );
        end if;
      end loop;
    end if;
  end loop;
end;
$$;

revoke all on function public.commit_rd_traceability(jsonb) from public, anon, authenticated;
grant execute on function public.commit_rd_traceability(jsonb) to service_role;

alter function public.commit_request_changes(jsonb) rename to commit_request_changes_before_rd_traceability;
create function public.commit_request_changes(p_changes jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform public.commit_request_changes_before_rd_traceability(p_changes);
  perform public.commit_rd_traceability(p_changes);
end;
$$;

revoke all on function public.commit_request_changes_before_rd_traceability(jsonb) from public, anon, authenticated;
revoke all on function public.commit_request_changes(jsonb) from public, anon, authenticated;
grant execute on function public.commit_request_changes(jsonb) to service_role;
