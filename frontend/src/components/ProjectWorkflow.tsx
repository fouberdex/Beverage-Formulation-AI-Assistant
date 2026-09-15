import { AlertTriangle, Check, Circle, LockKeyhole, RotateCcw } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { RDProject } from '../types';

type StepState = 'complete' | 'active' | 'waiting' | 'attention' | 'blocked';
type WorkflowStep = { key: string; label: string; state: StepState; detail: string };
export type ProjectWorkflowState = {
  steps: WorkflowStep[];
  nextAction: { label: string; detail: string; to: string };
  activeVersion: NonNullable<RDProject['traceability']>['formulations'][number] | null;
  blockers: string[];
  shouldReformulate: boolean;
};

const finished = (value?: string) => ['completed', 'approved', 'released', 'effectiveness_verified'].includes(value || '');

export function deriveProjectWorkflow(project: RDProject): ProjectWorkflowState {
  const trace = project.traceability;
  const versions = trace?.formulations || [];
  const approved = versions.filter(version => version.status === 'approved' || Boolean(version.locked_at));
  const plans = trace?.experimental_plans || [];
  const batches = trace?.pilot_batches || [];
  const lab = trace?.laboratory_results || [];
  const sensory = trace?.sensory_studies || [];
  const stability = trace?.stability_programs || [];
  const decisions = trace?.decisions || [];
  const specifications = trace?.product_specifications || [];
  const packaging = trace?.packaging_configurations || [];
  const trials = trace?.production_trials || [];
  const releases = trace?.qc_releases || [];
  const events = trace?.quality_events || [];
  const capas = trace?.capa_actions || [];
  const openEvents = events.filter(event => event.status !== 'closed');
  const unresolvedCapas = capas.filter(capa => !['effectiveness_verified', 'cancelled'].includes(capa.status));
  const failedBatch = batches.some(batch => batch.status === 'rejected');
  const failedQc = releases.some(release => ['rejected', 'out_of_specification', 'hold'].includes(release.disposition));
  const reworkDecision = decisions.some(decision => ['no_go', 'rework'].includes(decision.outcome));
  const shouldReformulate = failedBatch || reworkDecision;
  const blockers = [
    ...openEvents.map(event => `${event.severity} ${event.event_type}: ${event.title}`),
    ...unresolvedCapas.map(capa => `CAPA ${capa.status}: ${capa.title}`),
  ];
  const activeVersion = [...versions].sort((a, b) => b.version - a.version).find(version =>
    plans.some(plan => plan.formulation_version_id === version.id && ['ready', 'running'].includes(plan.status)) ||
    batches.some(batch => batch.formulation_version_id === version.id && ['planned', 'in_progress'].includes(batch.status)) ||
    stability.some(program => program.formulation_version_id === version.id && program.status === 'running') ||
    trials.some(trial => trial.formulation_version_id === version.id && ['planned', 'running'].includes(trial.status)),
  ) || [...approved].sort((a, b) => b.version - a.version)[0] || [...versions].sort((a, b) => b.version - a.version)[0] || null;

  const state = (done: boolean, ready: boolean, attention = false, blocked = false): StepState => blocked ? 'blocked' : attention ? 'attention' : done ? 'complete' : ready ? 'active' : 'waiting';
  const steps: WorkflowStep[] = [
    { key: 'brief', label: 'Brief', state: state(project.brief_status === 'validated', true), detail: project.brief_status === 'validated' ? 'Validated' : 'Needs validation' },
    { key: 'formulation', label: 'Formulation', state: state(versions.length > 0, project.brief_status === 'validated', shouldReformulate), detail: versions.length ? `${versions.length} version${versions.length === 1 ? '' : 's'}` : 'Not created' },
    { key: 'approval', label: 'Version approval', state: state(approved.length > 0, versions.length > 0), detail: approved.length ? `v${Math.max(...approved.map(item => item.version))} approved` : versions.length ? 'Review required' : 'Waiting' },
    { key: 'experiment', label: 'Experiment / DOE', state: state(plans.some(plan => finished(plan.status)), approved.length > 0 || plans.length > 0), detail: plans.length ? `${plans.length} plan${plans.length === 1 ? '' : 's'}` : 'Not planned' },
    { key: 'batch', label: 'Pilot / lab batch', state: state(batches.some(batch => batch.status === 'completed'), plans.length > 0, failedBatch), detail: failedBatch ? 'Rejected batch recorded' : batches.length ? `${batches.length} batch${batches.length === 1 ? '' : 'es'}` : 'Not scheduled' },
    { key: 'lab', label: 'Laboratory', state: state(lab.length > 0, batches.length > 0), detail: lab.length ? `${lab.length} result${lab.length === 1 ? '' : 's'}` : 'No measurements' },
    { key: 'sensory', label: 'Sensory', state: state(sensory.some(item => item.status === 'completed'), lab.length > 0 || sensory.length > 0), detail: sensory.length ? `${sensory.length} stud${sensory.length === 1 ? 'y' : 'ies'}` : 'Not started' },
    { key: 'stability', label: 'Stability', state: state(stability.some(item => item.status === 'completed'), approved.length > 0 || stability.length > 0), detail: stability.length ? `${stability.length} program${stability.length === 1 ? '' : 's'}` : 'Not started' },
    { key: 'decision', label: 'Decision', state: state(decisions.length > 0 && !reworkDecision, lab.length > 0 || sensory.length > 0, reworkDecision), detail: reworkDecision ? 'Rework required' : decisions.length ? `${decisions.length} recorded` : 'Not recorded' },
    { key: 'specification', label: 'Specification', state: state(specifications.some(item => item.status === 'approved'), decisions.length > 0), detail: specifications.some(item => item.status === 'approved') ? 'Approved' : 'Not approved' },
    { key: 'packaging', label: 'Supply / packaging', state: state(packaging.some(item => item.status === 'approved'), specifications.length > 0 || packaging.length > 0), detail: packaging.length ? `${packaging.length} configuration${packaging.length === 1 ? '' : 's'}` : 'Not configured' },
    { key: 'production', label: 'Production trial', state: state(trials.some(item => item.status === 'completed'), packaging.some(item => item.status === 'approved') || trials.length > 0), detail: trials.length ? `${trials.length} trial${trials.length === 1 ? '' : 's'}` : 'Not planned' },
    { key: 'qc', label: 'QC release', state: state(releases.some(item => item.disposition === 'released'), trials.some(item => item.status === 'completed'), failedQc, blockers.length > 0), detail: failedQc ? 'Hold / OOS recorded' : releases.some(item => item.disposition === 'released') ? 'Released' : 'Not released' },
  ];

  let nextAction = { label: 'Review project evidence', detail: 'Inspect the readiness gates and record the next controlled decision.', to: `/projects?project=${project.id}#project-execution` };
  if (blockers.length) nextAction = { label: 'Resolve quality blockers', detail: 'Release remains blocked until open quality events and CAPA are resolved.', to: `/projects?project=${project.id}#project-execution` };
  else if (project.brief_status !== 'validated') nextAction = { label: 'Validate the structured brief', detail: 'Confirm measurable constraints and success criteria before execution.', to: `/projects?project=${project.id}` };
  else if (!versions.length) nextAction = { label: 'Create the first formulation version', detail: 'Start from the validated project brief.', to: `/formulations?project=${project.id}` };
  else if (!approved.length) nextAction = { label: 'Review and approve a formulation version', detail: 'Experimental work must reference a controlled exact version.', to: `/formulations?project=${project.id}` };
  else if (!plans.length) nextAction = { label: 'Create an experiment or DOE plan', detail: 'Define a testable hypothesis and controlled protocol.', to: `/projects?project=${project.id}#project-execution` };
  else if (plans.some(plan => plan.design && (plan.design.run_count > batches.filter(batch => batch.experimental_plan_id === plan.id && batch.doe_run_id).length))) {
    const plan = plans.find(item => item.design && item.design.run_count > batches.filter(batch => batch.experimental_plan_id === item.id && batch.doe_run_id).length)!;
    const done = new Set(batches.filter(batch => batch.experimental_plan_id === plan.id).map(batch => batch.doe_run_id));
    const run = plan.design?.runs.find(item => !done.has(item.id));
    nextAction = { label: `Execute DOE run ${run?.id || 'next'}`, detail: 'Record the physical batch against the signed experimental matrix.', to: `/projects?project=${project.id}#project-execution` };
  } else if (!lab.length) nextAction = { label: 'Record laboratory results', detail: 'Attach measurements to the exact formulation version under evaluation.', to: `/laboratory-results?project=${project.id}&formulation=${activeVersion?.id || ''}` };
  else if (!decisions.length) nextAction = { label: 'Review results and record a Go / No-Go decision', detail: 'Use recorded laboratory and sensory evidence.', to: `/projects?project=${project.id}#project-execution` };
  else if (shouldReformulate) nextAction = { label: 'Create a controlled formulation revision', detail: 'The recorded outcome requires rework before another experiment.', to: `/formulations?project=${project.id}&source=${activeVersion?.id || ''}` };
  else if (!specifications.some(item => item.status === 'approved')) nextAction = { label: 'Define and approve product specification', detail: 'Convert accepted evidence into controlled release limits.', to: `/projects?project=${project.id}#project-execution` };
  else if (!trials.length) nextAction = { label: 'Plan an industrial production trial', detail: 'Scale the approved formulation and packaging configuration under control.', to: `/projects?project=${project.id}#project-execution` };
  else if (!releases.some(item => item.disposition === 'released')) nextAction = { label: 'Complete deterministic QC disposition', detail: 'Evaluate trial measurements against the approved specification.', to: `/projects?project=${project.id}#project-execution` };

  return { steps, nextAction, activeVersion, blockers, shouldReformulate };
}

