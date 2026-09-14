import { useEffect, useRef, useState } from 'react';
import { Bot, BrainCircuit, Check, ClipboardCheck, Download, FileSpreadsheet, Pencil, Save, Trash2, Upload, X } from 'lucide-react';
import { aiAPI, formulationsAPI, laboratoryAPI } from '../services/api';
import type { Formulation, LaboratoryResult } from '../types';
import StatusMessage from '../components/StatusMessage';
import { getErrorMessage } from '../services/errors';
import { downloadSpreadsheetTemplate, optionalNumber, readSpreadsheet, type SpreadsheetRow } from '../utils/spreadsheet';

const measurementFields = [
  ['ph', 'pH', '0–14'], ['brix', '°Brix', '% soluble solids'], ['titratable_acidity', 'Titratable acidity', '%'],
  ['viscosity', 'Viscosity', 'mPa·s'], ['density', 'Density', 'g/mL'], ['turbidity', 'Turbidity', 'NTU'],
  ['stability_score', 'Stability', '0–100'],
] as const;
const sensoryFields = [['appearance', 'Appearance'], ['aroma', 'Aroma'], ['taste', 'Taste'], ['mouthfeel', 'Mouthfeel'], ['overall_acceptance', 'Overall acceptance']] as const;

const today = () => new Date().toISOString().slice(0, 10);
const stringifyNumbers = (values: Record<string, number | undefined>) => Object.fromEntries(Object.entries(values || {}).map(([key, value]) => [key, value === undefined ? '' : String(value)]));

