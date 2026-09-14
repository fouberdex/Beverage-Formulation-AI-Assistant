import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bot, CheckCircle2, Clipboard, Download, FileBarChart, FileText, Languages, Package, PackageCheck, Printer, Search, Sparkles } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { aiAPI, formulationsAPI, regulatoryAPI } from '../services/api';
import { getErrorMessage } from '../services/errors';
import StatusMessage from '../components/StatusMessage';
import type { Formulation } from '../types';

type StudioTab = 'recipes' | 'builder' | 'live' | 'reports';
const claimOptions = ['No added sugar', 'Sugar free', 'Low calorie', 'Vegan', 'Halal', 'Natural flavours', 'Source of vitamin C', 'Preservative free'];
const defaultOptions = { market: 'algeria', language: 'fr', serving_size_ml: 250, servings_per_container: 1, net_volume_ml: 250, manufacturer_name: '', manufacturer_address: '', country_of_origin: 'Algeria', storage_instructions: 'Store in a cool, dry place away from direct sunlight.', shelf_life_months: 12, lot_placeholder: 'LOT: ______', claims: [] as string[] };

export default function LabelsPage() {
  const [tab, setTab] = useState<StudioTab>('recipes');
  const [formulations, setFormulations] = useState<Formulation[]>([]);
  const [formulationId, setFormulationId] = useState('');
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState({ ...defaultOptions });
  const [labels, setLabels] = useState<any>(null);
  const [insight, setInsight] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => { void loadFormulations(); }, []);
  useEffect(() => { if (formulationId) void loadSavedLabel(formulationId); }, [formulationId]);

  async function loadFormulations() {
    try {
      const response = await formulationsAPI.getAll({ limit: 100 });
      setFormulations(response.data.data);
      setFormulationId(current => current || response.data.data[0]?.id || '');
    } catch (reason) { setError(getErrorMessage(reason)); }
  }

  async function loadSavedLabel(id: string) {
    setLabels(null); setInsight(null);
    try { setLabels((await regulatoryAPI.getLabels(id)).data.data); }
    catch (reason: any) { if (reason?.status !== 404) setError(getErrorMessage(reason, 'Unable to load the saved label.')); }
  }

  async function generate() {
    if (!formulationId) return;
    setLoading(true); setError(''); setInsight(null); setMessage('');
    try {
      const response = await regulatoryAPI.generateLabels(formulationId, options);
      setLabels(response.data.data);
      setMessage('Draft label generated and saved with the formulation.');
      setTab('builder');
    } catch (reason) { setError(getErrorMessage(reason, 'Unable to generate the label.')); }
    finally { setLoading(false); }
  }

  async function askGemini() {
    if (!label) return;
    setAiLoading(true); setError('');
    try { setInsight((await aiAPI.getInsight('regulatory', { formulation, label, market: options.market })).data.data); }
    catch (reason) { setError(getErrorMessage(reason, 'Gemini review is unavailable. Enable external AI processing in Account.')); }
    finally { setAiLoading(false); }
  }

  function chooseRecipe(id: string) { setFormulationId(id); setTab('builder'); setMessage('Formulation loaded into Label Builder.'); }
  function toggleClaim(claim: string) { setOptions(current => ({ ...current, claims: current.claims.includes(claim) ? current.claims.filter(item => item !== claim) : [...current.claims, claim] })); }
  function downloadLabelData() {
    if (!label) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(label, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${label.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${options.language}-label.json`; anchor.click(); URL.revokeObjectURL(url);
    setMessage('Label data downloaded.');
  }
  async function copyPreviewLink() {
    try { await navigator.clipboard.writeText(previewUrl); setMessage('Workspace preview link copied.'); }
    catch { setError('The browser could not copy the preview link.'); }
  }

  const formulation = formulations.find(item => item.id === formulationId);
  const label = labels?.[options.language];
  const filteredFormulations = useMemo(() => formulations.filter(item => `${item.name} ${item.code}`.toLowerCase().includes(search.toLowerCase())), [formulations, search]);
  const previewUrl = `${window.location.origin}/labels?product=${encodeURIComponent(formulationId)}&language=${options.language}`;

  return <div className="space-y-6 pb-12">
    <header className="hero-panel"><div><span className="hero-kicker"><FileText className="h-4 w-4"/> Packaging workspace</span><h1>Label Studio</h1><p>Manage recipes, build multilingual label drafts, preview QR-linked product pages and review launch readiness.</p></div><div className="hidden rounded-2xl border border-sky-100 bg-sky-50 p-4 sm:block"><PackageCheck className="h-10 w-10 text-sky-700"/></div></header>
    <StatusMessage error={error} message={message}/>
    <div role="tablist" aria-label="Label Studio" className="grid gap-1 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm sm:grid-cols-4">
      <StudioTabButton active={tab === 'recipes'} icon={Package} label="Recipes" onClick={() => setTab('recipes')}/>
      <StudioTabButton active={tab === 'builder'} icon={FileText} label="Label Builder" onClick={() => setTab('builder')}/>
      <StudioTabButton active={tab === 'live'} icon={Languages} label="Live Label" onClick={() => setTab('live')}/>
      <StudioTabButton active={tab === 'reports'} icon={FileBarChart} label="Reports" onClick={() => setTab('reports')}/>
    </div>

    {tab === 'recipes' && <Recipes formulations={filteredFormulations} search={search} setSearch={setSearch} onChoose={chooseRecipe}/>} 
    {tab === 'builder' && <div className="grid gap-6 xl:grid-cols-[.9fr_1.1fr]">
      <section className="surface-card space-y-5"><div><p className="eyebrow">Label brief</p><h2 className="text-xl font-black text-slate-950">Product and market</h2></div>
        <Field label="Formulation"><select className="input" value={formulationId} onChange={event => setFormulationId(event.target.value)}><option value="">Choose a formulation</option>{formulations.map(item => <option key={item.id} value={item.id}>{item.name} ({item.code})</option>)}</select></Field>
        <div className="grid gap-4 sm:grid-cols-2"><Field label="Target market"><select className="input" value={options.market} onChange={event => setOptions({ ...options, market: event.target.value })}><option value="algeria">Algeria — review draft</option><option value="eu">European Union</option><option value="uk">United Kingdom</option><option value="us">United States / FDA</option></select></Field><Field label="Primary language"><select className="input" value={options.language} onChange={event => setOptions({ ...options, language: event.target.value })}><option value="fr">Français</option><option value="ar">العربية</option><option value="en">English</option></select></Field></div>
        <div className="grid gap-4 sm:grid-cols-3"><NumberField label="Net volume (mL)" value={options.net_volume_ml} onChange={value => setOptions({ ...options, net_volume_ml: value })}/><NumberField label="Serving (mL)" value={options.serving_size_ml} onChange={value => setOptions({ ...options, serving_size_ml: value })}/><NumberField label="Servings / pack" value={options.servings_per_container} onChange={value => setOptions({ ...options, servings_per_container: value })}/></div>
        <div className="grid gap-4 sm:grid-cols-2"><Field label="Manufacturer / responsible operator"><input className="input" value={options.manufacturer_name} onChange={event => setOptions({ ...options, manufacturer_name: event.target.value })}/></Field><Field label="Country of origin"><input className="input" value={options.country_of_origin} onChange={event => setOptions({ ...options, country_of_origin: event.target.value })}/></Field></div>
        <Field label="Address"><textarea className="input" rows={2} value={options.manufacturer_address} onChange={event => setOptions({ ...options, manufacturer_address: event.target.value })}/></Field>
        <div className="grid gap-4 sm:grid-cols-2"><NumberField label="Shelf life (months)" value={options.shelf_life_months} onChange={value => setOptions({ ...options, shelf_life_months: value })}/><Field label="Lot placeholder"><input className="input" value={options.lot_placeholder} onChange={event => setOptions({ ...options, lot_placeholder: event.target.value })}/></Field></div>
        <Field label="Storage instructions"><textarea className="input" rows={2} value={options.storage_instructions} onChange={event => setOptions({ ...options, storage_instructions: event.target.value })}/></Field>
        <div><span className="text-sm font-bold text-slate-700">Proposed claims</span><div className="mt-2 flex flex-wrap gap-2">{claimOptions.map(claim => <button key={claim} type="button" onClick={() => toggleClaim(claim)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${options.claims.includes(claim) ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-slate-300 text-slate-600 hover:border-slate-500'}`}>{options.claims.includes(claim) && <CheckCircle2 className="mr-1 inline h-3 w-3"/>}{claim}</button>)}</div></div>
        <button type="button" disabled={loading || !formulationId} onClick={() => void generate()} className="primary-button w-full justify-center"><Sparkles className="h-4 w-4"/>{loading ? 'Generating…' : 'Generate and save label draft'}</button>
      </section>
      <LabelPreview label={label} language={options.language}/>
    </div>}

    {tab === 'live' && <LiveLabel label={label} formulation={formulation} previewUrl={previewUrl} onCopy={() => void copyPreviewLink()} onPrint={() => window.print()} onDownload={downloadLabelData} onBuild={() => setTab('builder')}/>} 
    {tab === 'reports' && <Reports label={label} formulation={formulation} onBuild={() => setTab('builder')} onGemini={() => void askGemini()} aiLoading={aiLoading} insight={insight}/>} 

    {tab === 'builder' && label && <div className="flex flex-wrap gap-2"><button type="button" onClick={() => window.print()} className="secondary-button"><Printer className="h-4 w-4"/>Print / PDF</button><button type="button" onClick={downloadLabelData} className="secondary-button"><Download className="h-4 w-4"/>Download data</button><button type="button" disabled={aiLoading} onClick={() => void askGemini()} className="primary-button"><Bot className="h-4 w-4"/>{aiLoading ? 'Gemini reviewing…' : 'Review with Gemini'}</button></div>}
    {tab === 'builder' && insight && <Insight insight={insight}/>} 
  </div>;
}