const stateMeta = {
  complete: { label: 'Complete', className: 'border-emerald-200 bg-emerald-50 text-emerald-800', Icon: Check },
  active: { label: 'Next', className: 'border-sky-300 bg-sky-50 text-sky-800', Icon: Circle },
  waiting: { label: 'Waiting', className: 'border-slate-200 bg-secondary text-secondary', Icon: Circle },
  attention: { label: 'Review', className: 'border-amber-300 bg-amber-50 text-amber-900', Icon: RotateCcw },
  blocked: { label: 'Blocked', className: 'border-rose-300 bg-rose-50 text-rose-900', Icon: LockKeyhole },
};

export default function ProjectWorkflow({ project }: { project: RDProject }) {
  const workflow = deriveProjectWorkflow(project);
  return <section className="surface-card" aria-labelledby="workflow-title">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div><p className="eyebrow">Live project state</p><h2 id="workflow-title" className="mt-1 text-xl font-black text-primary">Closed-loop R&amp;D workflow</h2><p className="mt-1 text-sm text-secondary">Derived from persisted project records; no AI inference is used.</p></div>
      <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 lg:max-w-md">
        <p className="text-xs font-black uppercase tracking-wide text-sky-800">Next controlled action</p>
        <Link to={workflow.nextAction.to} className="mt-1 inline-flex font-black text-sky-950 underline decoration-sky-300 underline-offset-4">{workflow.nextAction.label}</Link>
        <p className="mt-1 text-sm text-sky-900">{workflow.nextAction.detail}</p>
      </div>
    </div>
    <ol className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5" aria-label="R&D lifecycle status">
      {workflow.steps.map((step, index) => { const meta = stateMeta[step.state]; const Icon = meta.Icon; return <li key={step.key} className={`relative rounded-xl border p-3 ${meta.className}`}>
        <div className="flex items-start justify-between gap-2"><span className="text-[10px] font-black uppercase tracking-wide">{index + 1}. {step.label}</span><Icon aria-hidden="true" className="h-4 w-4 shrink-0"/></div>
        <p className="mt-2 text-xs font-semibold">{step.detail}</p><span className="sr-only">Status: {meta.label}</span>
      </li>; })}
    </ol>
    <div className="mt-4 grid gap-3 md:grid-cols-2">
      <div className="rounded-xl bg-secondary p-3"><p className="text-xs font-bold text-secondary">Exact formulation under evaluation</p><p className="mt-1 font-black text-primary">{workflow.activeVersion ? `${workflow.activeVersion.name} · v${workflow.activeVersion.version} · ${workflow.activeVersion.code}` : 'No exact version selected by recorded workflow state'}</p></div>
      <div className={`rounded-xl border p-3 ${workflow.blockers.length ? 'border-rose-200 bg-rose-50' : 'border-emerald-200 bg-emerald-50'}`}><p className="flex items-center gap-2 text-xs font-black uppercase tracking-wide"><AlertTriangle className="h-4 w-4"/>{workflow.blockers.length ? `${workflow.blockers.length} unresolved blocker${workflow.blockers.length === 1 ? '' : 's'}` : 'No unresolved quality blocker'}</p>{workflow.blockers.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">{workflow.blockers.slice(0, 3).map(item => <li key={item}>{item}</li>)}</ul>}</div>
    </div>
  </section>;
}
