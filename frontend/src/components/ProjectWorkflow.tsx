import { AlertTriangle, Check, Circle, LockKeyhole } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { RDProject } from '../types';

type StepState = 'complete' | 'active' | 'waiting' | 'blocked';
type WorkflowStep = { key: string; label: string; state: StepState; detail: string };
export type ProjectWorkflowState = {
  available: boolean;
  steps: WorkflowStep[];
  nextAction: { label: string; detail: string; to: string };
  activeVersion: NonNullable<RDProject['traceability']>['formulations'][number] | null;
  blockers: string[];
  reformulation: NonNullable<RDProject['development_state']>['reformulation_required'] | null;
};

function routeForAction(project: RDProject, key: string, targetId: string | null) {
  if (key === 'validated_brief') return `/projects?project=${project.id}`;
  if (key === 'approved_formulation') return `/formulations?project=${project.id}`;
  if (key === 'laboratory_evidence') return `/laboratory-results?project=${project.id}&formulation=${targetId || ''}`;
  if (key === 'sensory_evidence') return `/sensory?project=${project.id}`;
  if (key === 'reformulation_review') return `/formulations?project=${project.id}`;
  return `/projects?project=${project.id}#project-execution`;
}

const stepLabels: Record<string, string> = {
  validated_brief: 'Brief', approved_formulation: 'Version approval', experimental_plan: 'Experiment / DOE', pilot_evidence: 'Pilot / lab batch', laboratory_evidence: 'Laboratory', sensory_evidence: 'Sensory', stability_evidence: 'Stability', go_decision: 'Decision', approved_specification: 'Specification', approved_packaging: 'Supply / packaging', completed_scale_up: 'Production trial', released_qc: 'QC release', quality_clearance: 'Quality clearance',
};
const emptyPassDetails: Record<string, string> = { validated_brief: 'Validated', quality_clearance: 'Clear' };

export function adaptProjectDevelopmentState(project: RDProject): ProjectWorkflowState {
  const state = project.development_state;
  if (!state) return {
    available: false,
    steps: [],
    nextAction: { label: 'Refresh project state', detail: 'The authoritative backend development state is unavailable; no local workflow inference was substituted.', to: `/projects?project=${project.id}` },
    activeVersion: null,
    blockers: ['Authoritative project state unavailable. Refresh the project before making a controlled decision.'],
    reformulation: null,
  };
  const activeVersion = project.traceability?.formulations.find(version => version.id === state.target_formulation_version_id) || null;
  const blockers = state.blockers.map(item => item.message);
  const steps = state.readiness.gates.map(item => {
    const isControlling = item.key === state.next_controlled_action.key;
    const stepState: StepState = item.status === 'pass' ? 'complete' : isControlling && blockers.length ? 'blocked' : isControlling ? 'active' : 'waiting';
    const detail = item.status === 'pass' ? item.entity_ids.length ? `${item.entity_ids.length} exact-version record${item.entity_ids.length === 1 ? '' : 's'}` : emptyPassDetails[item.key] || 'Passed' : isControlling ? 'Next controlled gate' : 'Waiting on prior gates';
    return { key: item.key, label: stepLabels[item.key] || item.label, state: stepState, detail };
  });
  return {
    available: true,
    steps,
    nextAction: { ...state.next_controlled_action, to: routeForAction(project, state.next_controlled_action.key, state.target_formulation_version_id) },
    activeVersion,
    blockers,
    reformulation: state.reformulation_required,
  };
}

const stateMeta = {
  complete: { label: 'Complete', className: 'border-emerald-200 bg-emerald-50 text-emerald-800', Icon: Check },
  active: { label: 'Next', className: 'border-sky-300 bg-sky-50 text-sky-800', Icon: Circle },
  waiting: { label: 'Waiting', className: 'border-slate-200 bg-secondary text-secondary', Icon: Circle },
  blocked: { label: 'Blocked', className: 'border-rose-300 bg-rose-50 text-rose-900', Icon: LockKeyhole },
};