function Recipes({ formulations, search, setSearch, onChoose }: { formulations: Formulation[]; search: string; setSearch: (value: string) => void; onChoose: (id: string) => void }) {
  return <section className="space-y-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="eyebrow">Recipes</p><h2 className="text-2xl font-black">Choose a formulation to label</h2></div><label className="relative w-full sm:max-w-md"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-500"/><span className="sr-only">Search recipes</span><input className="input pl-10" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search by name or code…"/></label></div>{formulations.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{formulations.map(item => <button type="button" key={item.id} onClick={() => onChoose(item.id)} className="group rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-sky-300 hover:shadow-md"><div className="flex items-start justify-between"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-700"><Package className="h-5 w-5"/></span><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase text-slate-600">{item.status}</span></div><h3 className="mt-5 text-lg font-black group-hover:text-sky-700">{item.name}</h3><p className="mt-1 text-xs font-semibold text-slate-500">{item.code} · {item.beverage_type.replace(/_/g, ' ')}</p><div className="mt-4 grid grid-cols-3 gap-2 text-xs"><Mini label="Cost/L" value={`${Number(item.total_cost_per_liter || 0).toFixed(1)}`}/><Mini label="kcal/100" value={`${Number(item.total_calories_per_100ml || 0).toFixed(1)}`}/><Mini label="Sugar" value={`${Number(item.total_sugar_per_100ml || 0).toFixed(1)}g`}/></div><span className="mt-5 inline-flex text-sm font-bold text-sky-700">Open in builder →</span></button>)}</div> : <Empty title="No matching formulation" detail="Create or import a formulation first."/>}</section>;
}

