
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
;
