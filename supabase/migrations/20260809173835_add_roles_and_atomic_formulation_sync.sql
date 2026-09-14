
alter table public.profiles
  add column if not exists role text not null default 'formulator';

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'profiles_role_check' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_role_check check (role in ('admin', 'formulator', 'viewer'));
  end if;
end
$$;

update public.profiles
set role = 'admin', updated_at = now()
where id = (
  select id from public.profiles order by created_at, id limit 1
)
and not exists (select 1 from public.profiles where role = 'admin');

revoke update on public.profiles from authenticated;
grant update (display_name, updated_at) on public.profiles to authenticated;

create or replace function public.ensure_profile(p_user_id uuid, p_display_name text default null)
returns public.profiles
language plpgsql
security invoker
set search_path = ''
as $$
declare
  result public.profiles;
  initial_role text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('beverageai-profile-bootstrap', 0));
  initial_role := case when exists (select 1 from public.profiles) then 'formulator' else 'admin' end;

  insert into public.profiles (id, display_name, role, updated_at)
  values (p_user_id, nullif(pg_catalog.btrim(p_display_name), ''), initial_role, pg_catalog.now())
  on conflict (id) do update
    set display_name = coalesce(excluded.display_name, profiles.display_name),
        updated_at = pg_catalog.now()
  returning * into result;

  return result;
end;
$$;

create or replace function public.sync_formulations(p_formulations jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  formulation jsonb;
  formulation_ingredient jsonb;
  ingredient_order bigint;
begin
  if pg_catalog.jsonb_typeof(p_formulations) <> 'array' then
    raise exception 'p_formulations must be a JSON array';
  end if;

  for formulation in select value from pg_catalog.jsonb_array_elements(p_formulations)
  loop
    insert into public.formulations (
      id, owner_id, code, name, status, parent_formulation_id, payload, created_at, updated_at
    ) values (
      formulation->>'id', nullif(formulation->>'owner_id', '')::uuid,
      formulation->>'code', formulation->>'name', coalesce(formulation->>'status', 'draft'),
      null, formulation,
      coalesce(nullif(formulation->>'created_at', '')::timestamptz, pg_catalog.now()),
      coalesce(nullif(formulation->>'updated_at', '')::timestamptz, pg_catalog.now())
    )
    on conflict (id) do update set
      owner_id = excluded.owner_id,
      code = excluded.code,
      name = excluded.name,
      status = excluded.status,
      parent_formulation_id = null,
      payload = excluded.payload,
      updated_at = excluded.updated_at;
  end loop;

  for formulation in select value from pg_catalog.jsonb_array_elements(p_formulations)
  loop
    update public.formulations
      set parent_formulation_id = nullif(formulation->>'parent_formulation_id', '')
      where id = formulation->>'id';

    delete from public.formulation_ingredients
      where formulation_id = formulation->>'id';

    for formulation_ingredient, ingredient_order in
      select value, ordinality - 1
      from pg_catalog.jsonb_array_elements(coalesce(formulation->'ingredients', '[]'::jsonb)) with ordinality
    loop
      insert into public.formulation_ingredients (
        formulation_id, ingredient_id, owner_id, percentage, display_order, payload
      ) values (
        formulation->>'id', formulation_ingredient->>'ingredient_id',
        nullif(formulation->>'owner_id', '')::uuid,
        (formulation_ingredient->>'percentage')::numeric,
        coalesce((formulation_ingredient->>'display_order')::integer, ingredient_order::integer),
        formulation_ingredient
      );
    end loop;
  end loop;
end;
$$;

revoke all on function public.ensure_profile(uuid, text) from public, anon, authenticated;
revoke all on function public.sync_formulations(jsonb) from public, anon, authenticated;
grant execute on function public.ensure_profile(uuid, text) to service_role;
grant execute on function public.sync_formulations(jsonb) to service_role;
;
