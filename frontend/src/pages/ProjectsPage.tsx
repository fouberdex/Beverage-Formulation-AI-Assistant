import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CalendarDays, Check, CircleDot, FolderKanban, Plus, Search, Sparkles, X } from 'lucide-react';
import { projectsAPI } from '../services/api';
import { Link, useSearchParams } from 'react-router-dom';
import { getErrorMessage } from '../services/errors';
import type { ProjectStage, RDProject } from '../types';
import Pagination from '../components/Pagination';
import StatusMessage from '../components/StatusMessage';
import ProjectExecutionWorkspace from '../components/ProjectExecutionWorkspace';
import { CardSkeleton } from '../components/LoadingState';

const stages: Array<{ key: ProjectStage; label: string }> = [
  { key: 'brief', label: 'Brief' }, { key: 'concept', label: 'Concept' },
  { key: 'formulation', label: 'Formulation' }, { key: 'laboratory', label: 'Laboratory' },
  { key: 'sensory', label: 'Sensory' }, { key: 'validation', label: 'Validation' },
  { key: 'industrialization', label: 'Industrialization' }, { key: 'launched', label: 'Launched' },
];

const emptyForm = {
  name: '', code: '', business_objective: '', target_market: '', beverage_category: '', target_claims: '', priority: 'normal', due_date: '',
  required_ingredients: '', forbidden_ingredients: '', ingredient_notes: '', max_cost_per_liter: '', max_sugar: '', max_calories: '',
  target_ph_min: '', target_ph_max: '', regulatory_markets: '', certifications: '', forbidden_additives: '', success_criteria: '',
};

