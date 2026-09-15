import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Beaker, Check, CheckCircle2, FlaskConical, Info, Loader2, Save, Scale, Sparkles, Target, XCircle } from 'lucide-react';
import StatusMessage from '../components/StatusMessage';
import { formulationsAPI, ingredientsAPI, projectsAPI, targetGenerationAPI } from '../services/api';
import { getErrorMessage } from '../services/errors';
import type { RDProject } from '../types';

type Constraints = {
  project_id: string; reference_formulation_id: string; beverage_type: string;
  max_calories_per_100ml: string; max_sugar_g_per_100ml: string; max_cost_per_liter: string;
  minimum_juice_percent: string; maximum_preservative_percent: string; maximum_caffeine_percent: string;
  maximum_sodium_mg_per_100ml: string; target_ph_min: string; target_ph_max: string;
  min_ingredients: number; max_ingredients: number; count: number;
  required_ingredient_ids: string[]; forbidden_ingredient_ids: string[];
  ingredient_bounds: Array<{ ingredient_id: string; min_percentage?: number; max_percentage?: number }>; objectives: string[];
};

const initialConstraints: Constraints = {
  project_id: '', reference_formulation_id: '', beverage_type: 'soft_drink', max_calories_per_100ml: '',
  max_sugar_g_per_100ml: '', max_cost_per_liter: '', minimum_juice_percent: '', maximum_preservative_percent: '',
  maximum_caffeine_percent: '', maximum_sodium_mg_per_100ml: '', target_ph_min: '', target_ph_max: '',
  min_ingredients: 5, max_ingredients: 10, count: 4, required_ingredient_ids: [], forbidden_ingredient_ids: [],
  ingredient_bounds: [], objectives: ['cost', 'sugar', 'calories'],
};
const objectiveOptions = [['cost', 'Ingredient cost'], ['sugar', 'Sugar'], ['calories', 'Calories'], ['ingredient_count', 'Formula simplicity'], ['reference_deviation', 'Reference deviation']];
const numeric = (value: string) => value === '' ? undefined : Number(value);
const compactSignature = (value = '') => value ? `${value.slice(0, 12)}…${value.slice(-8)}` : '—';