function LabelPreview({ label, language }: { label: any; language: string }) {
  if (!label) return <Empty title="Your label preview appears here" detail="Choose the formulation, market and pack details, then generate a traceable draft."/>;
  return <article id="label-preview" dir={language === 'ar' ? 'rtl' : 'ltr'} className="self-start rounded-2xl border-2 border-slate-950 bg-white p-6 text-slate-950 shadow-lg print:shadow-none"><div className="border-b-8 border-slate-950 pb-3"><p className="text-xs font-bold uppercase tracking-[.2em]">{label.market} · draft</p><h2 className="mt-1 text-3xl font-black">{label.name}</h2><p className="text-sm">Net {label.net_volume_ml} mL · {label.servings_per_container} serving(s)</p></div><div className="border-b-4 border-slate-950 py-3"><h3 className="text-xl font-black">Nutrition information</h3><Row label="Serving size" value={`${label.nutrition.per_serving.serving_size_ml} mL`}/><div className="flex justify-between border-b-4 border-slate-950 py-2"><strong>Energy / Calories</strong><strong>{label.nutrition.per_serving.calories}</strong></div><Row label="Sugars" value={`${label.nutrition.per_serving.sugar_g} g`}/>{label.nutrition.data_gaps.length > 0 && <div className="mt-3 flex gap-2 bg-amber-50 p-2 text-xs text-amber-950"><AlertTriangle className="h-4 w-4 shrink-0"/>Missing verified nutrient data: {label.nutrition.data_gaps.join(', ')}.</div>}</div><div className="space-y-3 py-4 text-sm"><p><strong>Ingredients:</strong> {label.ingredient_declaration}</p><p><strong>Allergens detected:</strong> {label.allergens.length ? label.allergens.join(', ') : 'None detected from ingredient names; verify supplier specifications.'}</p>{label.claims.length > 0 && <p><strong>Claims to substantiate:</strong> {label.claims.join(' · ')}</p>}<p>{label.storage_instructions}</p><p>{label.manufacturer.name}<br/>{label.manufacturer.address}<br/>Origin: {label.country_of_origin}</p><p className="font-mono">{label.lot}</p></div><p className="border-t pt-3 text-xs font-semibold text-rose-700">{label.notice}</p></article>;
}

