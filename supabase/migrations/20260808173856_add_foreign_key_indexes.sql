create index if not exists idx_formulation_ingredients_ingredient on public.formulation_ingredients(ingredient_id);
create index if not exists idx_ai_variants_source on public.ai_variants(source_formulation_id);
create index if not exists idx_batch_cost_formulation on public.batch_cost_calculations(formulation_id);
create index if not exists idx_pricing_created_by on public.pricing_history(created_by) where created_by is not null;;