export default function TargetGenerationPage() {
  const [constraints, setConstraints] = useState(initialConstraints);
  const [projects, setProjects] = useState<RDProject[]>([]);
  const [formulations, setFormulations] = useState<any[]>([]);
  const [ingredients, setIngredients] = useState<any[]>([]);
  const [results, setResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    Promise.all([projectsAPI.getAll({ status: 'all', limit: 200 }), formulationsAPI.getAll({ status: 'all', limit: 500 }), ingredientsAPI.getAll({ limit: 500 })])
      .then(([a, b, c]) => { setProjects(a.data.data || []); setFormulations(b.data.data || []); setIngredients(c.data.data || []); })
      .catch(reason => setError(getErrorMessage(reason, 'Unable to load formulation intelligence inputs.')));
  }, []);

  const selectedProject = projects.find(project => project.id === constraints.project_id);
  const references = useMemo(() => formulations.filter(item => !constraints.project_id || item.project_id === constraints.project_id), [formulations, constraints.project_id]);
  function update<K extends keyof Constraints>(key: K, value: Constraints[K]) { setConstraints(previous => ({ ...previous, [key]: value })); }

  function importBrief() {
    if (!selectedProject) return;
    const matchNames = (names: string[]) => names.map(name => ingredients.find(item => item.name.toLowerCase() === name.toLowerCase() || item.name_fr?.toLowerCase() === name.toLowerCase())?.id).filter(Boolean) as string[];
    setConstraints(previous => ({ ...previous,
      beverage_type: selectedProject.beverage_category || previous.beverage_type,
      max_cost_per_liter: selectedProject.cost_objectives?.max_cost_per_liter?.toString() || '',
      max_sugar_g_per_100ml: selectedProject.nutrition_objectives?.max_sugar_g_per_100ml?.toString() || '',
      max_calories_per_100ml: selectedProject.nutrition_objectives?.max_calories_per_100ml?.toString() || '',
      target_ph_min: selectedProject.nutrition_objectives?.target_ph_min?.toString() || '', target_ph_max: selectedProject.nutrition_objectives?.target_ph_max?.toString() || '',
      required_ingredient_ids: matchNames(selectedProject.ingredient_constraints?.required || []),
      forbidden_ingredient_ids: matchNames([...(selectedProject.ingredient_constraints?.forbidden || []), ...(selectedProject.regulatory_constraints?.forbidden_additives || [])]),
    }));
    setSuccess('Validated project brief constraints imported. Review unresolved ingredient names before generation.');
  }

  async function generate() {
    setLoading(true); setError(''); setSuccess(''); setResults(null); setSavedIds([]);
    try {
      const response = await targetGenerationAPI.generate({ ...constraints,
        project_id: constraints.project_id || undefined, reference_formulation_id: constraints.reference_formulation_id || undefined,
        max_calories_per_100ml: numeric(constraints.max_calories_per_100ml), max_sugar_g_per_100ml: numeric(constraints.max_sugar_g_per_100ml),
        max_cost_per_liter: numeric(constraints.max_cost_per_liter), minimum_juice_percent: numeric(constraints.minimum_juice_percent),
        maximum_preservative_percent: numeric(constraints.maximum_preservative_percent), maximum_caffeine_percent: numeric(constraints.maximum_caffeine_percent),
        maximum_sodium_mg_per_100ml: numeric(constraints.maximum_sodium_mg_per_100ml), target_ph_min: numeric(constraints.target_ph_min), target_ph_max: numeric(constraints.target_ph_max),
      });
      setResults(response.data.data);
    } catch (reason: any) {
      if (reason?.status === 422 && reason?.data?.data) setResults(reason.data.data);
      setError(getErrorMessage(reason, 'No candidate could be generated.'));
    }
    finally { setLoading(false); }
  }

  async function save(candidate: any, index: number) {
    setSavingId(candidate.id); setError('');
    try {
      const response = await targetGenerationAPI.save({ run_id: results.run_id, candidate_id: candidate.id, project_id: constraints.project_id || undefined, name: `Constraint candidate ${index + 1} · ${constraints.beverage_type}` });
      setSavedIds(previous => [...previous, candidate.id]); setSuccess(`${response.data.data.name} saved as an exact draft formulation version.`);
    } catch (reason) { setError(getErrorMessage(reason, 'Unable to save this candidate.')); }
    finally { setSavingId(null); }
  }

  return <div className="space-y-6">
    <StatusMessage error={error}/>
    {success && <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-semibold text-emerald-900"><CheckCircle2 className="h-5 w-5"/>{success}</div>}
    <header className="hero-panel"><div><span className="hero-kicker"><Sparkles className="h-4 w-4"/> Formulation intelligence</span><h1>Design within real constraints</h1><p>Generate reproducible candidates, expose every hard constraint and compare trade-offs before laboratory validation.</p></div><div className="rounded-2xl border border-sky-200 bg-sky-50 px-5 py-4"><p className="eyebrow !text-sky-800">Decision rule</p><p className="mt-1 text-sm font-bold !text-slate-900">Feasibility first · Pareto second · Gemini advisory only</p></div></header>

    <section className="surface-card">
      <SectionTitle step="1" title="Project and reference" description="Use a validated R&D brief so candidates remain connected to the decision trail." action={selectedProject && <button type="button" onClick={importBrief} disabled={selectedProject.brief_status !== 'validated'} className="secondary-button"><Target className="h-4 w-4"/>Import validated brief</button>}/>
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        <Field label="R&D project"><select aria-label="R&D project" value={constraints.project_id} onChange={event => { update('project_id', event.target.value); update('reference_formulation_id', ''); }}><option value="">Independent exploration</option>{projects.map(project => <option key={project.id} value={project.id} disabled={project.brief_status !== 'validated'}>{project.code} · {project.name}{project.brief_status !== 'validated' ? ' (brief draft)' : ''}</option>)}</select></Field>
        <Field label="Exact reference version"><select aria-label="Exact reference version" value={constraints.reference_formulation_id} onChange={event => update('reference_formulation_id', event.target.value)}><option value="">No reference</option>{references.map(item => <option key={item.id} value={item.id}>{item.code} · v{item.version} · {item.name}</option>)}</select></Field>
        <Field label="Beverage category"><input aria-label="Beverage category" value={constraints.beverage_type} onChange={event => update('beverage_type', event.target.value)} placeholder="Carbonated soft drink"/></Field>
      </div>
    </section>

    <section className="surface-card">
      <SectionTitle step="2" title="Define the feasible envelope" description="Blank fields are not constraints. Unprovable pH and sodium limits remain laboratory validation gaps."/>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <NumberField label="Maximum sugar" suffix="g/100 ml" value={constraints.max_sugar_g_per_100ml} onChange={value => update('max_sugar_g_per_100ml', value)}/><NumberField label="Maximum calories" suffix="kcal/100 ml" value={constraints.max_calories_per_100ml} onChange={value => update('max_calories_per_100ml', value)}/><NumberField label="Maximum ingredient cost" suffix="DZD/L" value={constraints.max_cost_per_liter} onChange={value => update('max_cost_per_liter', value)}/><NumberField label="Minimum juice" suffix="%" value={constraints.minimum_juice_percent} onChange={value => update('minimum_juice_percent', value)}/>
        <NumberField label="Maximum preservative" suffix="%" value={constraints.maximum_preservative_percent} onChange={value => update('maximum_preservative_percent', value)}/><NumberField label="Maximum caffeine ingredient" suffix="%" value={constraints.maximum_caffeine_percent} onChange={value => update('maximum_caffeine_percent', value)}/><NumberField label="Maximum sodium" suffix="mg/100 ml" value={constraints.maximum_sodium_mg_per_100ml} onChange={value => update('maximum_sodium_mg_per_100ml', value)}/><div className="grid grid-cols-2 gap-2"><NumberField label="pH min" value={constraints.target_ph_min} onChange={value => update('target_ph_min', value)}/><NumberField label="pH max" value={constraints.target_ph_max} onChange={value => update('target_ph_max', value)}/></div>
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-2"><IngredientSelector label="Required ingredients" value={constraints.required_ingredient_ids} ingredients={ingredients.filter(item => !constraints.forbidden_ingredient_ids.includes(item.id))} onChange={value => update('required_ingredient_ids', value)}/><IngredientSelector label="Forbidden ingredients" value={constraints.forbidden_ingredient_ids} ingredients={ingredients.filter(item => !constraints.required_ingredient_ids.includes(item.id))} onChange={value => update('forbidden_ingredient_ids', value)}/></div>
      <BoundEditor ingredients={ingredients.filter(item => !constraints.forbidden_ingredient_ids.includes(item.id))} bounds={constraints.ingredient_bounds} onChange={value => update('ingredient_bounds', value)}/>
      <div className="mt-5 grid gap-4 md:grid-cols-3"><NumberInput label="Minimum ingredients" value={constraints.min_ingredients} onChange={value => update('min_ingredients', value)}/><NumberInput label="Maximum ingredients" value={constraints.max_ingredients} onChange={value => update('max_ingredients', value)}/><NumberInput label="Candidates" value={constraints.count} max={10} onChange={value => update('count', value)}/></div>
    </section>

    <section className="surface-card"><SectionTitle step="3" title="Choose the trade-offs to compare"/><div className="mt-4 flex flex-wrap gap-2">{objectiveOptions.map(([key, label]) => { const active = constraints.objectives.includes(key); return <button key={key} type="button" aria-pressed={active} onClick={() => update('objectives', active ? constraints.objectives.filter(item => item !== key) : [...constraints.objectives, key])} className={`rounded-full border px-4 py-2 text-sm font-bold transition ${active ? 'border-sky-500 bg-sky-50 text-sky-800' : 'border-slate-200 bg-white text-slate-600 hover:border-sky-300'}`}>{active && <Check className="mr-1 inline h-4 w-4"/>}{label}</button>; })}</div><div className="mt-6 flex justify-end"><button type="button" onClick={generate} disabled={loading || constraints.objectives.length === 0} className="primary-button px-6 py-3">{loading ? <Loader2 className="h-5 w-5 animate-spin"/> : <FlaskConical className="h-5 w-5"/>}{loading ? 'Evaluating feasible space…' : 'Generate reproducible candidates'}</button></div></section>
    {results && <Results results={results} savedIds={savedIds} savingId={savingId} onSave={save}/>}
  </div>;
}

