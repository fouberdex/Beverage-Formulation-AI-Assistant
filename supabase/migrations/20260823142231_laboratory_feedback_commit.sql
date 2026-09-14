
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
;
