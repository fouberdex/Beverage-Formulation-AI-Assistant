import { useEffect, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, BarChart3, Beaker, CheckCircle2, ClipboardList,
  Bot, Download, FlaskConical, Plus, Save, Settings2, Sparkles, Upload, Users,
} from 'lucide-react';
import {
  Bar, BarChart, CartesianGrid, Legend, PolarAngleAxis, PolarGrid, PolarRadiusAxis,
  Radar, RadarChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { aiAPI, formulationsAPI, sensoryAPI } from '../services/api';
import { getErrorMessage } from '../services/errors';
import StatusMessage from '../components/StatusMessage';
import type { Formulation, SensoryStudy, SensoryStudyAnalytics, SensoryStudyAttribute } from '../types';
import { downloadSpreadsheetTemplate, optionalNumber, readSpreadsheet } from '../utils/spreadsheet';
import { useSearchParams } from 'react-router-dom';

const COLORS = ['#0369a1', '#7c3aed', '#059669', '#d97706', '#dc2626', '#0891b2'];
const DEFAULT_ATTRIBUTES: SensoryStudyAttribute[] = [
  { key: 'appearance', label: 'Appearance', category: 'appearance' },
  { key: 'aroma_intensity', label: 'Aroma intensity', category: 'aroma' },
  { key: 'sweetness', label: 'Sweetness', category: 'taste' },
  { key: 'acidity', label: 'Acidity', category: 'taste' },
  { key: 'flavor_intensity', label: 'Flavor intensity', category: 'taste' },
  { key: 'mouthfeel', label: 'Mouthfeel', category: 'mouthfeel' },
  { key: 'aftertaste', label: 'Aftertaste', category: 'aftertaste' },
  { key: 'overall_liking', label: 'Overall liking', category: 'overall' },
];

type WorkspaceTab = 'design' | 'capture' | 'analysis';

function randomizeOrder(ids: string[]) {
  const randomized = [...ids];
  for (let index = randomized.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [randomized[index], randomized[swapIndex]] = [randomized[swapIndex], randomized[index]];
  }
  return randomized;
}

export default function SensoryPage() {
  const [searchParams] = useSearchParams();
  const requestedProjectId = searchParams.get('project') || '';
  const [tab, setTab] = useState<WorkspaceTab>('design');
  const [formulations, setFormulations] = useState<Formulation[]>([]);
  const [studies, setStudies] = useState<SensoryStudy[]>([]);
  const [selectedStudyId, setSelectedStudyId] = useState('');
  const [analytics, setAnalytics] = useState<SensoryStudyAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [importing, setImporting] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const selectedStudy = studies.find(study => study.id === selectedStudyId) || null;

  useEffect(() => { void loadWorkspace(); }, []);
  useEffect(() => {
    if (tab === 'analysis' && selectedStudyId) void loadAnalytics(selectedStudyId);
  }, [tab, selectedStudyId]);

  async function loadWorkspace(preferredStudyId?: string) {
    setLoading(true);
    try {
      const [formulationsResponse, studiesResponse] = await Promise.all([
        formulationsAPI.getAll({ limit: 100 }), sensoryAPI.getStudies(),
      ]);
      const loadedStudies: SensoryStudy[] = studiesResponse.data.data;
      setFormulations(formulationsResponse.data.data);
      setStudies(loadedStudies);
      setSelectedStudyId(preferredStudyId || selectedStudyId || loadedStudies[0]?.id || '');
    } catch (reason) {
      setError(getErrorMessage(reason, 'Unable to load the sensory workspace.'));
    } finally {
      setLoading(false);
    }
  }

  async function loadAnalytics(studyId: string) {
    setAnalyticsLoading(true);
    try {
      const response = await sensoryAPI.getAnalytics(studyId);
      setAnalytics(response.data.data);
    } catch (reason) {
      setAnalytics(null);
      setError(getErrorMessage(reason, 'Unable to calculate sensory analytics.'));
    } finally {
      setAnalyticsLoading(false);
    }
  }

  async function studyCreated(study: SensoryStudy) {
    await loadWorkspace(study.id);
    setTab('capture');
    setMessage(`Study “${study.name}” is ready for panel data.`);
  }

  async function responseCreated() {
    await loadWorkspace(selectedStudyId);
    if (selectedStudyId) await loadAnalytics(selectedStudyId);
    setMessage('Panel response saved and analytics recalculated.');
  }

  function downloadTemplate() {
    if (!selectedStudy) return;
    const rows = selectedStudy.samples.map(sample => ({
      panelist_code: 'P-001', segment: 'Regular buyer', sample_code: sample.sample_code,
      ...Object.fromEntries(selectedStudy.attributes.map(attribute => [attribute.key, 7])),
      jar_sweetness: 0, jar_acidity: 0, jar_flavor_intensity: 0,
      purchase_intent: 4, preference_rank: 1, comment: '', location: 'Sensory room',
    }));
    downloadSpreadsheetTemplate(`sensory-${selectedStudy.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.xlsx`, rows);
  }

  async function importPanelFile(file: File) {
    if (!selectedStudy) return;
    setImporting(true); setError(''); setMessage('');
    try {
      const spreadsheetRows = await readSpreadsheet(file);
      const grouped = new Map<string, { panelist_code: string; segment?: string; demographics: Record<string, string>; session: Record<string, unknown>; samples: any[] }>();
      for (const row of spreadsheetRows) {
        const code = String(row.panelist_code || row.panelist || row.paneliste || '').trim();
        if (!code) throw new Error('Every row needs a panelist_code.');
        const sampleReference = String(row.sample_code || row.blind_code || row.sample || row.echantillon || '').trim().toLowerCase();
        const sample = selectedStudy.samples.find(item => [item.sample_code, item.blind_code, item.label].some(value => value.toLowerCase() === sampleReference));
        if (!sample) throw new Error(`Unknown sample “${sampleReference}” for panelist ${code}.`);
        const group = grouped.get(code.toLowerCase()) || {
          panelist_code: code, segment: String(row.segment || '').trim() || undefined,
          demographics: { age_range: String(row.age_range || ''), gender: String(row.gender || ''), consumption_frequency: String(row.consumption_frequency || '') },
          session: { location: String(row.location || ''), serving_order: [] as string[] }, samples: [],
        };
        const scores = Object.fromEntries(selectedStudy.attributes.map(attribute => [attribute.key, optionalNumber(row[attribute.key])]).filter(([, value]) => value !== undefined));
        const jar = Object.fromEntries(['sweetness', 'acidity', 'flavor_intensity'].map(key => [key, optionalNumber(row[`jar_${key}`])]).filter(([, value]) => value !== undefined));
        group.samples.push({ sample_id: sample.id, scores, jar, purchase_intent: optionalNumber(row.purchase_intent), preference_rank: optionalNumber(row.preference_rank), comment: String(row.comment || '').trim() || undefined });
        (group.session.serving_order as string[]).push(sample.id);
        grouped.set(code.toLowerCase(), group);
      }
      const response = await sensoryAPI.importResponses(selectedStudy.id, [...grouped.values()]);
      await responseCreated();
      setMessage(`${response.data.imported} panel response(s) imported${response.data.rejected ? `; ${response.data.rejected} rejected. ${response.data.errors[0]?.message || ''}` : '.'}`);
    } catch (reason) { setError(getErrorMessage(reason, 'Unable to import panel data.')); }
    finally { setImporting(false); if (importRef.current) importRef.current.value = ''; }
  }

  return <div className="space-y-6 pb-10">
    <header className="overflow-hidden rounded-2xl border border-slate-200 bg-white px-6 py-7 text-slate-950 shadow-sm sm:px-8">
      <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div><div className="hero-kicker mb-3"><Sparkles className="h-3.5 w-3.5"/> Sensory science workspace</div><h1 className="text-3xl font-black tracking-tight sm:text-4xl">Sensory Analysis</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">Design controlled studies, capture individual panel responses, and turn perception data into statistically transparent product decisions.</p></div>
        <div className="grid grid-cols-3 gap-2 text-center"><HeroMetric value={studies.length} label="Studies"/><HeroMetric value={studies.reduce((sum, study) => sum + (study.response_count || 0), 0)} label="Responses"/><HeroMetric value={studies.filter(study => study.status === 'active').length} label="Active"/></div>
      </div>
    </header>

    <StatusMessage error={error} message={message} />

    <div className="flex flex-col gap-4 rounded-xl border bg-white p-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
      <div role="tablist" aria-label="Sensory workspace" className="grid grid-cols-3 gap-1 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        <WorkspaceTabButton active={tab === 'design'} icon={Settings2} label="Study design" onClick={() => setTab('design')} />
        <WorkspaceTabButton active={tab === 'capture'} icon={ClipboardList} label="Panel data" onClick={() => setTab('capture')} />
        <WorkspaceTabButton active={tab === 'analysis'} icon={BarChart3} label="Analysis" onClick={() => setTab('analysis')} />
      </div>
      {tab !== 'design' && <div className="flex flex-wrap items-center gap-2"><label className="flex min-w-0 items-center gap-3 px-2 text-sm"><span className="shrink-0 font-medium text-slate-600">Study</span><select value={selectedStudyId} onChange={event => setSelectedStudyId(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 lg:w-80"><option value="">Choose a study</option>{studies.map(study => <option key={study.id} value={study.id}>{study.name} · {study.response_count || 0} responses</option>)}</select></label>{tab === 'capture' && <><button type="button" disabled={!selectedStudy} onClick={downloadTemplate} className="secondary-button"><Download className="h-4 w-4"/> Template</button><button type="button" disabled={!selectedStudy || importing} onClick={() => importRef.current?.click()} className="primary-button"><Upload className="h-4 w-4"/>{importing ? 'Importing…' : 'Import CSV / Excel'}</button><input ref={importRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={event => event.target.files?.[0] && void importPanelFile(event.target.files[0])}/></>}</div>}
    </div>

    {loading ? <div role="status" className="rounded-xl border bg-white p-12 text-center text-slate-500">Loading sensory workspace…</div> : <>
      {tab === 'design' && <StudyDesigner formulations={requestedProjectId ? formulations.filter(item => item.project_id === requestedProjectId) : formulations} projectId={requestedProjectId} onCreated={studyCreated} onError={setError} />}
      {tab === 'capture' && <ResponseCapture study={selectedStudy} onSaved={responseCreated} onError={setError} />}
      {tab === 'analysis' && <AnalysisDashboard study={selectedStudy} analytics={analytics} loading={analyticsLoading} />}
    </>}
  </div>;
}

function HeroMetric({ value, label }: { value: number; label: string }) {
  return <div className="min-w-20 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"><div className="text-xl font-black text-slate-900">{value}</div><div className="text-[10px] font-bold uppercase tracking-wider text-slate-600">{label}</div></div>;
}

function WorkspaceTabButton({ active, icon: Icon, label, onClick }: { active: boolean; icon: typeof Settings2; label: string; onClick: () => void }) {
  return <button type="button" role="tab" aria-selected={active} onClick={onClick} className={`flex min-h-12 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-bold transition ${active ? 'bg-sky-50 text-sky-800 ring-1 ring-sky-200' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'}`}><Icon className="h-4 w-4"/>{label}</button>;
}

function StudyDesigner({ formulations, projectId, onCreated, onError }: { formulations: Formulation[]; projectId?: string; onCreated: (study: SensoryStudy) => void; onError: (message: string) => void }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '', objective: '', test_type: 'combined', panel_type: 'consumer', planned_panelists: 30,
    scale_min: 0, scale_max: 10, status: 'active', attributes: DEFAULT_ATTRIBUTES,
    samples: [
      { formulation_id: '', sample_code: 'CONTROL', blind_code: '314', label: 'Control', batch_code: '' },
      { formulation_id: '', sample_code: 'CANDIDATE', blind_code: '729', label: 'Candidate', batch_code: '' },
    ],
    protocol: { randomize_order: true, serving_temperature_c: 6, serving_volume_ml: 60, palate_cleanser: 'Room-temperature water and unsalted crackers', environment: 'Neutral lighting, quiet booths, fragrance-free room', instructions: '' },
  });

  function updateSample(index: number, key: string, value: string) {
    setForm(current => ({ ...current, samples: current.samples.map((sample, sampleIndex) => sampleIndex === index ? { ...sample, [key]: value } : sample) }));
  }

  function addSample() {
    const number = form.samples.length + 1;
    setForm(current => ({ ...current, samples: [...current.samples, { formulation_id: '', sample_code: `SAMPLE-${number}`, blind_code: String(100 + (number * 137)).slice(-3), label: `Sample ${number}`, batch_code: '' }] }));
  }

  function toggleAttribute(attribute: SensoryStudyAttribute) {
    setForm(current => ({ ...current, attributes: current.attributes.some(item => item.key === attribute.key) ? current.attributes.filter(item => item.key !== attribute.key) : [...current.attributes, attribute] }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); onError('');
    try {
      const response = await sensoryAPI.createStudy({
        ...form,
        ...(projectId ? { project_id: projectId } : {}),
        samples: form.samples.map(sample => ({ ...sample, formulation_id: sample.formulation_id || undefined, batch_code: sample.batch_code || undefined })),
      });
      await onCreated(response.data.data);
    } catch (reason) {
      onError(getErrorMessage(reason, 'Unable to create the sensory study.'));
    } finally { setSaving(false); }
  }

  return <form onSubmit={submit} className="grid gap-6 xl:grid-cols-[1fr_22rem]">
    <div className="space-y-6">
      <SectionCard icon={FlaskConical} eyebrow="01 · Brief" title="Study definition" description="Define the business question, method, panel, and score scale before collecting observations.">
        <div className="grid gap-4 sm:grid-cols-2"><Field label="Study name"><input required minLength={3} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} className="input" placeholder="e.g. 30% sugar reduction preference test"/></Field><Field label="Study status"><select value={form.status} onChange={event => setForm({ ...form, status: event.target.value })} className="input"><option value="draft">Draft</option><option value="active">Active / collecting</option><option value="completed">Completed</option></select></Field></div>
        <Field label="Decision objective" hint="State the hypothesis and decision this study must support."><textarea required minLength={10} rows={4} value={form.objective} onChange={event => setForm({ ...form, objective: event.target.value })} className="input" placeholder="Determine whether the reduced-sugar candidate preserves overall liking and sweetness balance versus the control."/></Field>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Field label="Test design"><select value={form.test_type} onChange={event => setForm({ ...form, test_type: event.target.value })} className="input"><option value="combined">Combined hedonic + JAR</option><option value="hedonic">Hedonic liking</option><option value="descriptive">Descriptive profile</option><option value="preference">Preference ranking</option><option value="jar">Just-about-right</option></select></Field><Field label="Panel type"><select value={form.panel_type} onChange={event => setForm({ ...form, panel_type: event.target.value })} className="input"><option value="consumer">Consumer</option><option value="trained">Trained panel</option><option value="expert">Expert</option><option value="internal">Internal employees</option></select></Field><Field label="Planned panelists"><input type="number" min="1" max="5000" value={form.planned_panelists} onChange={event => setForm({ ...form, planned_panelists: Number(event.target.value) })} className="input"/></Field><Field label="Scale"><div className="grid grid-cols-2 gap-2"><input aria-label="Scale minimum" type="number" min="0" max="8" value={form.scale_min} onChange={event => setForm({ ...form, scale_min: Number(event.target.value) })} className="input"/><input aria-label="Scale maximum" type="number" min="2" max="10" value={form.scale_max} onChange={event => setForm({ ...form, scale_max: Number(event.target.value) })} className="input"/></div></Field></div>
      </SectionCard>

      <SectionCard icon={Beaker} eyebrow="02 · Samples" title="Products and blinding" description="Link exact formulation versions and assign neutral three-digit presentation codes.">
        <div className="space-y-4">{form.samples.map((sample, index) => <div key={index} className="rounded-xl border border-slate-200 bg-slate-50/70 p-4"><div className="mb-3 flex items-center justify-between"><h3 className="font-semibold text-slate-900">Sample {index + 1}</h3>{form.samples.length > 1 && <button type="button" onClick={() => setForm({ ...form, samples: form.samples.filter((_, sampleIndex) => sampleIndex !== index) })} className="text-xs font-medium text-rose-700">Remove</button>}</div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Field label="Display label"><input required value={sample.label} onChange={event => updateSample(index, 'label', event.target.value)} className="input"/></Field><Field label="Internal sample code"><input required value={sample.sample_code} onChange={event => updateSample(index, 'sample_code', event.target.value)} className="input"/></Field><Field label="Blind code"><input required maxLength={20} value={sample.blind_code} onChange={event => updateSample(index, 'blind_code', event.target.value)} className="input font-mono"/></Field><Field label="Linked formulation"><select value={sample.formulation_id} onChange={event => updateSample(index, 'formulation_id', event.target.value)} className="input"><option value="">No formulation link</option>{formulations.map(formulation => <option key={formulation.id} value={formulation.id}>{formulation.name} · v{formulation.version}</option>)}</select></Field><Field label="Produced batch"><input value={sample.batch_code} onChange={event => updateSample(index, 'batch_code', event.target.value)} className="input" placeholder="Optional batch code"/></Field></div></div>)}</div>
        <button type="button" onClick={addSample} disabled={form.samples.length >= 12} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-sky-300 px-3 py-2 text-sm font-semibold text-sky-800 hover:bg-sky-50 disabled:opacity-50"><Plus className="h-4 w-4"/> Add sample</button>
      </SectionCard>

      <SectionCard icon={Activity} eyebrow="03 · Instrument" title="Sensory attributes" description="Choose the dimensions each panelist will score for every sample.">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{DEFAULT_ATTRIBUTES.map(attribute => { const selected = form.attributes.some(item => item.key === attribute.key); return <button key={attribute.key} type="button" onClick={() => toggleAttribute(attribute)} aria-pressed={selected} className={`rounded-xl border p-3 text-left transition ${selected ? 'border-sky-400 bg-sky-50 ring-1 ring-sky-300' : 'border-slate-200 hover:border-slate-300'}`}><div className="flex items-center justify-between"><span className="text-sm font-semibold text-slate-800">{attribute.label}</span>{selected && <CheckCircle2 className="h-4 w-4 text-sky-700"/>}</div><span className="mt-1 block text-xs capitalize text-slate-600">{attribute.category}</span></button>; })}</div>
      </SectionCard>

      <SectionCard icon={Settings2} eyebrow="04 · Protocol" title="Serving controls" description="Record the conditions needed to reproduce the session and interpret deviations.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><Field label="Serving temperature (°C)"><input type="number" min="-10" max="100" value={form.protocol.serving_temperature_c} onChange={event => setForm({ ...form, protocol: { ...form.protocol, serving_temperature_c: Number(event.target.value) } })} className="input"/></Field><Field label="Serving volume (mL)"><input type="number" min="1" max="2000" value={form.protocol.serving_volume_ml} onChange={event => setForm({ ...form, protocol: { ...form.protocol, serving_volume_ml: Number(event.target.value) } })} className="input"/></Field><Field label="Palate cleanser"><input value={form.protocol.palate_cleanser} onChange={event => setForm({ ...form, protocol: { ...form.protocol, palate_cleanser: event.target.value } })} className="input"/></Field></div>
        <Field label="Testing environment"><input value={form.protocol.environment} onChange={event => setForm({ ...form, protocol: { ...form.protocol, environment: event.target.value } })} className="input"/></Field><Field label="Panelist instructions"><textarea rows={3} value={form.protocol.instructions} onChange={event => setForm({ ...form, protocol: { ...form.protocol, instructions: event.target.value } })} className="input" placeholder="Describe tasting order, rinsing, retasting, and comment expectations."/></Field>
        <label className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950"><input type="checkbox" checked={form.protocol.randomize_order} onChange={event => setForm({ ...form, protocol: { ...form.protocol, randomize_order: event.target.checked } })} className="mt-1"/><span><strong>Randomize serving order</strong><br/><span className="text-emerald-800">Reduce presentation-order bias across panelists.</span></span></label>
      </SectionCard>
    </div>

    <aside className="space-y-4 xl:sticky xl:top-20 xl:self-start"><div className="rounded-xl border bg-white p-5 shadow-sm"><h2 className="font-semibold text-slate-900">Design readiness</h2><div className="mt-4 space-y-3 text-sm"><Readiness ok={form.name.length >= 3} label="Named study"/><Readiness ok={form.objective.length >= 10} label="Decision objective"/><Readiness ok={form.samples.length >= 1} label={`${form.samples.length} sample(s)`}/><Readiness ok={form.attributes.length >= 2} label={`${form.attributes.length} attributes`}/><Readiness ok={new Set(form.samples.map(sample => sample.blind_code)).size === form.samples.length} label="Unique blind codes"/></div><button type="submit" disabled={saving} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-sky-700 px-4 py-3 font-semibold text-white hover:bg-sky-800 disabled:opacity-50"><Save className="h-4 w-4"/>{saving ? 'Creating study…' : 'Create sensory study'}</button></div><div className="rounded-xl border border-violet-200 bg-violet-50 p-5 text-sm text-violet-950"><strong>Analysis enabled</strong><p className="mt-2 leading-6 text-violet-800">This design supports sample profiles, confidence intervals, ANOVA screening, correlations, segment comparisons, JAR penalty analysis, and response-quality diagnostics.</p></div></aside>
  </form>;
}

function ResponseCapture({ study, onSaved, onError }: { study: SensoryStudy | null; onSaved: () => void; onError: (message: string) => void }) {
  const [saving, setSaving] = useState(false);
  const [startedAt, setStartedAt] = useState(Date.now());
  const [panelist, setPanelist] = useState({ code: '', segment: '', age_range: '', gender: '', consumption_frequency: '', location: '' });
  const [scores, setScores] = useState<Record<string, Record<string, string>>>({});
  const [jar, setJar] = useState<Record<string, Record<string, string>>>({});
  const [extras, setExtras] = useState<Record<string, { purchase_intent: string; preference_rank: string; comment: string }>>({});
  const [servingOrder, setServingOrder] = useState<string[]>([]);

  useEffect(() => {
    setScores({}); setJar({}); setExtras({}); setPanelist(current => ({ ...current, code: '' })); setStartedAt(Date.now());
    const ids = study?.samples.map(sample => sample.id) || [];
    setServingOrder(study?.protocol.randomize_order ? randomizeOrder(ids) : ids);
  }, [study?.id]);
  if (!study) return <EmptyWorkspace title="No sensory study selected" description="Create a study in Study Design, then return here to capture individual panel responses."/>;
  const activeStudy = study;
  const effectiveOrder = servingOrder.length > 0 ? servingOrder : activeStudy.samples.map(sample => sample.id);
  const orderedSamples = effectiveOrder.map(id => activeStudy.samples.find(sample => sample.id === id)).filter((sample): sample is SensoryStudy['samples'][number] => Boolean(sample));

  function score(sampleId: string, attributeKey: string, value: string) { setScores(current => ({ ...current, [sampleId]: { ...(current[sampleId] || {}), [attributeKey]: value } })); }
  function jarValue(sampleId: string, dimension: string, value: string) { setJar(current => ({ ...current, [sampleId]: { ...(current[sampleId] || {}), [dimension]: value } })); }
  function extra(sampleId: string, key: string, value: string) { setExtras(current => ({ ...current, [sampleId]: { ...(current[sampleId] || { purchase_intent: '', preference_rank: '', comment: '' }), [key]: value } })); }

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); onError('');
    try {
      await sensoryAPI.addResponse(activeStudy.id, {
        panelist_code: panelist.code,
        segment: panelist.segment || undefined,
        demographics: { age_range: panelist.age_range || undefined, gender: panelist.gender || undefined, consumption_frequency: panelist.consumption_frequency || undefined },
        session: { location: panelist.location || undefined, duration_seconds: Math.max(1, Math.round((Date.now() - startedAt) / 1000)), serving_order: orderedSamples.map(sample => sample.id) },
        samples: orderedSamples.map(sample => ({
          sample_id: sample.id,
          scores: Object.fromEntries(Object.entries(scores[sample.id] || {}).filter(([, value]) => value !== '').map(([key, value]) => [key, Number(value)])),
          jar: Object.fromEntries(Object.entries(jar[sample.id] || {}).filter(([, value]) => value !== '').map(([key, value]) => [key, Number(value)])),
          purchase_intent: extras[sample.id]?.purchase_intent ? Number(extras[sample.id].purchase_intent) : undefined,
          preference_rank: extras[sample.id]?.preference_rank ? Number(extras[sample.id].preference_rank) : undefined,
          comment: extras[sample.id]?.comment || undefined,
        })),
      });
      setScores({}); setJar({}); setExtras({}); setPanelist({ code: '', segment: '', age_range: '', gender: '', consumption_frequency: '', location: '' }); setStartedAt(Date.now());
      const ids = activeStudy.samples.map(sample => sample.id);
      setServingOrder(activeStudy.protocol.randomize_order ? randomizeOrder(ids) : ids);
      await onSaved();
    } catch (reason) { onError(getErrorMessage(reason, 'Unable to save the panel response.')); } finally { setSaving(false); }
  }

  return <form onSubmit={submit} className="space-y-6">
    <div className="grid gap-4 lg:grid-cols-[1fr_auto]"><div className="rounded-xl border bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center gap-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase ${study.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>{study.status}</span><h2 className="text-xl font-bold text-slate-900">{study.name}</h2></div><p className="mt-2 text-sm leading-6 text-slate-600">{study.objective}</p></div><div className="grid grid-cols-2 gap-2"><Metric label="Samples" value={study.samples.length}/><Metric label="Responses" value={study.response_count || 0}/></div></div>
    <SectionCard icon={Users} eyebrow="Panelist" title="Respondent and session" description="Use a pseudonymous code. Demographics are optional and used only for segment analysis."><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><Field label="Panelist code"><input required value={panelist.code} onChange={event => setPanelist({ ...panelist, code: event.target.value })} className="input" placeholder="e.g. P-0042"/></Field><Field label="Segment"><input value={panelist.segment} onChange={event => setPanelist({ ...panelist, segment: event.target.value })} className="input" placeholder="e.g. Regular category buyer"/></Field><Field label="Age range"><select value={panelist.age_range} onChange={event => setPanelist({ ...panelist, age_range: event.target.value })} className="input"><option value="">Not recorded</option><option>18–24</option><option>25–34</option><option>35–44</option><option>45–54</option><option>55+</option></select></Field><Field label="Gender"><select value={panelist.gender} onChange={event => setPanelist({ ...panelist, gender: event.target.value })} className="input"><option value="">Not recorded</option><option>Female</option><option>Male</option><option>Non-binary</option><option>Prefer not to say</option></select></Field><Field label="Consumption frequency"><select value={panelist.consumption_frequency} onChange={event => setPanelist({ ...panelist, consumption_frequency: event.target.value })} className="input"><option value="">Not recorded</option><option>Daily</option><option>Several times weekly</option><option>Weekly</option><option>Monthly</option><option>Rarely</option></select></Field><Field label="Session location"><input value={panelist.location} onChange={event => setPanelist({ ...panelist, location: event.target.value })} className="input" placeholder="Booth / room / site"/></Field></div></SectionCard>

    {study.protocol.randomize_order && <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900"><strong>Randomized serving sequence:</strong> {orderedSamples.map(sample => sample.blind_code).join(' → ')}. This order is stored with the response.</div>}
    {orderedSamples.map((sample, sampleIndex) => <SectionCard key={sample.id} icon={Beaker} eyebrow={`Sample ${sampleIndex + 1} · blind code ${sample.blind_code}`} title={sample.label} description={`${sample.sample_code}${sample.batch_code ? ` · batch ${sample.batch_code}` : ''}`}>
      <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">{study.attributes.map(attribute => { const value = scores[sample.id]?.[attribute.key] ?? ''; return <div key={attribute.key}><div className="mb-2 flex items-center justify-between"><label className="text-sm font-semibold text-slate-700" htmlFor={`${sample.id}-${attribute.key}`}>{attribute.label}</label><span className="min-w-10 rounded-md bg-sky-50 px-2 py-1 text-center text-sm font-bold text-sky-800">{value || '—'}</span></div><input id={`${sample.id}-${attribute.key}`} type="range" min={study.scale_min} max={study.scale_max} step="0.1" value={value || study.scale_min} onChange={event => score(sample.id, attribute.key, event.target.value)} className="w-full accent-sky-700"/><div className="flex justify-between text-[10px] text-slate-400"><span>{study.scale_min} · low</span><span>{study.scale_max} · high</span></div></div>; })}</div>
      {(study.test_type === 'jar' || study.test_type === 'combined') && <div className="mt-6 rounded-xl border border-violet-200 bg-violet-50/60 p-4"><h3 className="text-sm font-semibold text-violet-950">Just-about-right diagnostics</h3><div className="mt-3 grid gap-3 sm:grid-cols-3">{['sweetness', 'acidity', 'flavor_intensity'].map(dimension => <Field key={dimension} label={dimension.replace('_', ' ')}><select value={jar[sample.id]?.[dimension] || ''} onChange={event => jarValue(sample.id, dimension, event.target.value)} className="input"><option value="">Not scored</option><option value="-2">Much too low</option><option value="-1">Slightly too low</option><option value="0">Just about right</option><option value="1">Slightly too high</option><option value="2">Much too high</option></select></Field>)}</div></div>}
      <div className="mt-5 grid gap-4 sm:grid-cols-2"><Field label="Purchase intent (1–5)"><select value={extras[sample.id]?.purchase_intent || ''} onChange={event => extra(sample.id, 'purchase_intent', event.target.value)} className="input"><option value="">Not scored</option><option value="1">1 · Definitely would not buy</option><option value="2">2 · Probably would not buy</option><option value="3">3 · Might or might not buy</option><option value="4">4 · Probably would buy</option><option value="5">5 · Definitely would buy</option></select></Field><Field label="Preference rank"><input type="number" min="1" max={study.samples.length} value={extras[sample.id]?.preference_rank || ''} onChange={event => extra(sample.id, 'preference_rank', event.target.value)} className="input" placeholder={`1–${study.samples.length}`}/></Field></div><Field label="Open comment"><textarea rows={3} value={extras[sample.id]?.comment || ''} onChange={event => extra(sample.id, 'comment', event.target.value)} className="input" placeholder="What drove liking or disliking? Note specific aroma, flavor, texture, or aftertaste perceptions."/></Field>
    </SectionCard>)}
    <div className="sticky bottom-3 z-10 flex justify-end"><button type="submit" disabled={saving || ['completed', 'archived'].includes(study.status)} className="inline-flex items-center gap-2 rounded-xl bg-sky-700 px-6 py-3 font-semibold text-white shadow-lg shadow-sky-900/20 hover:bg-sky-800 disabled:opacity-50"><Save className="h-4 w-4"/>{saving ? 'Saving response…' : 'Save complete response'}</button></div>
  </form>;
}

function AnalysisDashboard({ study, analytics, loading }: { study: SensoryStudy | null; analytics: SensoryStudyAnalytics | null; loading: boolean }) {
  const [attributeKey, setAttributeKey] = useState('overall_liking');
  const [insight, setInsight] = useState<any>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  useEffect(() => { if (study && !study.attributes.some(attribute => attribute.key === attributeKey)) setAttributeKey(study.attributes[0]?.key || ''); }, [study?.id]);
  if (!study) return <EmptyWorkspace title="No sensory study selected" description="Select or create a sensory study to open its analysis workspace."/>;
  if (loading) return <div role="status" className="rounded-xl border bg-white p-12 text-center text-slate-500">Running sensory analysis…</div>;
  if (!analytics || analytics.coverage.response_count === 0) return <EmptyWorkspace title="No panel responses yet" description="Capture individual responses in Panel Data. Charts and statistical tests will appear automatically."/>;

  const radarData = study.attributes.map(attribute => ({ attribute: attribute.label, ...Object.fromEntries(analytics.samples.map(sample => [sample.sample_id, sample.attributes.find(item => item.key === attribute.key)?.mean ?? 0])) }));
  const rankingData = analytics.ranking.map(sample => ({ name: sample.label, mean: sample.overall.mean, n: sample.overall.count }));
  const attributeData = analytics.samples.map(sample => ({ name: sample.label, mean: sample.attributes.find(attribute => attribute.key === attributeKey)?.mean ?? 0, sd: sample.attributes.find(attribute => attribute.key === attributeKey)?.standard_deviation ?? 0 }));
  const selectedDistributions = analytics.samples.map(sample => ({ sample, attribute: sample.attributes.find(attribute => attribute.key === attributeKey) }));
  const distributionLabels = selectedDistributions[0]?.attribute?.distribution.map(bin => bin.label) || [];
  const distributionData = distributionLabels.map(label => ({ label, ...Object.fromEntries(selectedDistributions.map(({ sample, attribute }) => [sample.sample_id, attribute?.distribution.find(bin => bin.label === label)?.count || 0])) }));
  const commercialData = analytics.samples.map(sample => ({ name: sample.label, purchase_intent: sample.purchase_intent.mean, preference_rank: sample.preference_rank.mean }));
  const jarData = analytics.jar_penalty.filter(item => item.mean_drop !== null).map(item => ({ ...item, name: `${analytics.samples.find(sample => sample.sample_id === item.sample_id)?.label} · ${item.dimension.replace('_', ' ')} · ${item.direction.replace('_', ' ')}` }));
  const segments = [...new Set(analytics.segments.map(item => item.segment))];
  const segmentData = segments.map(segment => ({ segment, ...Object.fromEntries(analytics.segments.filter(item => item.segment === segment).map(item => [item.sample_id, item.mean])) }));
  async function askGemini() {
    setAiLoading(true); setAiError('');
    try { setInsight((await aiAPI.getInsight('sensory', { study, analytics })).data.data); }
    catch (reason) { setAiError(getErrorMessage(reason, 'Gemini analysis is unavailable. Enable external AI processing in Account.')); }
    finally { setAiLoading(false); }
  }

  return <div className="space-y-6">
    <div className="surface-card flex flex-wrap items-center justify-between gap-3"><div><p className="eyebrow">Decision narrative</p><h2 className="text-lg font-bold">Gemini-assisted interpretation</h2><p className="mt-1 text-xs text-slate-500">Gemini explains the deterministic statistics; it cannot change scores or significance tests.</p></div><button type="button" onClick={() => void askGemini()} disabled={aiLoading} className="primary-button"><Bot className="h-4 w-4"/>{aiLoading ? 'Interpreting…' : 'Interpret with Gemini'}</button>{aiError && <p role="alert" className="w-full text-sm text-rose-700">{aiError}</p>}{insight && <div className="w-full rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-950"><p>{insight.summary}</p><ul className="mt-2 list-disc pl-5">{insight.recommendations.map((item: string) => <li key={item}>{item}</li>)}</ul></div>}</div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Metric label="Panelists" value={analytics.coverage.response_count}/><Metric label="Evaluations" value={analytics.coverage.evaluation_count}/><Metric label="Score completion" value={`${analytics.coverage.score_completion_percent}%`}/><Metric label="Segments" value={analytics.coverage.segment_count}/><Metric label="Quality flags" value={analytics.quality.flags.length + analytics.quality.outliers.length}/></div>
    {analytics.warnings.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><div className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4"/> Interpretation checks</div><ul className="mt-2 list-disc space-y-1 pl-5">{analytics.warnings.map(warning => <li key={warning.code}>{warning.message}</li>)}</ul></div>}

    <div className="grid gap-6 xl:grid-cols-2">
      <ChartCard title="Sensory profile" description="Mean attribute profile by sample on the study scale."><ResponsiveContainer width="100%" height={360}><RadarChart data={radarData} outerRadius="72%"><PolarGrid stroke="#cbd5e1"/><PolarAngleAxis dataKey="attribute" tick={{ fontSize: 11, fill: '#475569' }}/><PolarRadiusAxis domain={[study.scale_min, study.scale_max]} tick={{ fontSize: 10 }}/>{analytics.samples.map((sample, index) => <Radar key={sample.sample_id} name={sample.label} dataKey={sample.sample_id} stroke={COLORS[index % COLORS.length]} fill={COLORS[index % COLORS.length]} fillOpacity={0.08} strokeWidth={2}/>) }<Legend/><Tooltip/></RadarChart></ResponsiveContainer></ChartCard>
      <ChartCard title="Overall liking rank" description="Mean with panel count; confidence intervals are listed below."><ResponsiveContainer width="100%" height={300}><BarChart data={rankingData} layout="vertical" margin={{ left: 15, right: 20 }}><CartesianGrid strokeDasharray="3 3" horizontal={false}/><XAxis type="number" domain={[study.scale_min, study.scale_max]}/><YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }}/><Tooltip/><Bar dataKey="mean" name="Mean overall liking" fill="#0369a1" radius={[0, 5, 5, 0]}/></BarChart></ResponsiveContainer><div className="mt-3 grid gap-2 sm:grid-cols-2">{analytics.ranking.map((sample, index) => <div key={sample.sample_id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm"><span><strong>#{index + 1} {sample.label}</strong><span className="ml-2 text-slate-500">n={sample.overall.count}</span></span><span className="font-mono text-xs text-slate-600">95% CI {sample.overall.confidence_interval_95 ? `${sample.overall.confidence_interval_95.lower}–${sample.overall.confidence_interval_95.upper}` : '—'}</span></div>)}</div></ChartCard>
    </div>

    <div className="grid gap-6 xl:grid-cols-2">
      <ChartCard title="Attribute comparison" description="Compare sample means and variability for any measured attribute." action={<select value={attributeKey} onChange={event => setAttributeKey(event.target.value)} className="rounded-lg border px-3 py-2 text-sm">{study.attributes.map(attribute => <option key={attribute.key} value={attribute.key}>{attribute.label}</option>)}</select>}><ResponsiveContainer width="100%" height={320}><BarChart data={attributeData}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="name"/><YAxis domain={[study.scale_min, study.scale_max]}/><Tooltip/><Bar dataKey="mean" name="Mean score" fill="#7c3aed" radius={[5, 5, 0, 0]}/></BarChart></ResponsiveContainer></ChartCard>
      <ChartCard title="Score distribution" description="Panelist response counts across five equal-width score bands for the selected attribute."><ResponsiveContainer width="100%" height={320}><BarChart data={distributionData}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="label"/><YAxis allowDecimals={false}/><Tooltip/><Legend/>{analytics.samples.map((sample, index) => <Bar key={sample.sample_id} dataKey={sample.sample_id} name={sample.label} fill={COLORS[index % COLORS.length]} radius={[3, 3, 0, 0]}/>)}</BarChart></ResponsiveContainer></ChartCard>
    </div>

    <ChartCard title="Preference and purchase signals" description="Purchase intent uses a 1–5 scale; lower mean preference rank indicates stronger choice."><ResponsiveContainer width="100%" height={300}><BarChart data={commercialData}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="name"/><YAxis domain={[0, 5]}/><Tooltip/><Legend/><Bar dataKey="purchase_intent" name="Mean purchase intent" fill="#059669" radius={[5, 5, 0, 0]}/><Bar dataKey="preference_rank" name="Mean preference rank" fill="#0891b2" radius={[5, 5, 0, 0]}/></BarChart></ResponsiveContainer></ChartCard>

    <div className="grid gap-6 xl:grid-cols-[1.25fr_.75fr]">
      <ChartCard title="Repeated-measures inference" description="Panelist-blocked ANOVA and Friedman are used only for complete balanced panels; incomplete panels remain descriptive."><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="border-b bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-2">Attribute</th><th className="px-3 py-2">Method</th><th className="px-3 py-2">Statistic</th><th className="px-3 py-2">df</th><th className="px-3 py-2">p-value</th><th className="px-3 py-2">Effect</th><th className="px-3 py-2">Interpretation</th></tr></thead><tbody className="divide-y">{analytics.anova.map(item => { const result = item.result; return <tr key={item.attribute_key} className="align-top"><th className="px-3 py-3 text-left font-medium">{item.attribute_label}</th><td className="px-3 py-3"><span className="font-semibold">{result.valid_for_inference ? 'Panelist-blocked ANOVA' : 'Descriptive only'}</span>{result.friedman && <span className="mt-1 block text-xs text-slate-500">Friedman χ²={result.friedman.statistic}; p={result.friedman.p_value ?? 'not reported'}</span>}</td><td className="px-3 py-3">{result.valid_for_inference ? result.infinite_f ? 'F = ∞' : `F = ${result.statistic}` : '—'}</td><td className="px-3 py-3">{result.valid_for_inference ? `${result.df_between}, ${result.df_within}` : '—'}</td><td className="px-3 py-3 font-mono">{result.valid_for_inference ? result.p_value : '—'}</td><td className="px-3 py-3">{result.effect_size ? `${result.effect_size.name.replaceAll('_', ' ')} = ${result.effect_size.value}` : '—'}</td><td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-xs font-semibold ${result.valid_for_inference && result.significant_at_0_05 ? 'bg-emerald-100 text-emerald-800' : result.valid_for_inference ? 'bg-slate-100 text-slate-600' : 'bg-amber-100 text-amber-900'}`}>{result.valid_for_inference ? result.significant_at_0_05 ? 'Supported difference' : 'No supported difference' : 'Inference withheld'}</span><p className="mt-2 max-w-xs text-xs leading-5 text-slate-500">{result.reason}</p></td></tr>; })}</tbody></table></div></ChartCard>
      <ChartCard title="Attribute correlations" description="Pearson correlation across panelist-sample evaluations; n≥3 pairwise."><CorrelationHeatmap study={study} analytics={analytics}/></ChartCard>
    </div>

    <div className="grid gap-6 xl:grid-cols-2">
      <ChartCard title="JAR penalty analysis" description="Overall-liking drop for respondents rating an attribute too low or too high.">{jarData.length ? <><ResponsiveContainer width="100%" height={320}><BarChart data={jarData} layout="vertical" margin={{ left: 80 }}><CartesianGrid strokeDasharray="3 3" horizontal={false}/><XAxis type="number"/><YAxis type="category" dataKey="name" width={155} tick={{ fontSize: 10 }}/><Tooltip/><Bar dataKey="mean_drop" name="Mean liking drop" fill="#d97706" radius={[0, 5, 5, 0]}/></BarChart></ResponsiveContainer><div className="space-y-2">{jarData.filter(item => item.actionable).map(item => <div key={`${item.sample_id}-${item.dimension}-${item.direction}`} className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900"><strong>Actionable:</strong> {item.name} affects {item.percent}% of respondents with a {item.mean_drop}-point liking drop.</div>)}</div></> : <p className="py-16 text-center text-sm text-slate-500">No JAR responses with overall-liking data yet.</p>}</ChartCard>
      <ChartCard title="Segment comparison" description="Mean overall liking by declared respondent segment."><ResponsiveContainer width="100%" height={340}><BarChart data={segmentData}><CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="segment" tick={{ fontSize: 11 }}/><YAxis domain={[study.scale_min, study.scale_max]}/><Tooltip/><Legend/>{analytics.samples.map((sample, index) => <Bar key={sample.sample_id} dataKey={sample.sample_id} name={sample.label} fill={COLORS[index % COLORS.length]} radius={[4, 4, 0, 0]}/>)}</BarChart></ResponsiveContainer></ChartCard>
    </div>

    <ChartCard title="Data quality and outlier review" description="Flags are diagnostic only. No response is silently removed from calculations."><div className="grid gap-4 lg:grid-cols-2"><QualityList title="Response checks" items={analytics.quality.flags.map(flag => ({ title: `${flag.panelist_code} · ${flag.type.replace('_', ' ')}`, detail: flag.message }))}/><QualityList title="Statistical outliers" items={analytics.quality.outliers.map(outlier => ({ title: `${outlier.panelist_code} · ${outlier.sample_label} · ${outlier.attribute_label}`, detail: `${outlier.value}/10 · ${outlier.reason}` }))}/></div></ChartCard>
    <details className="rounded-xl border bg-white p-5 text-sm text-slate-600 shadow-sm"><summary className="cursor-pointer font-semibold text-slate-900">Methods and interpretation notes</summary><ul className="mt-3 list-disc space-y-2 pl-5">{Object.values(analytics.methodology).map((method, index) => <li key={index}>{method}</li>)}</ul></details>
  </div>;
}

function CorrelationHeatmap({ study, analytics }: { study: SensoryStudy; analytics: SensoryStudyAnalytics }) {
  const lookup = new Map(analytics.correlations.map(item => [`${item.row}:${item.column}`, item]));
  return <div className="overflow-x-auto"><div className="grid min-w-[34rem] gap-1" style={{ gridTemplateColumns: `7rem repeat(${study.attributes.length}, minmax(2.5rem, 1fr))` }}><span/>{study.attributes.map(attribute => <span key={attribute.key} className="truncate px-1 text-center text-[9px] text-slate-500" title={attribute.label}>{attribute.label}</span>)}{study.attributes.flatMap(row => [<span key={`${row.key}-label`} className="truncate self-center text-xs font-medium text-slate-600">{row.label}</span>, ...study.attributes.map(column => { const cell = lookup.get(`${row.key}:${column.key}`); const value = cell?.value; const intensity = value === null || value === undefined ? 0 : Math.abs(value); const background = value === null || value === undefined ? '#f1f5f9' : value >= 0 ? `rgba(2,132,199,${0.12 + intensity * 0.75})` : `rgba(225,29,72,${0.12 + intensity * 0.75})`; return <span key={`${row.key}-${column.key}`} title={`${row.label} × ${column.label}; r=${value ?? '—'}; n=${cell?.count || 0}`} className="flex aspect-square items-center justify-center rounded text-[10px] font-semibold" style={{ background }}>{value ?? '—'}</span>; })])}</div><div className="mt-3 flex justify-between text-[10px] text-slate-500"><span>Rose = negative relationship</span><span>Blue = positive relationship</span></div></div>;
}

function QualityList({ title, items }: { title: string; items: Array<{ title: string; detail: string }> }) {
  return <div className="rounded-xl bg-slate-50 p-4"><h3 className="font-semibold text-slate-900">{title} <span className="text-slate-400">({items.length})</span></h3>{items.length ? <div className="mt-3 max-h-72 space-y-2 overflow-auto">{items.map((item, index) => <div key={index} className="rounded-lg border bg-white p-3 text-sm"><strong className="capitalize text-slate-800">{item.title}</strong><p className="mt-1 text-xs text-slate-500">{item.detail}</p></div>)}</div> : <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 className="h-4 w-4"/> No flags detected</div>}</div>;
}

function SectionCard({ icon: Icon, eyebrow, title, description, children }: { icon: typeof FlaskConical; eyebrow: string; title: string; description: string; children: React.ReactNode }) {
  return <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"><div className="mb-5 flex gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-800"><Icon className="h-5 w-5"/></div><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-sky-700">{eyebrow}</p><h2 className="text-lg font-bold text-slate-900">{title}</h2><p className="mt-1 text-sm text-slate-500">{description}</p></div></div><div className="space-y-4">{children}</div></section>;
}

function ChartCard({ title, description, action, children }: { title: string; description: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-bold text-slate-900">{title}</h2><p className="mt-1 text-xs leading-5 text-slate-500">{description}</p></div>{action}</div>{children}</section>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="block text-sm font-medium text-slate-700"><span>{label}</span>{hint && <span className="ml-2 text-xs font-normal text-slate-600">{hint}</span>}<div className="mt-1.5">{children}</div></label>;
}

function Readiness({ ok, label }: { ok: boolean; label: string }) {
  return <div className="flex items-center gap-2"><span className={`flex h-5 w-5 items-center justify-center rounded-full ${ok ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{ok ? <CheckCircle2 className="h-3.5 w-3.5"/> : '·'}</span><span className={ok ? 'text-slate-700' : 'text-slate-600'}>{label}</span></div>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-xl border bg-white p-4 shadow-sm"><div className="text-2xl font-bold text-slate-900">{value}</div><div className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</div></div>;
}

function EmptyWorkspace({ title, description }: { title: string; description: string }) {
  return <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500"><BarChart3 className="h-6 w-6"/></div><h2 className="mt-4 text-lg font-bold text-slate-900">{title}</h2><p className="mx-auto mt-2 max-w-lg text-sm text-slate-500">{description}</p></div>;
}