function LiveLabel({ label, formulation, previewUrl, onCopy, onPrint, onDownload, onBuild }: any) {
  if (!label) return <Empty title="No live label yet" detail="Generate a saved label draft before creating its QR preview." action="Open Label Builder" onAction={onBuild}/>;
  return <section className="grid gap-6 lg:grid-cols-[22rem_1fr]"><div className="surface-card flex flex-col items-center text-center"><div className="rounded-2xl border border-slate-200 bg-white p-4"><QRCodeSVG value={previewUrl} size={220} level="M" title={`QR preview for ${formulation?.name || 'product'}`}/></div><span className="mt-4 inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">● WORKSPACE LIVE</span><h2 className="mt-3 text-xl font-black">{formulation?.name}</h2><p className="mt-2 break-all text-xs text-sky-700">{previewUrl}</p></div><div className="surface-card"><p className="eyebrow">Live Label</p><h2 className="mt-1 text-2xl font-black">Digital product preview</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">The QR points to the authenticated BeverageAI workspace preview. A public hosted URL requires deployment and an explicit publication workflow.</p><div className="mt-6 grid gap-3 sm:grid-cols-3"><button type="button" onClick={onCopy} className="secondary-button justify-center"><Clipboard className="h-4 w-4"/>Copy link</button><button type="button" onClick={onPrint} className="secondary-button justify-center"><Printer className="h-4 w-4"/>Print / PDF</button><button type="button" onClick={onDownload} className="primary-button justify-center"><Download className="h-4 w-4"/>Download data</button></div><div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><strong>Publication gate:</strong> this draft remains internal until legal review, missing nutrient values and proposed claims are validated.</div></div></section>;
}

