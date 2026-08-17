-- Adds request-scoped atomic commits on installations upgrading from the baseline.
drop policy if exists "Users can read owned formulations" on public.formulations;
create policy "Users can read owned formulations" on public.formulations for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "Users can read owned formulation ingredients" on public.formulation_ingredients;
create policy "Users can read owned formulation ingredients" on public.formulation_ingredients for select to authenticated
  using ((select auth.uid()) = owner_id);

create or replace function public.commit_request_changes(p_changes jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  item jsonb;
begin
  if pg_catalog.jsonb_typeof(p_changes) <> 'object' then
    raise exception 'p_changes must be a JSON object';
  end if;

  for item in select value from pg_catalog.jsonb_array_elements(coalesce(p_changes->'ingredients', '[]'::jsonb))
  loop
    insert into public.ingredients (id, code, name, category, is_active, payload, created_at, updated_at)
    values (
      item->>'id', item->>'code', item->>'name', item->>'category',
      coalesce((item->>'is_active')::boolean, true), item,
      coalesce(nullif(item->>'created_at', '')::timestamptz, pg_catalog.now()),
      coalesce(nullif(item->>'updated_at', '')::timestamptz, pg_catalog.now())
    )
    on conflict (id) do update set
      code = excluded.code, name = excluded.name, category = excluded.category,
      is_active = excluded.is_active, payload = excluded.payload, updated_at = excluded.updated_at;
  end loop;

  perform public.sync_formulations(coalesce(p_changes->'formulations', '[]'::jsonb));

  for item in select value from pg_catalog.jsonb_array_elements(coalesce(p_changes->'aiVariants', '[]'::jsonb))
  loop
    insert into public.ai_variants (id, owner_id, source_formulation_id, status, payload, created_at, updated_at)
    values (
      item->>'id', nullif(item->>'owner_id', '')::uuid, item->>'source_formulation_id',
      coalesce(item->>'status', 'generated'), item,
      coalesce(nullif(item->>'created_at', '')::timestamptz, pg_catalog.now()),
      coalesce(nullif(item->>'updated_at', '')::timestamptz, pg_catalog.now())
    )
    on conflict (id) do update set
      status = excluded.status, payload = excluded.payload, updated_at = excluded.updated_at;
  end loop;

  for item in select value from pg_catalog.jsonb_array_elements(coalesce(p_changes->'complianceRecords', '[]'::jsonb))
  loop
    insert into public.compliance_records (id, owner_id, formulation_id, payload, checked_at)
    values (
      item->>'id', nullif(item->>'owner_id', '')::uuid, item->>'formulation_id', item,
      coalesce(nullif(item->>'checked_at', '')::timestamptz, pg_catalog.now())
    )
    on conflict (formulation_id) do update set
      id = excluded.id, owner_id = excluded.owner_id, payload = excluded.payload,
      checked_at = excluded.checked_at;
  end loop;

  for item in select value from pg_catalog.jsonb_array_elements(coalesce(p_changes->'batchCostCalculations', '[]'::jsonb))
  loop
    insert into public.batch_cost_calculations (
      id, owner_id, formulation_id, batch_size_liters, payload, calculated_at
    ) values (
      item->>'id', nullif(item->>'owner_id', '')::uuid, item->>'formulation_id',
      (item->>'batch_size_liters')::numeric, item,
      coalesce(nullif(item->>'calculated_at', '')::timestamptz, pg_catalog.now())
    )
    on conflict (id) do update set payload = excluded.payload;
  end loop;

  for item in select value from pg_catalog.jsonb_array_elements(coalesce(p_changes->'pricingHistory', '[]'::jsonb))
  loop
    insert into public.pricing_history (
      id, ingredient_id, created_by, price_per_kg, currency, payload, effective_date
    ) values (
      item->>'id', item->>'ingredient_id', nullif(item->>'created_by', '')::uuid,
      (item->>'price_per_kg')::numeric, coalesce(item->>'currency', 'DZD'), item,
      coalesce(nullif(item->>'effective_date', '')::timestamptz, pg_catalog.now())
    )
    on conflict (id) do update set
      price_per_kg = excluded.price_per_kg, currency = excluded.currency,
      payload = excluded.payload, effective_date = excluded.effective_date;
  end loop;

  for item in select value from pg_catalog.jsonb_array_elements(coalesce(p_changes->'targetGenerationRuns', '[]'::jsonb))
  loop
    insert into public.target_generation_runs (
      id, owner_id, constraints, candidates, ai_metadata, created_at
    ) values (
      (item->>'id')::uuid, nullif(item->>'owner_id', '')::uuid,
      coalesce(item->'constraints', '{}'::jsonb), coalesce(item->'candidates', '[]'::jsonb),
      coalesce(item->'ai', '{}'::jsonb),
      coalesce(nullif(item->>'created_at', '')::timestamptz, pg_catalog.now())
    )
    on conflict (id) do update set
      constraints = excluded.constraints, candidates = excluded.candidates,
      ai_metadata = excluded.ai_metadata;
  end loop;

  for item in select value from pg_catalog.jsonb_array_elements(coalesce(p_changes->'auditEvents', '[]'::jsonb))
  loop
    insert into public.audit_logs (owner_id, action, entity_type, entity_id, metadata)
    values (
      nullif(item->>'owner_id', '')::uuid, item->>'action', item->>'entity_type',
      nullif(item->>'entity_id', ''), coalesce(item->'metadata', '{}'::jsonb)
    );
  end loop;
end;
$$;

revoke all on function public.commit_request_changes(jsonb) from public, anon, authenticated;
grant execute on function public.commit_request_changes(jsonb) to service_role;