export default function ProjectWorkflow({ project }: { project: RDProject }) {
  const workflow = adaptProjectDevelopmentState(project);
  return <section className="surface-card" aria-labelledby="workflow-title">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div><p className="eyebrow">Live project state</p><h2 id="workflow-title" className="mt-1 text-xl font-black text-primary">Closed-loop R&amp;D workflow</h2><p className="mt-1 text-sm text-secondary">Calculated by the backend from persisted exact-version records; no AI or browser-side business inference is used.</p></div>
      <div className={`rounded-2xl border p-4 lg:max-w-md ${workflow.available ? 'border-sky-200 bg-sky-50' : 'border-amber-200 bg-amber-50'}`}>
        <p className={`text-xs font-black uppercase tracking-wide ${workflow.available ? 'text-sky-800' : 'text-amber-800'}`}>Next controlled action</p>
        <Link to={workflow.nextAction.to} className={`mt-1 inline-flex font-black underline underline-offset-4 ${workflow.available ? 'text-sky-950 decoration-sky-300' : 'text-amber-950 decoration-amber-300'}`}>{workflow.nextAction.label}</Link>
        <p className={`mt-1 text-sm ${workflow.available ? 'text-sky-900' : 'text-amber-900'}`}>{workflow.nextAction.detail}</p>
      </div>
    </div>
    {workflow.steps.length > 0 && <ol className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5" aria-label="R&D lifecycle status">
      {workflow.steps.map((step, index) => { const meta = stateMeta[step.state]; const Icon = meta.Icon; return <li key={step.key} className={`relative rounded-xl border p-3 ${meta.className}`}>
        <div className="flex items-start justify-between gap-2"><span className="text-[10px] font-black uppercase tracking-wide">{index + 1}. {step.label}</span><Icon aria-hidden="true" className="h-4 w-4 shrink-0"/></div>
        <p className="mt-2 text-xs font-semibold">{step.detail}</p><span className="sr-only">Status: {meta.label}</span>
      </li>; })}
    </ol>}
    <div className={`mt-4 grid gap-3 ${workflow.reformulation?.trigger ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
      <div className="rounded-xl bg-secondary p-3"><p className="text-xs font-bold text-secondary">Exact formulation under evaluation</p><p className="mt-1 font-black text-primary">{workflow.activeVersion ? `${workflow.activeVersion.name} · v${workflow.activeVersion.version} · ${workflow.activeVersion.code}` : workflow.available ? 'No target version selected by the backend state engine' : 'Unavailable until project state is refreshed'}</p></div>
      <div className={`rounded-xl border p-3 ${workflow.blockers.length ? 'border-rose-200 bg-rose-50' : 'border-emerald-200 bg-emerald-50'}`}><p className="flex items-center gap-2 text-xs font-black uppercase tracking-wide"><AlertTriangle className="h-4 w-4"/>{workflow.blockers.length ? `${workflow.blockers.length} unresolved blocker${workflow.blockers.length === 1 ? '' : 's'}` : 'No unresolved target-version blocker'}</p>{workflow.blockers.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">{workflow.blockers.slice(0, 3).map(item => <li key={item}>{item}</li>)}</ul>}</div>
      {workflow.reformulation?.trigger && <div className={`rounded-xl border p-3 ${workflow.reformulation.required ? 'border-rose-200 bg-rose-50' : 'border-amber-200 bg-amber-50'}`}><p className="text-xs font-black uppercase tracking-wide">{workflow.reformulation.required ? 'Reformulation required' : 'Do not reformulate automatically'}</p><p className="mt-1 text-xs font-semibold">{workflow.reformulation.reason}</p><p className="mt-2 text-[11px] font-black uppercase">Path · {workflow.reformulation.recommended_path.replaceAll('_',' ')}</p></div>}
    </div>
  </section>;
}
