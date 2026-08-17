-- Owner-scoped records must never be orphaned or reference another tenant's
-- formulation. Legacy NULL owners require an explicit reviewed data migration.
do $$
begin
  if exists (
    select 1 from public.formulations where owner_id is null
    union all select 1 from public.formulation_ingredients where owner_id is null
    union all select 1 from public.ai_variants where owner_id is null
    union all select 1 from public.compliance_records where owner_id is null
    union all select 1 from public.batch_cost_calculations where owner_id is null
  ) then
    raise exception 'Owner-scoped rows with NULL owner_id must be assigned or removed before this migration';
  end if;
end;
$$;

alter table public.formulations alter column owner_id set not null;
alter table public.formulation_ingredients alter column owner_id set not null;
alter table public.ai_variants alter column owner_id set not null;
alter table public.compliance_records alter column owner_id set not null;
alter table public.batch_cost_calculations alter column owner_id set not null;

alter table public.formulations
  add constraint formulations_owner_id_id_key unique (owner_id, id);

alter table public.formulations drop constraint formulations_parent_formulation_id_fkey;
alter table public.formulations
  add constraint formulations_owner_parent_fkey
  foreign key (owner_id, parent_formulation_id)
  references public.formulations(owner_id, id) on delete restrict;

alter table public.formulation_ingredients drop constraint formulation_ingredients_formulation_id_fkey;
alter table public.formulation_ingredients
  add constraint formulation_ingredients_owner_formulation_fkey
  foreign key (owner_id, formulation_id)
  references public.formulations(owner_id, id) on delete cascade;

alter table public.ai_variants drop constraint ai_variants_source_formulation_id_fkey;
alter table public.ai_variants
  add constraint ai_variants_owner_formulation_fkey
  foreign key (owner_id, source_formulation_id)
  references public.formulations(owner_id, id) on delete cascade;

alter table public.compliance_records drop constraint compliance_records_formulation_id_fkey;
alter table public.compliance_records
  add constraint compliance_records_owner_formulation_fkey
  foreign key (owner_id, formulation_id)
  references public.formulations(owner_id, id) on delete cascade;

alter table public.batch_cost_calculations drop constraint batch_cost_calculations_formulation_id_fkey;
alter table public.batch_cost_calculations
  add constraint batch_cost_calculations_owner_formulation_fkey
  foreign key (owner_id, formulation_id)
  references public.formulations(owner_id, id) on delete cascade;
