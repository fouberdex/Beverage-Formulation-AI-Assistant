import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CalendarDays, CircleDot, FolderKanban, Plus, Search, Sparkles, X } from 'lucide-react';
import { projectsAPI } from '../services/api';
import { Link, useSearchParams } from 'react-router-dom';
import { getErrorMessage } from '../services/errors';
import type { ProjectStage, RDProject } from '../types';
import Pagination from '../components/Pagination';
import StatusMessage from '../components/StatusMessage';
import ProjectExecutionWorkspace from '../components/ProjectExecutionWorkspace';
import { CardSkeleton } from '../components/LoadingState';
import ProjectWorkflow, { deriveProjectWorkflow } from '../components/ProjectWorkflow';

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
  const [saving, setSaving] = useState(false);
  const pageSize = 12;

  async function loadProjects(refreshSelected = true) {
    setLoading(true); setError('');
    try {
      const response = await projectsAPI.getAll({ search, status, limit: pageSize, offset: (page - 1) * pageSize });
      setProjects(response.data.data); setTotal(response.data.pagination.total);
      if (refreshSelected && selected) {
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
    setSaving(true);
    try {
      const response = selected ? await projectsAPI.update(selected.id, payload) : await projectsAPI.create(payload);
      if (validate) await projectsAPI.updateBrief(response.data.data.id, brief, true);
      setEditing(false); setMessage(validate ? 'Structured brief validated.' : selected ? 'Project and draft brief updated.' : 'Project and draft brief created.');
      await loadProjects(false);
      await selectProject({ id: response.data.data.id } as RDProject);
    } catch (cause) { setError(getErrorMessage(cause, 'Unable to save the project.')); }
    finally { setSaving(false); }
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
  const selectedWorkflow = selected ? deriveProjectWorkflow(selected) : null;

  return <div className="space-y-6">
    <header className="hero-panel">
      <div><span className="hero-kicker"><FolderKanban className="h-4 w-4"/> R&D portfolio</span><h1>Projects</h1><p>Drive each beverage from brief to launch with controlled gates, visible priorities and a durable decision trail.</p></div>
      <button type="button" onClick={openCreate} className="primary-button"><Plus className="h-4 w-4"/> New project</button>
    </header>

    <StatusMessage error={error} message={message}/>

    {selected && selectedWorkflow && <section className="sticky top-[60px] z-30 -mx-1 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur" aria-label="Current project context">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="status-badge info">{selected.code}</span><strong className="truncate text-primary">{selected.name}</strong><span className="status-badge neutral">{stages.find(item => item.key === selected.stage)?.label}</span>{selected.product_passport && <span className={`status-badge ${selected.product_passport.readiness.status === 'blocked' ? 'danger' : 'success'}`}>{selected.product_passport.readiness.score_percent}% readiness</span>}</div><p className="mt-1 truncate text-xs text-secondary">{selectedWorkflow.activeVersion ? `Evaluating ${selectedWorkflow.activeVersion.name} · v${selectedWorkflow.activeVersion.version}` : 'No exact formulation version under evaluation'}{selectedWorkflow.blockers.length ? ` · ${selectedWorkflow.blockers.length} blocker(s)` : ''}</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={openEdit} className="secondary-button">Edit brief</button><a href="#project-workflow" className="secondary-button">Workflow</a><a href="#project-execution" className="primary-button">Open workspace</a></div></div>
    </section>}

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
          <div className="mt-5 rounded-2xl bg-secondary p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold text-secondary">Lifecycle position</p><p className="mt-1 font-black text-primary">{stages[currentStageIndex]?.label}</p></div><span className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-sky-500 bg-sky-50 text-sky-700"><CircleDot className="h-5 w-5"/></span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200"><span className="block h-full rounded-full bg-sky-500" style={{width:`${Math.max(5,((currentStageIndex+1)/stages.length)*100)}%`}}/></div><p className="mt-2 text-xs text-secondary">Stage {currentStageIndex + 1} of {stages.length}; evidence gates still control every transition.</p></div>
          <dl className="mt-5 grid gap-3 rounded-2xl bg-slate-50 p-4 text-sm"><div><dt className="font-bold text-slate-500">Objective</dt><dd className="mt-1 text-slate-800">{selected.business_objective || 'Not documented'}</dd></div><div className="grid grid-cols-2 gap-3"><div><dt className="font-bold text-slate-500">Market</dt><dd className="mt-1 text-slate-800">{selected.target_market || '—'}</dd></div><div><dt className="font-bold text-slate-500">Category</dt><dd className="mt-1 text-slate-800">{selected.beverage_category || '—'}</dd></div></div></dl>
          <div className={`mt-4 rounded-2xl border p-4 ${selected.brief_status === 'validated' ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}><p className="text-sm font-black text-slate-900">Structured brief · {selected.brief_status || 'draft'}</p><p className="mt-1 text-xs text-slate-600">{selected.success_criteria?.length || 0} success criteria · {selected.ingredient_constraints?.required?.length || 0} required ingredients · {selected.ingredient_constraints?.forbidden?.length || 0} forbidden</p></div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center"><div className="rounded-xl border border-slate-200 p-3"><p className="text-xl font-black">{selected.traceability?.formulations.length || 0}</p><p className="text-[11px] text-slate-500">Versions</p></div><div className="rounded-xl border border-slate-200 p-3"><p className="text-xl font-black">{selected.traceability?.laboratory_results.length || 0}</p><p className="text-[11px] text-slate-500">Lab results</p></div><div className="rounded-xl border border-slate-200 p-3"><p className="text-xl font-black">{selected.traceability?.sensory_studies.length || 0}</p><p className="text-[11px] text-slate-500">Sensory</p></div></div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3"><Link to={`/formulations?project=${selected.id}`} className="secondary-button justify-center">Formulations</Link><Link to={`/laboratory-results?project=${selected.id}&formulation=${selectedWorkflow?.activeVersion?.id || ''}`} className="secondary-button justify-center">Laboratory</Link><Link to={`/sensory?project=${selected.id}`} className="secondary-button justify-center">Sensory</Link></div>
          <div className="mt-5"><p className="eyebrow">Next controlled action</p>{allowedTransitions.length ? <div className="mt-2 flex flex-wrap gap-2">{allowedTransitions.map(stage => <button key={stage} type="button" onClick={() => void transition(stage)} className="primary-button">Move to {stages.find(item => item.key === stage)?.label}<ArrowRight className="h-4 w-4"/></button>)}</div> : <p className="mt-2 text-sm text-slate-500">No further transition is available.</p>}</div>
          <div className="mt-6"><p className="eyebrow">Decision trail</p><div className="mt-3 space-y-3">{selected.events?.slice(0, 6).map(event => <div key={event.id} className="border-l-2 border-sky-200 pl-3"><p className="text-sm font-bold text-slate-800">{event.event_type.replace('_', ' ')}</p><p className="text-xs text-slate-500">{new Date(event.created_at).toLocaleString()}</p></div>)}</div></div>
        </>}
      </aside>
    </div>

    {selected && <div id="project-workflow" className="scroll-mt-36"><ProjectWorkflow project={selected}/></div>}

    {selected && <div id="project-execution" className="scroll-mt-36"><ProjectExecutionWorkspace
      project={selected}
      onRefresh={async () => { await loadProjects(); await selectProject(selected); }}
    /></div>}

    {editing && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/40 p-2 backdrop-blur-sm sm:p-4" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !saving) setEditing(false); }}><section role="dialog" aria-modal="true" aria-labelledby="project-form-title" className="project-brief-dialog surface-card max-h-[96vh] overflow-y-auto p-0 sm:max-h-[92vh]">
      <div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-200 bg-white/95 px-4 py-4 backdrop-blur sm:px-6"><div><p className="eyebrow">Structured project brief</p><h2 id="project-form-title" className="mt-1 text-2xl font-black text-primary">{selected ? 'Edit project' : 'New R&D project'}</h2><p className="mt-1 text-sm text-secondary">Define the constraints and measurable gates that will govern every downstream version and experiment.</p></div><button type="button" aria-label="Close" disabled={saving} onClick={() => setEditing(false)} className="secondary-button !p-2"><X className="h-4 w-4"/></button></div>
      <form data-project-brief-form onSubmit={event => void saveProject(event)} aria-busy={saving} className="space-y-5 p-4 sm:p-6">
        <ProjectFormSection title="Project identity" description="Stable identity, ownership priority and planning date."><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><label className="md:col-span-2"><span>Project name</span><input required minLength={2} value={form.name} onChange={event => setForm({...form, name: event.target.value})}/></label><label><span>Project code</span><input value={form.code} onChange={event => setForm({...form, code: event.target.value})} placeholder="Generated if empty"/></label><label><span>Priority</span><select value={form.priority} onChange={event => setForm({...form, priority: event.target.value})}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option></select></label><label><span>Due date</span><input type="date" value={form.due_date} onChange={event => setForm({...form, due_date: event.target.value})}/></label></div></ProjectFormSection>
        <ProjectFormSection title="Business brief" description="Commercial intent and product positioning that the technical work must support."><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"><label><span>Target market</span><input value={form.target_market} onChange={event => setForm({...form, target_market: event.target.value})}/></label><label><span>Beverage category</span><input value={form.beverage_category} onChange={event => setForm({...form, beverage_category: event.target.value})}/></label><label><span>Target claims</span><input value={form.target_claims} onChange={event => setForm({...form, target_claims: event.target.value})} placeholder="Low sugar, natural flavour"/></label><label className="md:col-span-2 xl:col-span-3"><span>Business objective</span><textarea rows={3} value={form.business_objective} onChange={event => setForm({...form, business_objective: event.target.value})}/></label></div></ProjectFormSection>
        <div className="grid gap-5 xl:grid-cols-2">
          <ProjectFormSection title="Ingredient constraints" description="Required and forbidden materials inherited by formulation work."><div className="grid gap-4 md:grid-cols-2"><label><span>Required ingredients</span><input value={form.required_ingredients} onChange={event => setForm({...form, required_ingredients: event.target.value})} placeholder="Orange juice, vitamin C"/></label><label><span>Forbidden ingredients</span><input value={form.forbidden_ingredients} onChange={event => setForm({...form, forbidden_ingredients: event.target.value})} placeholder="Aspartame, artificial colours"/></label><label className="md:col-span-2"><span>Constraint notes</span><textarea rows={3} value={form.ingredient_notes} onChange={event => setForm({...form, ingredient_notes: event.target.value})}/></label></div></ProjectFormSection>
          <ProjectFormSection title="Nutrition / formulation targets" description="Quantified screening targets; laboratory evidence remains authoritative."><div className="grid gap-4 sm:grid-cols-2"><label><span>Maximum sugar (g/100 mL)</span><input type="number" min="0" step="0.01" value={form.max_sugar} onChange={event => setForm({...form, max_sugar: event.target.value})}/></label><label><span>Maximum calories (/100 mL)</span><input type="number" min="0" step="0.01" value={form.max_calories} onChange={event => setForm({...form, max_calories: event.target.value})}/></label><label><span>Target pH minimum</span><input type="number" min="0" max="14" step="0.01" value={form.target_ph_min} onChange={event => setForm({...form, target_ph_min: event.target.value})}/></label><label><span>Target pH maximum</span><input type="number" min="0" max="14" step="0.01" value={form.target_ph_max} onChange={event => setForm({...form, target_ph_max: event.target.value})}/></label></div></ProjectFormSection>
          <ProjectFormSection title="Cost target" description="Planning ceiling used by deterministic formulation economics."><div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]"><label><span>Maximum cost per liter</span><input type="number" min="0" step="0.01" value={form.max_cost_per_liter} onChange={event => setForm({...form, max_cost_per_liter: event.target.value})}/></label><label><span>Currency</span><input value="DZD" readOnly aria-readonly="true"/></label></div></ProjectFormSection>
          <ProjectFormSection title="Regulatory requirements" description="Markets and exclusions that must remain visible during design and approval."><div className="grid gap-4 md:grid-cols-2"><label><span>Regulatory markets</span><input value={form.regulatory_markets} onChange={event => setForm({...form, regulatory_markets: event.target.value})} placeholder="Algeria, EU"/></label><label><span>Certifications</span><input value={form.certifications} onChange={event => setForm({...form, certifications: event.target.value})} placeholder="Halal, ISO 22000"/></label><label className="md:col-span-2"><span>Forbidden additives</span><input value={form.forbidden_additives} onChange={event => setForm({...form, forbidden_additives: event.target.value})}/></label></div></ProjectFormSection>
        </div>
        <ProjectFormSection title="Success criteria" description="One measurable acceptance criterion per line; these become the basis of project gates."><label><span className="sr-only">Success criteria (one per line)</span><textarea rows={4} value={form.success_criteria} onChange={event => setForm({...form, success_criteria: event.target.value})} placeholder={'Cost ≤ 55 DZD/L\nSensory liking ≥ 7/10\nNo visible sediment after 12 weeks'}/></label></ProjectFormSection>
        <div className="sticky bottom-0 -mx-4 -mb-4 flex flex-col-reverse gap-2 border-t border-slate-200 bg-white/95 px-4 py-4 backdrop-blur sm:-mx-6 sm:-mb-6 sm:flex-row sm:justify-end sm:px-6"><button type="button" disabled={saving} onClick={() => setEditing(false)} className="secondary-button justify-center">Cancel</button><button type="submit" disabled={saving} className="secondary-button justify-center">{saving ? 'Saving…' : 'Save as draft'}</button><button type="button" disabled={saving || !form.name.trim()} onClick={() => void saveProject(undefined, true)} className="primary-button justify-center">{saving ? 'Validating…' : 'Validate brief'}</button></div>
      </form>
    </section></div>}
  </div>;
}

function ProjectFormSection({title, description, children}:{title:string;description:string;children:React.ReactNode}){return <fieldset className="rounded-2xl border border-slate-200 bg-secondary p-4"><legend className="px-2 text-sm font-black text-primary">{title}</legend><p className="mb-4 text-xs leading-5 text-secondary">{description}</p>{children}</fieldset>}