export default function LaboratoryResultsPage() {
  const [formulations, setFormulations] = useState<Formulation[]>([]);
  const [formulationId, setFormulationId] = useState('');
  const [results, setResults] = useState<LaboratoryResult[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [measurements, setMeasurements] = useState<Record<string, string>>({});
  const [sensory, setSensory] = useState<Record<string, string>>({});
  const [batchCode, setBatchCode] = useState('');
  const [testedAt, setTestedAt] = useState(today());
  const [notes, setNotes] = useState('');
  const [includeLearning, setIncludeLearning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [summary, setSummary] = useState<{ approved_examples: number } | null>(null);
  const [insight, setInsight] = useState<any>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { void loadFormulations(); void loadSummary(); }, []);
  useEffect(() => { if (formulationId) void loadResults(); else setResults([]); resetForm(); }, [formulationId]);

  async function loadFormulations() {
    try { const response = await formulationsAPI.getAll({ limit: 100 }); setFormulations(response.data.data); setFormulationId(response.data.data[0]?.id || ''); }
    catch (reason) { setError(getErrorMessage(reason, 'Unable to load formulations.')); }
    finally { setLoading(false); }
  }
  async function loadResults() { try { setResults((await formulationsAPI.getLaboratoryResults(formulationId)).data.data); } catch (reason) { setError(getErrorMessage(reason, 'Unable to load laboratory results.')); } }
  async function loadSummary() { try { setSummary((await laboratoryAPI.getLearningSummary()).data.data); } catch { /* optional */ } }
  function resetForm() { setEditingId(null); setMeasurements({}); setSensory({}); setBatchCode(''); setTestedAt(today()); setNotes(''); setIncludeLearning(false); }
  function editResult(result: LaboratoryResult) {
    setEditingId(result.id); setBatchCode(result.batch_code || ''); setTestedAt(result.tested_at.slice(0, 10)); setMeasurements(stringifyNumbers(result.measurements)); setSensory(stringifyNumbers(result.sensory)); setNotes(result.notes || ''); setIncludeLearning(result.include_in_ai_learning); window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  const numericMap = (values: Record<string, string>) => Object.fromEntries(Object.entries(values).filter(([, value]) => value !== '').map(([key, value]) => [key, Number(value)]));
  const payload = () => ({ batch_code: batchCode || undefined, tested_at: `${testedAt}T12:00:00.000Z`, measurements: numericMap(measurements), sensory: numericMap(sensory), notes: notes || undefined, include_in_ai_learning: includeLearning });
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!formulationId) return; setSaving(true); setError(''); setMessage('');
    try {
      if (editingId) { await formulationsAPI.updateLaboratoryResult(formulationId, editingId, payload()); setMessage('Laboratory result updated and saved permanently.'); }
      else { const response = await formulationsAPI.addLaboratoryResult(formulationId, payload()); setMessage(response.data.learning.message); }
      resetForm(); await Promise.all([loadResults(), loadSummary()]);
    } catch (reason) { setError(getErrorMessage(reason, 'Unable to save laboratory result.')); } finally { setSaving(false); }
  }
  async function removeResult(result: LaboratoryResult) {
    if (!window.confirm(`Archive laboratory result “${result.batch_code || result.id}”?`)) return;
    try { await formulationsAPI.deleteLaboratoryResult(formulationId, result.id); if (editingId === result.id) resetForm(); await loadResults(); setMessage('Laboratory result archived.'); }
    catch (reason) { setError(getErrorMessage(reason, 'Unable to archive laboratory result.')); }
  }
  function mapImportRow(row: SpreadsheetRow) {
    const read = (...keys: string[]) => keys.map(key => row[key]).find(value => value !== '' && value !== undefined && value !== null);
    const importedMeasurements = Object.fromEntries(measurementFields.map(([key]) => [key, optionalNumber(read(key))]).filter(([, value]) => value !== undefined));
    const importedSensory = Object.fromEntries(sensoryFields.map(([key]) => [key, optionalNumber(read(key))]).filter(([, value]) => value !== undefined));
    const rawDate = read('tested_at', 'test_date', 'date', 'date_essai');
    return { batch_code: String(read('batch_code', 'batch', 'sample_code', 'lot', 'code_lot') || '').trim() || undefined, tested_at: rawDate instanceof Date ? rawDate.toISOString() : rawDate ? new Date(String(rawDate)).toISOString() : undefined, measurements: importedMeasurements, sensory: importedSensory, notes: String(read('notes', 'observations', 'comment') || '').trim() || undefined, include_in_ai_learning: ['true', 'yes', 'oui', '1'].includes(String(read('include_in_ai_learning', 'ai_learning') || '').toLowerCase()) };
  }
  async function importFile(file: File) {
    setImporting(true); setError(''); setMessage('');
    try { const rows = (await readSpreadsheet(file)).map(mapImportRow); const response = await formulationsAPI.importLaboratoryResults(formulationId, rows); await loadResults(); setMessage(`${response.data.imported} row(s) imported${response.data.rejected ? `; ${response.data.rejected} rejected. ${response.data.errors[0]?.message || ''}` : '.'}`); }
    catch (reason) { setError(getErrorMessage(reason, 'Unable to import this spreadsheet. Check the template and date values.')); }
    finally { setImporting(false); if (fileRef.current) fileRef.current.value = ''; }
  }
  function template() { downloadSpreadsheetTemplate('beverageai-lab-results-template.xlsx', [{ batch_code: 'R&D-024', tested_at: today(), ph: 3.2, brix: 10.5, titratable_acidity: 0.35, viscosity: 1.8, density: 1.04, turbidity: 12, stability_score: 85, appearance: 8, aroma: 7.5, taste: 8, mouthfeel: 7, overall_acceptance: 8, notes: 'Example row', include_in_ai_learning: false }]); }
  async function askGemini() {
    const selected = results.find(item => item.id === editingId) || results[0];
    if (!selected) return; setAiLoading(true); setError('');
    try { setInsight((await aiAPI.getInsight('laboratory', { formulation: formulations.find(item => item.id === formulationId), laboratory_result: selected })).data.data); }
    catch (reason) { setError(getErrorMessage(reason, 'Gemini analysis is unavailable. Enable external AI processing in Account.')); }
    finally { setAiLoading(false); }
  }

  return <div className="space-y-6 pb-10">
    <header className="hero-panel"><div><span className="hero-kicker"><ClipboardCheck className="h-4 w-4"/> Quality data workspace</span><h1>Laboratory Results</h1><p>Build a durable batch history, edit past observations, and import instrument or panel files without retyping data.</p></div><div className="grid grid-cols-2 gap-3"><HeroMetric value={results.length} label="Saved tests"/><HeroMetric value={summary?.approved_examples || 0} label="AI-ready"/></div></header>
    <StatusMessage error={error} message={message}/>
    <section className="surface-card flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><label className="block flex-1 text-sm font-semibold text-slate-700">Formulation analyzed<select value={formulationId} onChange={event => setFormulationId(event.target.value)} className="input mt-2"><option value="">Choose a formulation</option>{formulations.map(formulation => <option key={formulation.id} value={formulation.id}>{formulation.name} ({formulation.code})</option>)}</select></label><div className="flex flex-wrap gap-2"><button type="button" onClick={template} className="secondary-button"><Download className="h-4 w-4"/> Template</button><button type="button" onClick={() => fileRef.current?.click()} disabled={!formulationId || importing} className="primary-button"><Upload className="h-4 w-4"/>{importing ? 'Importing…' : 'Import CSV / Excel'}</button><input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={event => event.target.files?.[0] && void importFile(event.target.files[0])}/></div></section>
    {summary && <div className="flex gap-3 rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-950"><BrainCircuit className="h-5 w-5 shrink-0"/><p><strong>{summary.approved_examples}</strong> consented local learning example(s). Gemini receives data only when external processing is enabled in Account.</p></div>}
    <div className="grid gap-6 xl:grid-cols-[1.4fr_.8fr]">
      <form onSubmit={submit} className="surface-card space-y-6"><div className="flex items-center justify-between"><div><p className="eyebrow">{editingId ? 'Edit record' : 'New record'}</p><h2 className="text-xl font-bold text-slate-950">{editingId ? 'Update a saved result' : 'Capture a batch result'}</h2></div>{editingId && <button type="button" onClick={resetForm} className="secondary-button"><X className="h-4 w-4"/> Cancel</button>}</div><div className="grid gap-4 sm:grid-cols-2"><Field label="Batch / sample code"><input value={batchCode} onChange={event => setBatchCode(event.target.value)} className="input" placeholder="e.g. R&D-024"/></Field><Field label="Test date"><input type="date" required value={testedAt} onChange={event => setTestedAt(event.target.value)} className="input"/></Field></div><Fieldset title="Physicochemical characteristics"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{measurementFields.map(([key, label, unit]) => <Field key={key} label={`${label} · ${unit}`}><input type="number" step="any" min="0" max={key === 'ph' ? 14 : undefined} value={measurements[key] || ''} onChange={event => setMeasurements({ ...measurements, [key]: event.target.value })} className="input"/></Field>)}</div></Fieldset><Fieldset title="Organoleptic characteristics"><p className="mb-3 text-xs text-slate-500">0 = unacceptable; 10 = excellent.</p><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{sensoryFields.map(([key, label]) => <Field key={key} label={label}><input type="number" step="0.1" min="0" max="10" value={sensory[key] || ''} onChange={event => setSensory({ ...sensory, [key]: event.target.value })} className="input"/></Field>)}</div></Fieldset><Field label="Observations / panel notes"><textarea value={notes} onChange={event => setNotes(event.target.value)} className="input" rows={3} placeholder="e.g. slight haze after 7 days at 40°C"/></Field><label className="flex gap-3 rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-950"><input type="checkbox" checked={includeLearning} onChange={event => setIncludeLearning(event.target.checked)} className="mt-1"/><span><strong>Use this result for AI calibration</strong><br/><span className="text-violet-700">The result stays in this workspace and is not automatically sent to Gemini.</span></span></label><button type="submit" disabled={saving || !formulationId || loading} className="primary-button"><Save className="h-4 w-4"/>{saving ? 'Saving…' : editingId ? 'Save changes' : 'Save result'}</button></form>
      <aside className="surface-card self-start xl:sticky xl:top-24"><div className="mb-4 flex items-center justify-between"><div><p className="eyebrow">Database</p><h2 className="text-lg font-bold">Saved results</h2></div><span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800"><Check className="mr-1 inline h-3 w-3"/>Persistent</span></div>{results.length === 0 ? <div className="rounded-xl border border-dashed p-8 text-center"><FileSpreadsheet className="mx-auto h-8 w-8 text-slate-300"/><p className="mt-3 text-sm text-slate-500">No results for this formulation yet.</p></div> : <div className="max-h-[62rem] space-y-3 overflow-auto pr-1">{results.map(result => <article key={result.id} className={`group rounded-xl border p-4 transition ${editingId === result.id ? 'border-sky-400 bg-sky-50 ring-2 ring-sky-100' : 'border-slate-200 hover:border-sky-300 hover:shadow-sm'}`}><button type="button" onClick={() => editResult(result)} className="w-full text-left"><div className="flex items-start justify-between gap-3"><div><div className="font-semibold text-slate-900">{result.batch_code || 'Uncoded sample'}</div><div className="text-xs text-slate-500">{new Date(result.tested_at).toLocaleDateString()}</div></div><Pencil className="h-4 w-4 text-slate-400 group-hover:text-sky-700"/></div><div className="mt-3 grid grid-cols-3 gap-2 text-center"><Mini label="pH" value={result.measurements.ph}/><Mini label="°Brix" value={result.measurements.brix}/><Mini label="Accept." value={result.sensory.overall_acceptance}/></div>{result.notes && <p className="mt-3 line-clamp-2 text-xs text-slate-500">{result.notes}</p>}</button><button type="button" onClick={() => void removeResult(result)} className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-rose-600 opacity-0 transition group-hover:opacity-100 focus:opacity-100"><Trash2 className="h-3 w-3"/> Archive</button></article>)}</div>}</aside>
    </div>
    {results.length > 0 && <section className="surface-card"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="eyebrow">AI interpretation</p><h2 className="text-lg font-bold">Review the {editingId ? 'selected' : 'latest'} result with Gemini</h2><p className="mt-1 text-xs text-slate-500">Only runs when external processing is enabled in Account; calculated measurements remain unchanged.</p></div><button type="button" onClick={() => void askGemini()} disabled={aiLoading} className="primary-button"><Bot className="h-4 w-4"/>{aiLoading ? 'Analyzing…' : 'Ask Gemini'}</button></div>{insight && <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-950"><p>{insight.summary}</p><ul className="mt-2 list-disc pl-5">{insight.recommendations.map((item: string) => <li key={item}>{item}</li>)}</ul></div>}</section>}
  </div>;
}

function HeroMetric({ value, label }: { value: number; label: string }) { return <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-center"><div className="text-2xl font-bold text-slate-950">{value}</div><div className="text-[10px] font-bold uppercase tracking-wider text-slate-600">{label}</div></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-sm font-medium text-slate-700"><span>{label}</span><div className="mt-1.5">{children}</div></label>; }
function Fieldset({ title, children }: { title: string; children: React.ReactNode }) { return <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-4"><h3 className="mb-3 font-semibold text-slate-900">{title}</h3>{children}</section>; }
function Mini({ label, value }: { label: string; value?: number }) { return <div className="rounded-lg bg-slate-50 px-2 py-2"><div className="font-mono text-sm font-semibold text-slate-800">{value ?? '—'}</div><div className="text-[9px] uppercase tracking-wide text-slate-400">{label}</div></div>; }
