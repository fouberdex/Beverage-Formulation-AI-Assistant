-- The Supabase CLI could not create this file in the restricted local profile;
-- this migration follows the existing request-scoped, owner-isolated model.
create table public.laboratory_results (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  formulation_id text not null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  tested_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (owner_id, id),
  foreign key (owner_id, formulation_id) references public.formulations(owner_id, id) on delete cascade
);

create table public.ai_learning_examples (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  laboratory_result_id text not null,
  formulation_id text not null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  unique (owner_id, id),
  foreign key (owner_id, laboratory_result_id) references public.laboratory_results(owner_id, id) on delete cascade,
  foreign key (owner_id, formulation_id) references public.formulations(owner_id, id) on delete cascade
);

create index idx_lab_results_owner_formulation_tested on public.laboratory_results(owner_id, formulation_id, tested_at desc);
create index idx_learning_examples_owner_created on public.ai_learning_examples(owner_id, created_at desc);
alter table public.laboratory_results enable row level security;
alter table public.ai_learning_examples enable row level security;
create policy "Users can read owned laboratory results" on public.laboratory_results for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Users can read owned learning examples" on public.ai_learning_examples for select to authenticated using ((select auth.uid()) = owner_id);
grant select on public.laboratory_results, public.ai_learning_examples to authenticated;
grant all on public.laboratory_results, public.ai_learning_examples to service_role;

create function public.commit_laboratory_feedback(p_changes jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare item jsonb;
begin
  for item in select value from pg_catalog.jsonb_array_elements(coalesce(p_changes->'laboratoryResults', '[]'::jsonb)) loop
    insert into public.laboratory_results (id, owner_id, formulation_id, payload, tested_at, created_at)
    values (item->>'id', nullif(item->>'owner_id', '')::uuid, item->>'formulation_id', item,
      coalesce(nullif(item->>'tested_at', '')::timestamptz, pg_catalog.now()),
      coalesce(nullif(item->>'created_at', '')::timestamptz, pg_catalog.now()))
    on conflict (id) do update set payload = excluded.payload, tested_at = excluded.tested_at;
  end loop;
  for item in select value from pg_catalog.jsonb_array_elements(coalesce(p_changes->'aiLearningExamples', '[]'::jsonb)) loop
    insert into public.ai_learning_examples (id, owner_id, laboratory_result_id, formulation_id, payload, created_at)
    values (item->>'id', nullif(item->>'owner_id', '')::uuid, item->>'laboratory_result_id', item->>'formulation_id', item,
      coalesce(nullif(item->>'created_at', '')::timestamptz, pg_catalog.now()))
    on conflict (id) do update set payload = excluded.payload;
  end loop;
end;
$$;
revoke all on function public.commit_laboratory_feedback(jsonb) from public, anon, authenticated;
grant execute on function public.commit_laboratory_feedback(jsonb) to service_role;

-- Retain the existing request-wide transaction and include laboratory changes
-- through a wrapper, so every API request still commits through one RPC.
alter function public.commit_request_changes(jsonb) rename to commit_request_changes_core;
create function public.commit_request_changes(p_changes jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform public.commit_request_changes_core(p_changes);
  perform public.commit_laboratory_feedback(p_changes);
end;
$$;
revoke all on function public.commit_request_changes_core(jsonb) from public, anon, authenticated;
revoke all on function public.commit_request_changes(jsonb) from public, anon, authenticated;
grant execute on function public.commit_request_changes(jsonb) to service_role;