function Reports({ label, formulation, onBuild, onGemini, aiLoading, insight }: any) {
  if (!label) return <Empty title="No label report available" detail="Generate a label draft to calculate readiness." action="Open Label Builder" onAction={onBuild}/>;
  const issues = label.nutrition.data_gaps.length + (label.claims?.length || 0) + Number(!label.manufacturer.name) + Number(!label.manufacturer.address);
  return <section className="space-y-5"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><ReportMetric label="Readiness" value={issues ? 'Review required' : 'Ready for review'} tone={issues ? 'amber' : 'green'}/><ReportMetric label="Nutrition gaps" value={label.nutrition.data_gaps.length}/><ReportMetric label="Detected allergens" value={label.allergens.length}/><ReportMetric label="Claims to validate" value={label.claims.length}/></div><div className="grid gap-6 lg:grid-cols-[1fr_22rem]"><div className="surface-card"><p className="eyebrow">Compliance report</p><h2 className="mt-1 text-xl font-black">{formulation?.name}</h2><div className="mt-5 divide-y divide-slate-100"><ReportRow title="Market" value={String(label.market).toUpperCase()}/><ReportRow title="Nutrition data" value={label.nutrition.data_gaps.length ? `Missing: ${label.nutrition.data_gaps.join(', ')}` : 'Complete for configured fields'}/><ReportRow title="Allergen screen" value={label.allergens.length ? label.allergens.join(', ') : 'No name-based match; supplier verification required'}/><ReportRow title="Claims" value={label.claims.length ? label.claims.join(', ') : 'No claims proposed'}/><ReportRow title="Operator" value={label.manufacturer.name || 'Missing'}/><ReportRow title="Status" value={label.status.replace(/_/g, ' ')}/></div></div><aside className="surface-card"><Bot className="h-8 w-8 text-violet-700"/><h2 className="mt-3 text-lg font-black">Gemini second pass</h2><p className="mt-2 text-sm leading-6 text-slate-600">Review only the saved formulation and label data; no legal approval is inferred.</p><button type="button" disabled={aiLoading} onClick={onGemini} className="primary-button mt-5 w-full justify-center">{aiLoading ? 'Reviewing…' : 'Review with Gemini'}</button></aside></div>{insight && <Insight insight={insight}/>}</section>;
}

function StudioTabButton({ active, icon: Icon, label, onClick }: { active: boolean; icon: typeof Package; label: string; onClick: () => void }) { return <button type="button" role="tab" aria-selected={active} onClick={onClick} className={`flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition ${active ? 'bg-sky-50 text-sky-700 ring-1 ring-sky-200' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'}`}><Icon className="h-4 w-4"/>{label}</button>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-sm font-bold text-slate-700"><span>{label}</span><div className="mt-1.5">{children}</div></label>; }
function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) { return <Field label={label}><input type="number" min="0" step="any" className="input" value={value} onChange={event => onChange(Number(event.target.value))}/></Field>; }
function Row({ label, value }: { label: string; value: string }) { return <div className="flex justify-between border-b py-2 text-sm"><strong>{label}</strong><span>{value}</span></div>; }
function Mini({ label, value }: { label: string; value: string }) { return <div className="rounded-lg bg-slate-50 p-2"><div className="font-bold text-slate-800">{value}</div><div className="text-[10px] font-semibold uppercase text-slate-600">{label}</div></div>; }
function Empty({ title, detail, action, onAction }: { title: string; detail: string; action?: string; onAction?: () => void }) { return <div className="surface-card flex min-h-[28rem] flex-col items-center justify-center text-center"><Languages className="h-12 w-12 text-slate-400"/><h2 className="mt-4 text-xl font-black text-slate-800">{title}</h2><p className="mt-2 max-w-md text-sm text-slate-600">{detail}</p>{action && <button type="button" onClick={onAction} className="primary-button mt-5">{action}</button>}</div>; }
function ReportMetric({ label, value, tone }: { label: string; value: string | number; tone?: 'amber' | 'green' }) { return <div className={`rounded-2xl border p-5 shadow-sm ${tone === 'amber' ? 'border-amber-200 bg-amber-50' : tone === 'green' ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'}`}><p className="text-[10px] font-bold uppercase tracking-wider text-slate-600">{label}</p><p className="mt-2 text-xl font-black text-slate-950">{value}</p></div>; }
function ReportRow({ title, value }: { title: string; value: string }) { return <div className="grid gap-1 py-3 sm:grid-cols-[12rem_1fr]"><strong className="text-sm text-slate-700">{title}</strong><span className="text-sm text-slate-600">{value}</span></div>; }
function Insight({ insight }: any) { return <div className="rounded-2xl border border-violet-200 bg-violet-50 p-5 text-sm text-violet-950"><div className="flex items-center gap-2 font-black"><Bot className="h-4 w-4"/>Gemini review</div><p className="mt-2 leading-6">{insight.summary}</p><ul className="mt-3 list-disc space-y-1 pl-5">{insight.recommendations.map((item: string) => <li key={item}>{item}</li>)}</ul>{insight.warnings.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-amber-950">{insight.warnings.map((item: string) => <li key={item}>{item}</li>)}</ul>}</div>; }