export default function ProjectsPage() {
  const [searchParams] = useSearchParams();
  const requestedProjectId = searchParams.get('project');
  const [projects, setProjects] = useState<RDProject[]>([]);
  const [selected, setSelected] = useState<RDProject | null>(null);
  const [allowedTransitions, setAllowedTransitions] = useState<ProjectStage[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const pageSize = 12;

  async function loadProjects() {
    setLoading(true); setError('');
    try {
      const response = await projectsAPI.getAll({ search, status, limit: pageSize, offset: (page - 1) * pageSize });
      setProjects(response.data.data); setTotal(response.data.pagination.total);
      if (selected) {
        const stillListed = response.data.data.find((item: RDProject) => item.id === selected.id);
        if (stillListed) await selectProject(stillListed);
      }
    } catch (cause) { setError(getErrorMessage(cause, 'Unable to load R&D projects.')); }
    finally { setLoading(false); }
  }

  useEffect(() => { const timer = window.setTimeout(() => void loadProjects(), 200); return () => window.clearTimeout(timer); }, [search, status, page]);
  useEffect(() => setPage(1), [search, status]);
  useEffect(() => { if (requestedProjectId && selected?.id !== requestedProjectId) void selectProject({ id: requestedProjectId } as RDProject); }, [requestedProjectId]);

  async function selectProject(project: RDProject) {
    setError('');
    try {
      const response = await projectsAPI.getById(project.id);
      setSelected(response.data.data); setAllowedTransitions(response.data.allowed_transitions);
    } catch (cause) { setError(getErrorMessage(cause, 'Unable to open this project.')); }
  }

  function openCreate() { setSelected(null); setForm(emptyForm); setEditing(true); }
  function openEdit() {
    if (!selected) return;
    setForm({
      name: selected.name, code: selected.code, business_objective: selected.business_objective,
      target_market: selected.target_market, beverage_category: selected.beverage_category,
      target_claims: selected.target_claims.join(', '), priority: selected.priority, due_date: selected.due_date || '',
      required_ingredients: selected.ingredient_constraints?.required?.join(', ') || '', forbidden_ingredients: selected.ingredient_constraints?.forbidden?.join(', ') || '',
      ingredient_notes: selected.ingredient_constraints?.notes || '', max_cost_per_liter: String(selected.cost_objectives?.max_cost_per_liter || ''),
      max_sugar: String(selected.nutrition_objectives?.max_sugar_g_per_100ml || ''), max_calories: String(selected.nutrition_objectives?.max_calories_per_100ml || ''),
      target_ph_min: String(selected.nutrition_objectives?.target_ph_min ?? ''), target_ph_max: String(selected.nutrition_objectives?.target_ph_max ?? ''),
      regulatory_markets: selected.regulatory_constraints?.markets?.join(', ') || '', certifications: selected.regulatory_constraints?.certifications?.join(', ') || '',
      forbidden_additives: selected.regulatory_constraints?.forbidden_additives?.join(', ') || '', success_criteria: selected.success_criteria?.join('\n') || '',
    });
    setEditing(true);
  }

  function list(value: string) { return value.split(',').map(item => item.trim()).filter(Boolean); }
  function optionalNumber(value: string) { return value === '' ? undefined : Number(value); }
  function briefPayload() {
    return {
      business_objective: form.business_objective, target_market: form.target_market, beverage_category: form.beverage_category,
      target_claims: list(form.target_claims),
      ingredient_constraints: { required: list(form.required_ingredients), forbidden: list(form.forbidden_ingredients), notes: form.ingredient_notes },
      cost_objectives: { max_cost_per_liter: optionalNumber(form.max_cost_per_liter), currency: 'DZD' },
      nutrition_objectives: { max_sugar_g_per_100ml: optionalNumber(form.max_sugar), max_calories_per_100ml: optionalNumber(form.max_calories), target_ph_min: optionalNumber(form.target_ph_min), target_ph_max: optionalNumber(form.target_ph_max) },
      regulatory_constraints: { markets: list(form.regulatory_markets), certifications: list(form.certifications), forbidden_additives: list(form.forbidden_additives) },
      success_criteria: form.success_criteria.split('\n').map(item => item.trim()).filter(Boolean),
    };
  }

  async function saveProject(event?: React.FormEvent, validate = false) {
    event?.preventDefault(); setError(''); setMessage('');
    const brief = briefPayload();
    const payload = { name: form.name, due_date: form.due_date || null, code: form.code || undefined, priority: form.priority, ...brief };
    try {
      const response = selected ? await projectsAPI.update(selected.id, payload) : await projectsAPI.create(payload);
      const saved = validate ? await projectsAPI.updateBrief(response.data.data.id, brief, true) : response;
      setEditing(false); setMessage(validate ? 'Structured brief validated.' : selected ? 'Project and draft brief updated.' : 'Project and draft brief created.');
      await loadProjects(); await selectProject(response.data.data);
      if (validate) await selectProject(saved.data.data);
    } catch (cause) { setError(getErrorMessage(cause, 'Unable to save the project.')); }
  }

  async function transition(stage: ProjectStage) {
    if (!selected) return;
    setError(''); setMessage('');
    try {
      const response = await projectsAPI.transition(selected.id, stage);
      setMessage(`Project moved to ${stages.find(item => item.key === stage)?.label}.`);
      await loadProjects(); await selectProject(response.data.data);
    } catch (cause) { setError(getErrorMessage(cause, 'Unable to move the project.')); }
  }

  const currentStageIndex = selected ? stages.findIndex(item => item.key === selected.stage) : -1;
  const activeCount = useMemo(() => projects.filter(item => item.status === 'active').length, [projects]);

  return <div className="space-y-6">
    <header className="hero-panel">
      <div><span className="hero-kicker"><FolderKanban className="h-4 w-4"/> R&D portfolio</span><h1>Projects</h1><p>Drive each beverage from brief to launch with controlled gates, visible priorities and a durable decision trail.</p></div>
      <button type="button" onClick={openCreate} className="primary-button"><Plus className="h-4 w-4"/> New project</button>
    </header>

    <StatusMessage error={error} message={message}/>

    <section className="grid gap-4 sm:grid-cols-3" aria-label="Project overview">
      <div className="surface-card"><p className="eyebrow">Portfolio</p><p className="mt-2 text-3xl font-black text-slate-950">{total}</p><p className="text-sm text-slate-500">owned projects</p></div>
      <div className="surface-card"><p className="eyebrow">In motion</p><p className="mt-2 text-3xl font-black text-sky-700">{activeCount}</p><p className="text-sm text-slate-500">active on this page</p></div>
      <div className="surface-card"><p className="eyebrow">Operating rule</p><p className="mt-2 font-bold text-slate-950">One validated gate at a time</p><p className="text-sm text-slate-500">No silent stage skipping</p></div>
    </section>

    <section className="surface-card">
      <div className="grid gap-3 md:grid-cols-[1fr_14rem]">
        <label className="relative"><span className="sr-only">Search projects</span><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400"/><input value={search} onChange={event => setSearch(event.target.value)} className="w-full pl-10" placeholder="Search code, project, market or category…"/></label>
        <select aria-label="Filter by status" value={status} onChange={event => setStatus(event.target.value)}><option value="all">All statuses</option><option value="draft">Draft</option><option value="active">Active</option><option value="on_hold">On hold</option><option value="completed">Completed</option><option value="archived">Archived</option></select>
      </div>
    </section>

    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(24rem,.72fr)]">
      <section className="space-y-3" aria-label="Project list">
        {loading && <CardSkeleton count={3}/>} 
        {!loading && projects.length === 0 && <div className="surface-card py-14 text-center"><FolderKanban className="mx-auto h-10 w-10 text-sky-400"/><h2 className="mt-4 text-xl font-black">No matching project</h2><p className="mt-1 text-slate-500">Create the first R&D brief or change the filters.</p><button onClick={openCreate} className="primary-button mt-5"><Plus className="h-4 w-4"/> New project</button></div>}
        {projects.map(project => <button type="button" key={project.id} onClick={() => void selectProject(project)} className={`surface-card w-full text-left transition hover:-translate-y-0.5 hover:border-sky-300 ${selected?.id === project.id ? 'border-sky-400 ring-2 ring-sky-100' : ''}`}>
          <div className="flex items-start justify-between gap-4"><div><p className="eyebrow">{project.code}</p><h2 className="mt-1 text-lg font-black text-slate-950">{project.name}</h2><p className="mt-1 line-clamp-2 text-sm text-slate-500">{project.business_objective || 'Business objective to complete'}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${project.priority === 'critical' ? 'bg-rose-100 text-rose-700' : project.priority === 'high' ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-600'}`}>{project.priority}</span></div>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500"><span className="rounded-full bg-sky-50 px-2.5 py-1 text-sky-700">{stages.find(item => item.key === project.stage)?.label}</span><span>{project.status.replace('_', ' ')}</span>{project.due_date && <span className="ml-auto flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5"/>{project.due_date}</span>}</div>
        </button>)}
        <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} label="R&D projects"/>
      </section>

      <aside className="surface-card h-fit xl:sticky xl:top-6">
        {!selected ? <div className="py-10 text-center"><Sparkles className="mx-auto h-9 w-9 text-sky-400"/><h2 className="mt-3 text-lg font-black">Select a project</h2><p className="mt-1 text-sm text-slate-500">Its gates, next actions and history will appear here.</p></div> : <>
          <div className="flex items-start justify-between gap-3"><div><p className="eyebrow">{selected.code}</p><h2 className="mt-1 text-xl font-black text-slate-950">{selected.name}</h2></div><button type="button" onClick={openEdit} className="secondary-button">Edit</button></div>
          <div className="mt-6 overflow-x-auto pb-2"><div className="flex min-w-[46rem] items-center">{stages.map((stage, index) => <div key={stage.key} className="flex flex-1 items-center"><div className="flex min-w-16 flex-col items-center text-center"><span className={`flex h-8 w-8 items-center justify-center rounded-full border-2 ${index < currentStageIndex ? 'border-emerald-500 bg-emerald-500 text-white' : index === currentStageIndex ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-slate-200 bg-white text-slate-400'}`}>{index < currentStageIndex ? <Check className="h-4 w-4"/> : <CircleDot className="h-4 w-4"/>}</span><span className="mt-1 text-[10px] font-bold text-slate-600">{stage.label}</span></div>{index < stages.length - 1 && <span className={`mb-4 h-0.5 flex-1 ${index < currentStageIndex ? 'bg-emerald-400' : 'bg-slate-200'}`}/>}</div>)}</div></div>
          <dl className="mt-5 grid gap-3 rounded-2xl bg-slate-50 p-4 text-sm"><div><dt className="font-bold text-slate-500">Objective</dt><dd className="mt-1 text-slate-800">{selected.business_objective || 'Not documented'}</dd></div><div className="grid grid-cols-2 gap-3"><div><dt className="font-bold text-slate-500">Market</dt><dd className="mt-1 text-slate-800">{selected.target_market || '—'}</dd></div><div><dt className="font-bold text-slate-500">Category</dt><dd className="mt-1 text-slate-800">{selected.beverage_category || '—'}</dd></div></div></dl>
          <div className={`mt-4 rounded-2xl border p-4 ${selected.brief_status === 'validated' ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}><p className="text-sm font-black text-slate-900">Structured brief · {selected.brief_status || 'draft'}</p><p className="mt-1 text-xs text-slate-600">{selected.success_criteria?.length || 0} success criteria · {selected.ingredient_constraints?.required?.length || 0} required ingredients · {selected.ingredient_constraints?.forbidden?.length || 0} forbidden</p></div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center"><div className="rounded-xl border border-slate-200 p-3"><p className="text-xl font-black">{selected.traceability?.formulations.length || 0}</p><p className="text-[11px] text-slate-500">Versions</p></div><div className="rounded-xl border border-slate-200 p-3"><p className="text-xl font-black">{selected.traceability?.laboratory_results.length || 0}</p><p className="text-[11px] text-slate-500">Lab results</p></div><div className="rounded-xl border border-slate-200 p-3"><p className="text-xl font-black">{selected.traceability?.sensory_studies.length || 0}</p><p className="text-[11px] text-slate-500">Sensory</p></div></div>
          <div className="mt-3 flex gap-2"><Link to="/formulations" className="secondary-button flex-1 justify-center">Formulations</Link><Link to="/laboratory-results" className="secondary-button flex-1 justify-center">Laboratory</Link><Link to="/sensory" className="secondary-button flex-1 justify-center">Sensory</Link></div>
          <div className="mt-5"><p className="eyebrow">Next controlled action</p>{allowedTransitions.length ? <div className="mt-2 flex flex-wrap gap-2">{allowedTransitions.map(stage => <button key={stage} type="button" onClick={() => void transition(stage)} className="primary-button">Move to {stages.find(item => item.key === stage)?.label}<ArrowRight className="h-4 w-4"/></button>)}</div> : <p className="mt-2 text-sm text-slate-500">No further transition is available.</p>}</div>
          <div className="mt-6"><p className="eyebrow">Decision trail</p><div className="mt-3 space-y-3">{selected.events?.slice(0, 6).map(event => <div key={event.id} className="border-l-2 border-sky-200 pl-3"><p className="text-sm font-bold text-slate-800">{event.event_type.replace('_', ' ')}</p><p className="text-xs text-slate-500">{new Date(event.created_at).toLocaleString()}</p></div>)}</div></div>
        </>}
      </aside>
    </div>

    {selected && <ProjectExecutionWorkspace
      project={selected}
      onRefresh={async () => { await loadProjects(); await selectProject(selected); }}
    />}

    {editing && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setEditing(false); }}><section role="dialog" aria-modal="true" aria-labelledby="project-form-title" className="surface-card max-h-[90vh] w-full max-w-2xl overflow-y-auto">
      <div className="flex items-start justify-between"><div><p className="eyebrow">Project brief</p><h2 id="project-form-title" className="mt-1 text-2xl font-black">{selected ? 'Edit project' : 'New R&D project'}</h2></div><button type="button" aria-label="Close" onClick={() => setEditing(false)} className="rounded-xl border border-slate-200 p-2 text-slate-500"><X className="h-4 w-4"/></button></div>
      <form onSubmit={event => void saveProject(event)} className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="sm:col-span-2"><span>Project name</span><input required minLength={2} value={form.name} onChange={event => setForm({...form, name: event.target.value})}/></label>
        <label><span>Project code</span><input value={form.code} onChange={event => setForm({...form, code: event.target.value})} placeholder="Generated if empty"/></label>
        <label><span>Priority</span><select value={form.priority} onChange={event => setForm({...form, priority: event.target.value})}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option></select></label>
        <label><span>Target market</span><input value={form.target_market} onChange={event => setForm({...form, target_market: event.target.value})}/></label>
        <label><span>Beverage category</span><input value={form.beverage_category} onChange={event => setForm({...form, beverage_category: event.target.value})}/></label>
        <label><span>Due date</span><input type="date" value={form.due_date} onChange={event => setForm({...form, due_date: event.target.value})}/></label>
        <label><span>Target claims</span><input value={form.target_claims} onChange={event => setForm({...form, target_claims: event.target.value})} placeholder="Low sugar, natural flavour"/></label>
        <label className="sm:col-span-2"><span>Business objective</span><textarea rows={3} value={form.business_objective} onChange={event => setForm({...form, business_objective: event.target.value})}/></label>
        <div className="sm:col-span-2 border-t border-slate-200 pt-4"><p className="eyebrow">Ingredient constraints</p></div>
        <label><span>Required ingredients</span><input value={form.required_ingredients} onChange={event => setForm({...form, required_ingredients: event.target.value})} placeholder="Orange juice, vitamin C"/></label>
        <label><span>Forbidden ingredients</span><input value={form.forbidden_ingredients} onChange={event => setForm({...form, forbidden_ingredients: event.target.value})} placeholder="Aspartame, artificial colours"/></label>
        <label className="sm:col-span-2"><span>Constraint notes</span><textarea rows={2} value={form.ingredient_notes} onChange={event => setForm({...form, ingredient_notes: event.target.value})}/></label>
        <div className="sm:col-span-2 border-t border-slate-200 pt-4"><p className="eyebrow">Measurable objectives</p></div>
        <label><span>Maximum cost (DZD/L)</span><input type="number" min="0" step="0.01" value={form.max_cost_per_liter} onChange={event => setForm({...form, max_cost_per_liter: event.target.value})}/></label>
        <label><span>Maximum sugar (g/100 mL)</span><input type="number" min="0" step="0.01" value={form.max_sugar} onChange={event => setForm({...form, max_sugar: event.target.value})}/></label>
        <label><span>Maximum calories (/100 mL)</span><input type="number" min="0" step="0.01" value={form.max_calories} onChange={event => setForm({...form, max_calories: event.target.value})}/></label>
        <div className="grid grid-cols-2 gap-2"><label><span>pH minimum</span><input type="number" min="0" max="14" step="0.01" value={form.target_ph_min} onChange={event => setForm({...form, target_ph_min: event.target.value})}/></label><label><span>pH maximum</span><input type="number" min="0" max="14" step="0.01" value={form.target_ph_max} onChange={event => setForm({...form, target_ph_max: event.target.value})}/></label></div>
        <div className="sm:col-span-2 border-t border-slate-200 pt-4"><p className="eyebrow">Regulatory and success gates</p></div>
        <label><span>Regulatory markets</span><input value={form.regulatory_markets} onChange={event => setForm({...form, regulatory_markets: event.target.value})} placeholder="Algeria, EU"/></label>
        <label><span>Certifications</span><input value={form.certifications} onChange={event => setForm({...form, certifications: event.target.value})} placeholder="Halal, ISO 22000"/></label>
        <label className="sm:col-span-2"><span>Forbidden additives</span><input value={form.forbidden_additives} onChange={event => setForm({...form, forbidden_additives: event.target.value})}/></label>
        <label className="sm:col-span-2"><span>Success criteria (one per line)</span><textarea rows={4} value={form.success_criteria} onChange={event => setForm({...form, success_criteria: event.target.value})} placeholder={'Cost ≤ 55 DZD/L\nSensory liking ≥ 7/10\nNo visible sediment after 12 weeks'}/></label>
        <div className="sm:col-span-2 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4"><button type="button" onClick={() => setEditing(false)} className="secondary-button">Cancel</button><button type="submit" className="secondary-button">Save as draft</button><button type="button" onClick={() => void saveProject(undefined, true)} className="primary-button">Validate brief</button></div>
      </form>
    </section></div>}
  </div>;
}