function Results({ results, savedIds, savingId, onSave }: any) {
  return <section className="space-y-5" aria-label="Generation results"><div className="surface-card grid gap-4 md:grid-cols-4"><Metric label="Feasible candidates" value={`${results.feasibility?.feasible_candidate_count || 0}/${results.feasibility?.generated_candidate_count || 0}`} icon={<CheckCircle2/>}/><Metric label="Preflight blockers" value={results.feasibility?.blocker_count || 0} icon={<AlertTriangle/>}/><Metric label="Engine" value={results.reproducibility?.engine_version || '—'} icon={<Beaker/>}/><Metric label="Input signature" value={compactSignature(results.reproducibility?.input_signature)} icon={<Scale/>}/></div>{results.feasibility?.blockers?.length > 0 && <div className="surface-card border-rose-200 bg-rose-50"><h2 className="font-black text-rose-950">The feasible envelope is empty</h2><ul className="mt-3 space-y-2 text-sm text-rose-900">{results.feasibility.blockers.map((item: any, i: number) => <li key={i} className="flex gap-2"><XCircle className="mt-0.5 h-4 w-4 shrink-0"/>{item.message}</li>)}</ul></div>}{results.candidates?.map((candidate: any, index: number) => <Candidate key={candidate.id} candidate={candidate} index={index} saved={savedIds.includes(candidate.id)} saving={savingId === candidate.id} onSave={() => onSave(candidate, index)}/>)}</section>;
}

