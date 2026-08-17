-- Tenant-owned AI consent and provider usage accounting. Prompts and model
-- responses are deliberately not stored in these tables.
create table public.ai_preferences (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  external_processing_enabled boolean not null default false,
  include_formulation_name boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.ai_usage_events (
  id bigint generated always as identity primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  request_id text not null check (char_length(request_id) between 1 and 128),
  operation text not null check (operation in ('variant_review', 'target_review')),
  provider text not null check (char_length(provider) between 1 and 50),
  model text not null check (char_length(model) between 1 and 100),
  outcome text not null default 'reserved' check (outcome in ('reserved', 'succeeded', 'failed')),
  prompt_tokens integer check (prompt_tokens is null or prompt_tokens >= 0),
  candidate_tokens integer check (candidate_tokens is null or candidate_tokens >= 0),
  total_tokens integer check (total_tokens is null or total_tokens >= 0),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (owner_id, request_id)
);

create index idx_ai_usage_events_owner_created
  on public.ai_usage_events(owner_id, created_at desc);

alter table public.ai_preferences enable row level security;
alter table public.ai_usage_events enable row level security;

create policy "Users can read own AI preferences"
  on public.ai_preferences for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy "Users can update own AI preferences"
  on public.ai_preferences for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy "Users can read own AI usage"
  on public.ai_usage_events for select to authenticated
  using ((select auth.uid()) = owner_id);

grant select, update on public.ai_preferences to authenticated;
grant select on public.ai_usage_events to authenticated;
grant all on public.ai_preferences, public.ai_usage_events to service_role;
grant usage, select on sequence public.ai_usage_events_id_seq to service_role;

-- Service-only atomic reservation. The transaction-scoped advisory lock
-- serializes quota checks for one tenant across application instances.
create or replace function public.reserve_ai_quota(
  p_owner_id uuid,
  p_request_id text,
  p_operation text,
  p_provider text,
  p_model text,
  p_daily_limit integer,
  p_monthly_limit integer
)
returns table(event_id bigint, daily_used integer, monthly_used integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_daily integer;
  current_monthly integer;
  inserted_id bigint;
begin
  if p_owner_id is null or p_daily_limit < 1 or p_monthly_limit < 1 or p_daily_limit > p_monthly_limit then
    raise exception 'INVALID_AI_QUOTA_CONFIGURATION';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner_id::text, 741));

  if exists (
    select 1 from public.ai_usage_events
    where owner_id = p_owner_id and request_id = p_request_id
  ) then
    raise exception 'AI_REQUEST_ALREADY_RESERVED';
  end if;

  select count(*)::integer into current_daily
  from public.ai_usage_events
  where owner_id = p_owner_id and created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';

  select count(*)::integer into current_monthly
  from public.ai_usage_events
  where owner_id = p_owner_id and created_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';

  if current_daily >= p_daily_limit then raise exception 'AI_DAILY_QUOTA_EXCEEDED'; end if;
  if current_monthly >= p_monthly_limit then raise exception 'AI_MONTHLY_QUOTA_EXCEEDED'; end if;

  insert into public.ai_usage_events (owner_id, request_id, operation, provider, model)
  values (p_owner_id, p_request_id, p_operation, p_provider, p_model)
  returning id into inserted_id;

  return query select inserted_id, current_daily + 1, current_monthly + 1;
end;
$$;

create or replace function public.complete_ai_usage(
  p_owner_id uuid,
  p_event_id bigint,
  p_outcome text,
  p_prompt_tokens integer default null,
  p_candidate_tokens integer default null,
  p_total_tokens integer default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_outcome not in ('succeeded', 'failed') then raise exception 'INVALID_AI_USAGE_OUTCOME'; end if;
  update public.ai_usage_events set
    outcome = p_outcome,
    prompt_tokens = p_prompt_tokens,
    candidate_tokens = p_candidate_tokens,
    total_tokens = p_total_tokens,
    completed_at = now()
  where id = p_event_id and owner_id = p_owner_id;
  if not found then raise exception 'AI_USAGE_EVENT_NOT_FOUND'; end if;
end;
$$;

revoke all on function public.reserve_ai_quota(uuid,text,text,text,text,integer,integer) from public, anon, authenticated;
revoke all on function public.complete_ai_usage(uuid,bigint,text,integer,integer,integer) from public, anon, authenticated;
grant execute on function public.reserve_ai_quota(uuid,text,text,text,text,integer,integer) to service_role;
grant execute on function public.complete_ai_usage(uuid,bigint,text,integer,integer,integer) to service_role;
