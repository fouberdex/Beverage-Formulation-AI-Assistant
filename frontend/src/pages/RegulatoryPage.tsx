import { useEffect, useState } from 'react';
import { AlertTriangle, Bot, CheckCircle2, FileText, Loader, ShieldCheck, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { aiAPI, formulationsAPI, regulatoryAPI } from '../services/api';
import type { Formulation } from '../types';
import StatusMessage from '../components/StatusMessage';
import { getErrorMessage } from '../services/errors';

export default function RegulatoryPage() {
  const [formulations, setFormulations] = useState<Formulation[]>([]);
  const [formulationId, setFormulationId] = useState('');
  const [compliance, setCompliance] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [insight, setInsight] = useState<any>(null);
  const [error, setError] = useState('');
  useEffect(() => { void (async () => { try { const response = await formulationsAPI.getAll({ limit: 100 }); setFormulations(response.data.data); setFormulationId(response.data.data[0]?.id || ''); } catch (reason) { setError(getErrorMessage(reason)); } })(); }, []);
  async function check() { if (!formulationId) return; setLoading(true); setError(''); try { setCompliance((await regulatoryAPI.checkCompliance(formulationId)).data.data); } catch (reason) { setError(getErrorMessage(reason, 'Unable to run regulatory screening.')); } finally { setLoading(false); } }
  async function askGemini() { if (!compliance) return; setAiLoading(true); setError(''); try { setInsight((await aiAPI.getInsight('regulatory', { formulation, compliance })).data.data); } catch (reason) { setError(getErrorMessage(reason, 'Gemini review is unavailable. Enable external AI processing in Account.')); } finally { setAiLoading(false); } }
  const formulation = formulations.find(item => item.id === formulationId);
  const cards = compliance ? [
    ['Halal data', compliance.is_halal_compliant], ['Kosher data', compliance.is_kosher_compliant],
    ['Vegan data', compliance.is_vegan_compliant], ['Configured limits', compliance.algerian_regulatory_compliant],
  ] as const : [];
  return <div className="space-y-6 pb-12">
    <header className="hero-panel"><div><span className="hero-kicker"><ShieldCheck className="h-4 w-4"/> Regulatory screening</span><h1>Compliance workspace</h1><p>Screen formulation records against certification flags, ingredient status and configured concentration limits before formal legal review.</p></div><Link to="/labels" className="secondary-button"><FileText className="h-4 w-4"/>Open Label Studio</Link></header>
    <StatusMessage error={error}/>
    <section className="surface-card space-y-5"><div className="grid gap-4 lg:grid-cols-[1fr_auto]"><label className="text-sm font-semibold text-slate-700">Formulation<select value={formulationId} onChange={event => { setFormulationId(event.target.value); setCompliance(null); }} className="input mt-2"><option value="">Choose a formulation</option>{formulations.map(item => <option key={item.id} value={item.id}>{item.name} ({item.code})</option>)}</select></label><button onClick={() => void check()} disabled={!formulationId || loading} className="primary-button self-end"><>{loading ? <Loader className="h-4 w-4 animate-spin"/> : <ShieldCheck className="h-4 w-4"/>}</>{loading ? 'Screening…' : 'Check compliance'}</button></div>{formulation && <div className="grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-4"><Metric label="Type" value={formulation.beverage_type}/><Metric label="Ingredients" value={formulation.ingredients?.length || 0}/><Metric label="Total" value={`${(formulation.total_percentage || 0).toFixed(2)}%`}/><Metric label="Version" value={`v${formulation.version}`}/></div>}</section>
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><div className="flex gap-3"><AlertTriangle className="h-5 w-5 shrink-0"/><div><strong>Decision-support screen, not a legal certificate.</strong><p className="mt-1 text-amber-800">Final labels and claims require current jurisdictional texts, supplier specifications and qualified regulatory sign-off.</p></div></div></div>
    {compliance && <section className="space-y-5"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{cards.map(([label, pass]) => <div key={label} className={`rounded-xl border p-5 ${pass ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`}>{pass ? <CheckCircle2 className="h-6 w-6 text-emerald-700"/> : <XCircle className="h-6 w-6 text-rose-700"/>}<div className="mt-3 font-bold text-slate-900">{label}</div><div className={`mt-1 text-sm ${pass ? 'text-emerald-800' : 'text-rose-800'}`}>{pass ? 'Passed local data check' : 'Review required'}</div></div>)}</div>{compliance.violations?.length > 0 ? <div className="surface-card"><h2 className="text-lg font-bold text-rose-900">Issues requiring action</h2><div className="mt-4 space-y-2">{compliance.violations.map((item: any, index: number) => <div key={index} className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900"><strong className="capitalize">{item.type}</strong>{item.ingredient ? ` · ${item.ingredient}` : ''}<p className="mt-1">{item.message}</p></div>)}</div></div> : <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950"><CheckCircle2 className="mr-2 inline h-5 w-5"/><strong>All configured local checks passed.</strong> Continue to document and legal review.</div>}<div className="surface-card"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="eyebrow">AI second pass</p><h2 className="font-bold">Gemini regulatory review</h2></div><button type="button" onClick={() => void askGemini()} disabled={aiLoading} className="primary-button"><Bot className="h-4 w-4"/>{aiLoading ? 'Reviewing…' : 'Review with Gemini'}</button></div>{insight && <div className="mt-4 rounded-xl bg-violet-50 p-4 text-sm text-violet-950"><p>{insight.summary}</p><ul className="mt-2 list-disc pl-5">{insight.recommendations.map((item: string) => <li key={item}>{item}</li>)}</ul></div>}</div></section>}
  </div>;
}
function Metric({ label, value }: { label: string; value: string | number }) { return <div><span className="text-[10px] font-bold uppercase tracking-wider text-slate-600">{label}</span><p className="mt-1 font-semibold text-slate-800">{value}</p></div>; }
