import { useEffect, useState } from 'react';
import { Save, BrainCircuit, ClipboardCheck } from 'lucide-react';
import { formulationsAPI, laboratoryAPI } from '../services/api';
import type { Formulation, LaboratoryResult } from '../types';
import StatusMessage from '../components/StatusMessage';
import { getErrorMessage } from '../services/errors';

const measurementFields = [
  ['ph', 'pH', '0–14'], ['brix', '°Brix', '% soluble solids'], ['titratable_acidity', 'Titratable acidity', '%'],
  ['viscosity', 'Viscosity', 'mPa·s'], ['density', 'Density', 'g/mL'], ['turbidity', 'Turbidity', 'NTU'],
  ['stability_score', 'Stability', '0–100'],
] as const;
const sensoryFields = [['appearance', 'Appearance'], ['aroma', 'Aroma'], ['taste', 'Taste'], ['mouthfeel', 'Mouthfeel'], ['overall_acceptance', 'Overall acceptance']] as const;

export default function LaboratoryResultsPage() {
  const [formulations, setFormulations] = useState<Formulation[]>([]);
  const [formulationId, setFormulationId] = useState('');
  const [results, setResults] = useState<LaboratoryResult[]>([]);
  const [measurements, setMeasurements] = useState<Record<string, string>>({});
  const [sensory, setSensory] = useState<Record<string, string>>({});
  const [batchCode, setBatchCode] = useState(''); const [notes, setNotes] = useState('');
  const [includeLearning, setIncludeLearning] = useState(false); const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const [summary, setSummary] = useState<{ approved_examples: number; last_added_at?: string | null } | null>(null);

  useEffect(() => { void loadFormulations(); void loadSummary(); }, []);
  useEffect(() => { if (formulationId) void loadResults(); else setResults([]); }, [formulationId]);
  async function loadFormulations() { try { const response = await formulationsAPI.getAll({ limit: 100 }); setFormulations(response.data.data); setFormulationId(response.data.data[0]?.id || ''); } catch (e) { setError(getErrorMessage(e, 'Unable to load formulations.')); } finally { setLoading(false); } }
  async function loadResults() { try { const response = await formulationsAPI.getLaboratoryResults(formulationId); setResults(response.data.data); } catch (e) { setError(getErrorMessage(e, 'Unable to load laboratory results.')); } }
  async function loadSummary() { try { const response = await laboratoryAPI.getLearningSummary(); setSummary(response.data.data); } catch { /* data remains usable without summary */ } }
  function numericMap(values: Record<string, string>) { return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== '').map(([key, value]) => [key, Number(value)])); }
  async function submit(event: React.FormEvent) { event.preventDefault(); if (!formulationId) return; setSaving(true); setError(''); setMessage(''); try {
    const response = await formulationsAPI.addLaboratoryResult(formulationId, { batch_code: batchCode || undefined, measurements: numericMap(measurements), sensory: numericMap(sensory), notes: notes || undefined, include_in_ai_learning: includeLearning });
    setMessage(response.data.learning.message); setMeasurements({}); setSensory({}); setBatchCode(''); setNotes(''); setIncludeLearning(false); await Promise.all([loadResults(), loadSummary()]);
  } catch (e) { setError(getErrorMessage(e, 'Unable to save laboratory result.')); } finally { setSaving(false); } }
  return <div>
    <div className="px-4 py-5 sm:px-6"><h1 className="text-3xl font-bold text-gray-900">Laboratory Results</h1><p className="mt-1 text-sm text-gray-500">Capture measured physicochemical and organoleptic results for each formulation batch.</p></div>
    <div className="mx-4 mb-4"><StatusMessage error={error} message={message} /></div>
    {summary && <div className="mx-4 mb-4 rounded-lg border border-violet-200 bg-violet-50 p-4 text-sm text-violet-900 flex gap-3"><BrainCircuit className="h-5 w-5 shrink-0"/><p><strong>{summary.approved_examples}</strong> approved local learning {summary.approved_examples === 1 ? 'example' : 'examples'}. Opted-in results calibrate future recommendations in this workspace; they are not automatically sent to an external AI provider.</p></div>}
    <div className="grid gap-6 lg:grid-cols-3 mx-4">
      <form onSubmit={submit} className="lg:col-span-2 bg-white shadow rounded-lg p-6 space-y-6">
        <div><label className="block text-sm font-medium text-gray-700 mb-2" htmlFor="lab-formulation">Formulation</label><select id="lab-formulation" value={formulationId} onChange={e => setFormulationId(e.target.value)} className="w-full border rounded-md p-2">{formulations.map(f => <option key={f.id} value={f.id}>{f.name} ({f.code})</option>)}</select></div>
        <div className="grid sm:grid-cols-2 gap-4"><div><label className="block text-sm font-medium text-gray-700 mb-1">Batch / sample code</label><input value={batchCode} onChange={e => setBatchCode(e.target.value)} className="w-full border rounded-md p-2" placeholder="e.g. R&D-024" /></div><div><label className="block text-sm font-medium text-gray-700 mb-1">Test date</label><input type="date" defaultValue={new Date().toISOString().slice(0, 10)} disabled className="w-full border rounded-md p-2 bg-gray-50" /></div></div>
        <section><h2 className="font-semibold text-gray-900 mb-3">Physicochemical characteristics</h2><div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">{measurementFields.map(([key, label, unit]) => <label key={key} className="text-sm text-gray-700">{label}<span className="text-gray-400"> · {unit}</span><input type="number" step="any" min="0" max={key === 'ph' ? 14 : undefined} value={measurements[key] || ''} onChange={e => setMeasurements({ ...measurements, [key]: e.target.value })} className="mt-1 w-full border rounded-md p-2" /></label>)}</div></section>
        <section><h2 className="font-semibold text-gray-900 mb-1">Organoleptic characteristics</h2><p className="text-xs text-gray-500 mb-3">Score each attribute from 0 (unacceptable) to 10 (excellent).</p><div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">{sensoryFields.map(([key, label]) => <label key={key} className="text-sm text-gray-700">{label}<input type="number" step="0.1" min="0" max="10" value={sensory[key] || ''} onChange={e => setSensory({ ...sensory, [key]: e.target.value })} className="mt-1 w-full border rounded-md p-2" /></label>)}</div></section>
        <label className="block text-sm font-medium text-gray-700">Observations / panel notes<textarea value={notes} onChange={e => setNotes(e.target.value)} className="mt-1 w-full border rounded-md p-2" rows={3} placeholder="e.g. slight haze after 7 days at 40°C" /></label>
        <label className="flex gap-3 rounded-lg border border-violet-200 bg-violet-50 p-4 text-sm text-violet-900"><input type="checkbox" checked={includeLearning} onChange={e => setIncludeLearning(e.target.checked)} className="mt-1" /><span><strong>Use this result to improve future recommendations</strong><br/>Create a consented local learning example using this formulation and its actual lab outcome. This does not retrain a foundation model or send the result externally.</span></label>
        <button type="submit" disabled={saving || !formulationId || loading} className="inline-flex items-center bg-sky-700 text-white rounded-md px-4 py-2 hover:bg-sky-800 disabled:opacity-50"><Save className="h-4 w-4 mr-2" />{saving ? 'Saving…' : 'Save laboratory result'}</button>
      </form>
      <aside className="bg-white shadow rounded-lg p-6"><div className="flex items-center gap-2 mb-4"><ClipboardCheck className="h-5 w-5 text-sky-700"/><h2 className="font-semibold">Saved results</h2></div>{results.length === 0 ? <p className="text-sm text-gray-500">No results saved for this formulation yet.</p> : <div className="space-y-3">{results.map(result => <div key={result.id} className="rounded border p-3 text-sm"><div className="font-medium">{result.batch_code || 'Uncoded sample'}</div><div className="text-gray-500">{new Date(result.tested_at).toLocaleDateString()}</div><div className="mt-2 text-gray-700">pH {result.measurements.ph ?? '—'} · °Brix {result.measurements.brix ?? '—'} · Acceptance {result.sensory.overall_acceptance ?? '—'}/10</div>{result.include_in_ai_learning && <div className="mt-2 text-xs text-violet-700">Included in local learning</div>}</div>)}</div>}</aside>
    </div>
  </div>;
}
