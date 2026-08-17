-- Every ordinary signup starts as a formulator. Administrator access is never
-- awarded based on signup order.
create or replace function public.ensure_profile(p_user_id uuid, p_display_name text default null)
returns public.profiles
language plpgsql
security invoker
set search_path = ''
as $$
declare
  result public.profiles;
begin
  insert into public.profiles (id, display_name, role, updated_at)
  values (p_user_id, nullif(pg_catalog.btrim(p_display_name), ''), 'formulator', pg_catalog.now())
  on conflict (id) do update
    set display_name = coalesce(excluded.display_name, profiles.display_name),
        updated_at = pg_catalog.now()
  returning * into result;

  return result;
end;
$$;

-- One-time bootstrap invoked only by the backend service role. It verifies the
-- configured email against auth.users and serializes concurrent attempts.
create or replace function public.bootstrap_admin(p_user_id uuid, p_expected_email text)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.profiles;
  existing_admin uuid;
begin
  if nullif(pg_catalog.btrim(p_expected_email), '') is null then
    raise exception 'A bootstrap administrator email is required';
  end if;

  if not exists (
    select 1
    from auth.users
    where id = p_user_id
      and pg_catalog.lower(email) = pg_catalog.lower(pg_catalog.btrim(p_expected_email))
  ) then
    raise exception 'The authenticated user does not match the configured bootstrap administrator';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('beverageai-admin-bootstrap', 0));

  select id into existing_admin
  from public.profiles
  where role = 'admin'
  order by created_at, id
  limit 1;

  if existing_admin is not null and existing_admin <> p_user_id then
    raise exception 'An administrator has already been bootstrapped';
  end if;

  insert into public.profiles (id, role, updated_at)
  values (p_user_id, 'admin', pg_catalog.now())
  on conflict (id) do update
    set role = 'admin', updated_at = pg_catalog.now()
  returning * into result;

  return result;
end;
$$;

revoke all on function public.ensure_profile(uuid, text) from public, anon, authenticated;
revoke all on function public.bootstrap_admin(uuid, text) from public, anon, authenticated;
grant execute on function public.ensure_profile(uuid, text) to service_role;
grant execute on function public.bootstrap_admin(uuid, text) to service_role;