function Candidate({ candidate, index, saved, saving, onSave }: any) {
  const failed = candidate.constraint_results?.filter((item: any) => item.status === 'fail') || [], gaps = candidate.constraint_results?.filter((item: any) => item.status === 'not_evaluable') || [];
  return <article className="surface-card overflow-hidden p-0"><div className="flex flex-col justify-between gap-4 border-b border-slate-100 bg-gradient-to-r from-white to-sky-50/60 p-6 md:flex-row md:items-center"><div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-sky-600 font-black text-white">{index + 1}</span><div><div className="flex flex-wrap gap-2"><Badge tone={candidate.feasible ? 'green' : 'red'}>{candidate.feasible ? 'Screening feasible' : 'Infeasible'}</Badge>{candidate.pareto_rank === 1 && <Badge tone="blue">Pareto frontier</Badge>}<Badge tone="slate">{candidate.strategy}</Badge><Badge tone="slate">{candidate.regulatory_screening?.status?.replace('_', ' ')}</Badge></div><h2 className="mt-2 text-xl font-black">Candidate for laboratory validation</h2></div></div><button type="button" onClick={onSave} disabled={!candidate.feasible || saved || saving} className="primary-button">{saving ? <Loader2 className="h-4 w-4 animate-spin"/> : <Save className="h-4 w-4"/>}{saved ? 'Saved' : 'Save exact version'}</button></div>
    <div className="grid gap-6 p-6 xl:grid-cols-[1fr_1.25fr]"><div><h3 className="text-sm font-black">Exact composition · 100%</h3><div className="mt-3 overflow-hidden rounded-2xl border border-slate-200">{candidate.ingredients.map((item: any) => <div key={item.ingredient_id} className="flex justify-between border-b border-slate-100 px-4 py-3 last:border-0"><span><strong className="text-sm">{item.ingredient_name}</strong><small className="ml-2 text-slate-400">{item.category}</small></span><strong className="text-sm tabular-nums">{item.percentage.toFixed(4)}%</strong></div>)}</div><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4"><SmallMetric label="Sugar" value={`${candidate.calculated_values.sugar_per_100ml.toFixed(2)} g`}/><SmallMetric label="Calories" value={`${candidate.calculated_values.calories_per_100ml.toFixed(2)} kcal`}/><SmallMetric label="Cost" value={`${candidate.calculated_values.cost_per_liter.toFixed(2)} DZD/L`}/><SmallMetric label="Reference Δ" value={candidate.reference_comparison?.available ? `${candidate.reference_comparison.absolute_percentage_point_deviation.toFixed(2)} pts` : 'No reference'}/></div><p className="mt-3 text-xs leading-5 text-slate-500">{candidate.regulatory_screening?.note}</p></div>
      <div><h3 className="text-sm font-black">Constraint ledger</h3><div className="mt-3 overflow-x-auto rounded-2xl border border-slate-200"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Constraint</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Actual / limit</th><th className="px-4 py-3">Basis</th></tr></thead><tbody>{candidate.constraint_results.map((item: any) => <tr key={item.key} className="border-t border-slate-100"><td className="px-4 py-3 font-semibold">{item.label}</td><td className="px-4 py-3"><ConstraintStatus status={item.status}/></td><td className="px-4 py-3 tabular-nums text-slate-600">{item.actual ?? 'Measure'} / {item.comparator} {item.limit} {item.unit}</td><td className="max-w-xs px-4 py-3 text-xs text-slate-500">{item.basis}</td></tr>)}</tbody></table></div><div className="mt-4 grid gap-3 md:grid-cols-2"><Note title="Trade-offs" items={candidate.trade_offs}/><Note title="Assumptions" items={candidate.assumptions}/></div>{(failed.length > 0 || gaps.length > 0) && <p className="mt-3 flex items-start gap-2 text-xs text-amber-800"><Info className="mt-0.5 h-4 w-4 shrink-0"/>{failed.length} violated hard constraint(s); {gaps.length} laboratory validation gap(s). Non-evaluable is never treated as passed.</p>}{candidate.ai_explanation && <div className="mt-4 rounded-2xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-950"><p className="font-black">Gemini advisory review</p><p className="mt-1">{candidate.ai_explanation}</p><p className="mt-2 text-xs">This narrative cannot alter feasibility, constraint results or Pareto rank.</p></div>}</div></div></article>;
}

function SectionTitle({ step, title, description, action }: any) { return <div className="flex flex-col justify-between gap-3 border-b border-slate-100 pb-5 md:flex-row md:items-center"><div><p className="eyebrow">{step} · Configuration</p><h2 className="mt-1 text-xl font-black">{title}</h2>{description && <p className="mt-1 text-sm text-slate-500">{description}</p>}</div>{action}</div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-sm font-bold text-slate-700"><span className="mb-2 block">{label}</span>{children}</label>; }
function NumberField({ label, suffix, value, onChange }: { label: string; suffix?: string; value: string; onChange: (value: string) => void }) { return <Field label={label}><div className="relative"><input type="number" min="0" step="any" value={value} onChange={event => onChange(event.target.value)} placeholder="No limit"/>{suffix && <span className="pointer-events-none absolute right-3 top-3 text-xs font-semibold text-slate-400">{suffix}</span>}</div></Field>; }
function NumberInput({ label, value, max = 40, onChange }: { label: string; value: number; max?: number; onChange: (value: number) => void }) { return <Field label={label}><input type="number" min="1" max={max} value={value} onChange={event => onChange(Number(event.target.value))}/></Field>; }
function IngredientSelector({ label, value, ingredients, onChange }: { label: string; value: string[]; ingredients: any[]; onChange: (value: string[]) => void }) { return <Field label={`${label} · ${value.length} selected`}><select multiple size={6} value={value} onChange={event => onChange(Array.from(event.target.selectedOptions, option => option.value))} className="min-h-36">{ingredients.map((item: any) => <option key={item.id} value={item.id}>{item.name} · {item.category}</option>)}</select><span className="mt-1 block text-xs font-normal text-slate-500">Ctrl/Cmd + click to select several ingredients.</span></Field>; }
function BoundEditor({ ingredients, bounds, onChange }: { ingredients: any[]; bounds: Constraints['ingredient_bounds']; onChange: (value: Constraints['ingredient_bounds']) => void }) {
  const [ingredientId, setIngredientId] = useState(''), [minimum, setMinimum] = useState(''), [maximum, setMaximum] = useState('');
  function add() { if (!ingredientId || (minimum === '' && maximum === '')) return; const next = { ingredient_id: ingredientId, ...(minimum === '' ? {} : { min_percentage: Number(minimum) }), ...(maximum === '' ? {} : { max_percentage: Number(maximum) }) }; onChange([...bounds.filter(item => item.ingredient_id !== ingredientId), next]); setIngredientId(''); setMinimum(''); setMaximum(''); }
  return <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/60 p-4"><div className="flex flex-col justify-between gap-2 md:flex-row md:items-end"><div><p className="text-sm font-black">Ingredient-specific bounds</p><p className="text-xs text-slate-500">Override a catalog limit or impose a minimum inclusion level.</p></div><div className="grid gap-2 sm:grid-cols-[minmax(12rem,1fr)_7rem_7rem_auto]"><select aria-label="Bounded ingredient" value={ingredientId} onChange={event => setIngredientId(event.target.value)}><option value="">Choose ingredient</option>{ingredients.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><input aria-label="Minimum ingredient percentage" type="number" min="0" max="100" step="any" value={minimum} onChange={event => setMinimum(event.target.value)} placeholder="Min %"/><input aria-label="Maximum ingredient percentage" type="number" min="0" max="100" step="any" value={maximum} onChange={event => setMaximum(event.target.value)} placeholder="Max %"/><button type="button" onClick={add} className="secondary-button justify-center">Add bound</button></div></div>{bounds.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{bounds.map(bound => <button type="button" key={bound.ingredient_id} onClick={() => onChange(bounds.filter(item => item.ingredient_id !== bound.ingredient_id))} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:border-rose-300 hover:text-rose-700">{ingredients.find(item => item.id === bound.ingredient_id)?.name || bound.ingredient_id}: {bound.min_percentage ?? '—'}–{bound.max_percentage ?? '—'}% ×</button>)}</div>}</div>;
}
function Metric({ label, value, icon }: any) { return <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-sky-50 text-sky-700 [&>svg]:h-5 [&>svg]:w-5">{icon}</span><div><p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p><p className="font-black">{value}</p></div></div>; }
function SmallMetric({ label, value }: any) { return <div className="rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p><p className="mt-1 text-sm font-black">{value}</p></div>; }
function Badge({ tone, children }: any) { const colors: any = { green: 'bg-emerald-100 text-emerald-800', red: 'bg-rose-100 text-rose-800', blue: 'bg-sky-100 text-sky-800', slate: 'bg-slate-100 text-slate-700' }; return <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${colors[tone]}`}>{children}</span>; }
function ConstraintStatus({ status }: any) { return status === 'pass' ? <Badge tone="green">Pass</Badge> : status === 'fail' ? <Badge tone="red">Fail</Badge> : <Badge tone="slate">Lab check</Badge>; }
function Note({ title, items }: any) { return <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-black uppercase tracking-wide text-slate-500">{title}</p><ul className="mt-2 space-y-1 text-xs leading-5 text-slate-600">{items.map((item: string, index: number) => <li key={index}>• {item}</li>)}</ul></div>; }
