import { useEffect, useMemo, useState } from 'react';
import { Bot, Calculator, Factory, Landmark, Package, RefreshCw, Sparkles, TrendingUp, Truck } from 'lucide-react';
import { aiAPI, costAPI, formulationsAPI } from '../services/api';
import type { Formulation } from '../types';
import { getErrorMessage } from '../services/errors';
import StatusMessage from '../components/StatusMessage';

const defaults = {
  batch_size_liters: 1000, package_volume_ml: 330, units_per_case: 24, process_loss_percent: 2,
  ingredient_waste_percent: 1, packaging_cost_per_unit: 18, secondary_packaging_per_unit: 3,
  labor_hours: 16, labor_rate_per_hour: 450, utilities_per_liter: 2.5, quality_cost_per_batch: 3500,
  sanitation_cost_per_batch: 2500, logistics_per_batch: 10000, warehousing_per_batch: 3000,
  fixed_overhead_per_batch: 6000, depreciation_per_batch: 3000, financing_cost_per_batch: 0,
  marketing_per_batch: 5000, sales_commission_percent: 3, distributor_margin_percent: 12,
  retailer_margin_percent: 18, tax_percent: 19, target_margin_percent: 30, selling_price_per_unit: 90,
  capex: 500000, working_capital: 250000, planned_batches_per_year: 48,
};
type CostInputs = typeof defaults;

export default function CostPage() {
  const [formulations, setFormulations] = useState<Formulation[]>([]);
  const [formulationId, setFormulationId] = useState('');
  const [inputs, setInputs] = useState<CostInputs>({ ...defaults });
  const [result, setResult] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [insight, setInsight] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => { void (async () => { try { const response = await formulationsAPI.getAll({ limit: 100 }); setFormulations(response.data.data); setFormulationId(response.data.data[0]?.id || ''); } catch (reason) { setError(getErrorMessage(reason)); } })(); }, []);
  useEffect(() => { if (formulationId) void loadHistory(); }, [formulationId]);
  async function loadHistory() { try { setHistory((await costAPI.getBatchCosts(formulationId, { limit: 8 })).data.data); } catch { setHistory([]); } }
  async function calculate() { if (!formulationId) return; setLoading(true); setError(''); setMessage(''); setInsight(null); try { setResult((await costAPI.calculateBatchCost(formulationId, inputs)).data.data); await loadHistory(); setMessage('Industrial cost scenario calculated and saved.'); } catch (reason) { setError(getErrorMessage(reason, 'Unable to calculate this scenario.')); } finally { setLoading(false); } }
  async function askGemini() { if (!result) return; setAiLoading(true); setError(''); try { setInsight((await aiAPI.getInsight('cost', { formulation: formulations.find(item => item.id === formulationId), scenario: result })).data.data); } catch (reason) { setError(getErrorMessage(reason, 'Gemini analysis is unavailable. Enable external AI processing in Account.')); } finally { setAiLoading(false); } }
  function resetAssumptions() {
    setInputs({ ...defaults });
    setResult(null);
    setInsight(null);
    setError('');
    setMessage('Assumptions restored to the BeverageAI baseline. Recalculate to save a new scenario.');
  }
  const set = (key: keyof CostInputs, value: number) => setInputs(current => ({ ...current, [key]: value }));
  const formulation = formulations.find(item => item.id === formulationId);
  const sensitivity = useMemo(() => {
    if (!result) return [];
    const base = result.unit_economics.cost_per_unit;
    const ingredientShare = result.breakdown.ingredient_cost / result.breakdown.manufacturing_cost;
    const packagingShare = result.breakdown.packaging_cost / result.breakdown.manufacturing_cost;
    return [{ name: 'Ingredients +10%', value: base * (1 + ingredientShare * .1) }, { name: 'Packaging +10%', value: base * (1 + packagingShare * .1) }, { name: 'Yield −3 pts', value: base * (result.production.yield_percent / Math.max(1, result.production.yield_percent - 3)) }, { name: 'Base scenario', value: base }].sort((a, b) => b.value - a.value);
  }, [result]);

  return <div className="space-y-6 pb-12">
    <header className="hero-panel"><div><span className="hero-kicker"><TrendingUp className="h-4 w-4"/> Industrial economics</span><h1>Cost, Price & ROI</h1><p>Model true landed manufacturing cost, channel economics, investment payback and sensitivity — not just ingredients plus a percentage.</p></div><div className="hidden gap-2 lg:flex"><HeroIcon icon={Factory}/><HeroIcon icon={Truck}/><HeroIcon icon={Landmark}/></div></header>
    <StatusMessage error={error} message={message}/>
    <section className="surface-card"><label className="text-sm font-semibold text-slate-700">Formulation<select className="input mt-2" value={formulationId} onChange={event => { setFormulationId(event.target.value); setResult(null); }}><option value="">Choose a formulation</option>{formulations.map(item => <option key={item.id} value={item.id}>{item.name} · ingredients {(item.total_cost_per_liter || 0).toFixed(2)} DZD/L</option>)}</select></label>{formulation && <div className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-4"><Metric label="Ingredient basis" value={money(formulation.total_cost_per_liter) + '/L'}/><Metric label="Batch" value={`${inputs.batch_size_liters.toLocaleString()} L`}/><Metric label="Pack" value={`${inputs.package_volume_ml} mL`}/><Metric label="Annual batches" value={inputs.planned_batches_per_year}/></div>}</section>
    <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
      <div className="space-y-5"><InputSection icon={Factory} title="Production & yield" description="Model saleable output after line loss and raw-material waste."><div className="field-grid"><N label="Input batch (L)" k="batch_size_liters"/><N label="Pack size (mL)" k="package_volume_ml"/><N label="Units / case" k="units_per_case"/><N label="Process loss (%)" k="process_loss_percent"/><N label="Ingredient waste (%)" k="ingredient_waste_percent"/></div></InputSection>
        <InputSection icon={Package} title="Packaging & conversion" description="Primary/secondary pack, operators, energy, cleaning and release testing."><div className="field-grid"><N label="Primary pack / unit" k="packaging_cost_per_unit"/><N label="Secondary pack / unit" k="secondary_packaging_per_unit"/><N label="Labor hours" k="labor_hours"/><N label="Labor rate / hour" k="labor_rate_per_hour"/><N label="Utilities / input L" k="utilities_per_liter"/><N label="Quality / batch" k="quality_cost_per_batch"/><N label="Sanitation / batch" k="sanitation_cost_per_batch"/><N label="Depreciation / batch" k="depreciation_per_batch"/></div></InputSection>
        <InputSection icon={Truck} title="Supply chain & commercial" description="Include costs outside the factory gate and margins between you and the shelf."><div className="field-grid"><N label="Logistics / batch" k="logistics_per_batch"/><N label="Warehousing / batch" k="warehousing_per_batch"/><N label="Fixed overhead / batch" k="fixed_overhead_per_batch"/><N label="Marketing / batch" k="marketing_per_batch"/><N label="Financing / batch" k="financing_cost_per_batch"/><N label="Sales commission (%)" k="sales_commission_percent"/><N label="Distributor margin (%)" k="distributor_margin_percent"/><N label="Retailer margin (%)" k="retailer_margin_percent"/><N label="Tax / VAT (%)" k="tax_percent"/><N label="Target manufacturer margin (%)" k="target_margin_percent"/><N label="Actual selling price / unit" k="selling_price_per_unit"/></div></InputSection>
        <InputSection icon={Landmark} title="Investment & scale" description="Connect batch contribution to launch capital and operating cadence."><div className="field-grid"><N label="CAPEX" k="capex"/><N label="Working capital" k="working_capital"/><N label="Planned batches / year" k="planned_batches_per_year"/></div></InputSection>
      </div>
      <aside className="space-y-4 xl:sticky xl:top-8 xl:self-start"><div className="surface-card"><p className="eyebrow">Scenario readiness</p><h2 className="text-lg font-bold">Model controls</h2><div className="mt-4 space-y-2 text-sm"><Check label="Yield and waste included"/><Check label="Packaging included"/><Check label="Conversion costs included"/><Check label="Channel margins included"/><Check label="Investment included"/></div><button type="button" onClick={() => void calculate()} disabled={!formulationId || loading} className="primary-button mt-5 w-full justify-center"><Calculator className="h-4 w-4"/>{loading ? 'Calculating…' : 'Calculate & save'}</button><button type="button" data-testid="reset-cost-assumptions" onClick={resetAssumptions} className="secondary-button mt-2 w-full justify-center"><RefreshCw className="h-4 w-4"/>Reset assumptions</button></div>{history.length > 0 && <div className="surface-card"><p className="eyebrow">Database</p><h2 className="font-bold">Saved scenarios</h2><div className="mt-3 space-y-2">{history.slice(0, 5).map(item => <button type="button" key={item.id} onClick={() => { setResult(item); if (item.assumptions) setInputs({ ...defaults, ...item.assumptions }); }} className="w-full rounded-lg border p-3 text-left text-xs hover:border-sky-300"><strong>{Number(item.batch_size_liters).toLocaleString()} L</strong><span className="float-right text-slate-400">{new Date(item.calculated_at).toLocaleDateString()}</span><div className="mt-1 text-slate-500">{money(item.unit_economics?.cost_per_unit || item.per_liter?.total_cost)} / unit</div></button>)}</div></div>}</aside>
    </div>
    {result && <section className="space-y-5"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><ResultMetric label="Saleable units" value={result.production.saleable_units.toLocaleString()}/><ResultMetric label="True cost / unit" value={money(result.unit_economics.cost_per_unit)}/><ResultMetric label="Target ex-factory" value={money(result.unit_economics.target_ex_factory_price)}/><ResultMetric label="Suggested retail" value={money(result.unit_economics.suggested_retail_price)}/><ResultMetric label="Gross margin" value={`${result.unit_economics.gross_margin_percent.toFixed(1)}%`} tone={result.unit_economics.gross_margin_percent >= 0 ? 'green' : 'red'}/></div>
      <div className="grid gap-6 xl:grid-cols-2"><div className="surface-card"><h2 className="text-lg font-bold">Batch cost bridge</h2><div className="mt-4 divide-y">{Object.entries(result.breakdown).filter(([key]) => key.endsWith('_cost') || ['fixed_overhead', 'depreciation'].includes(key)).map(([key, value]) => <div key={key} className="flex justify-between py-2 text-sm"><span className="capitalize text-slate-600">{key.replace(/_/g, ' ')}</span><strong>{money(Number(value))}</strong></div>)}</div><div className="mt-3 flex justify-between border-t-4 border-slate-900 pt-3 text-lg"><strong>Manufacturing cost</strong><strong>{money(result.breakdown.manufacturing_cost)}</strong></div></div><div className="surface-card"><h2 className="text-lg font-bold">Investment case</h2><div className="mt-4 grid grid-cols-2 gap-3"><Metric label="Annual contribution" value={money(result.investment.annual_contribution)}/><Metric label="Annual ROI" value={result.investment.annual_roi_percent === null ? 'N/A' : `${result.investment.annual_roi_percent.toFixed(1)}%`}/><Metric label="Payback" value={result.investment.payback_months === null ? 'N/A' : `${result.investment.payback_months.toFixed(1)} months`}/><Metric label="Break-even volume" value={result.investment.break_even_units === null ? 'N/A' : `${result.investment.break_even_units.toLocaleString()} units`}/></div><button onClick={() => void askGemini()} disabled={aiLoading} className="primary-button mt-5"><Bot className="h-4 w-4"/>{aiLoading ? 'Gemini analyzing…' : 'Ask Gemini for trade-offs'}</button></div></div>
      <div className="surface-card"><h2 className="text-lg font-bold">Deterministic sensitivity screen</h2><p className="mt-1 text-sm text-slate-500">One-factor shocks highlight the assumptions with the strongest unit-cost exposure.</p><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{sensitivity.map(item => <div key={item.name} className="rounded-xl bg-slate-50 p-4"><div className="text-xs font-semibold text-slate-500">{item.name}</div><div className="mt-2 text-xl font-bold">{money(item.value)}</div><div className="mt-1 text-xs text-slate-400">per unit</div></div>)}</div></div>
      {insight && <div className="rounded-xl border border-violet-200 bg-violet-50 p-5 text-sm text-violet-950"><div className="flex items-center gap-2 font-bold"><Sparkles className="h-4 w-4"/> Gemini decision support</div><p className="mt-2 leading-6">{insight.summary}</p><ul className="mt-3 list-disc space-y-1 pl-5">{insight.recommendations.map((item: string) => <li key={item}>{item}</li>)}</ul>{insight.warnings.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-amber-900">{insight.warnings.map((item: string) => <li key={item}>{item}</li>)}</ul>}</div>}
    </section>}
  </div>;

  function N({ label, k }: { label: string; k: keyof CostInputs }) { return <label className="text-sm font-medium text-slate-700">{label}<input type="number" min="0" step="any" value={inputs[k]} onChange={event => set(k, Number(event.target.value))} className="input mt-1.5"/></label>; }
}

const money = (value: number) => `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} DZD`;
function HeroIcon({ icon: Icon }: { icon: typeof Factory }) { return <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/15 bg-white/10"><Icon className="h-6 w-6 text-cyan-100"/></span>; }
function InputSection({ icon: Icon, title, description, children }: { icon: typeof Factory; title: string; description: string; children: React.ReactNode }) { return <section className="surface-card"><div className="mb-5 flex gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-100 text-sky-800"><Icon className="h-5 w-5"/></span><div><h2 className="font-bold text-slate-950">{title}</h2><p className="text-xs text-slate-500">{description}</p></div></div>{children}</section>; }
function Check({ label }: { label: string }) { return <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-500"/>{label}</div>; }
function Metric({ label, value }: { label: string; value: string | number }) { return <div className="rounded-lg bg-slate-50 p-3"><div className="text-[10px] font-bold uppercase tracking-wider text-slate-600">{label}</div><div className="mt-1 font-semibold text-slate-800">{value}</div></div>; }
function ResultMetric({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'red' }) { return <div className={`rounded-xl border p-5 shadow-sm ${tone === 'green' ? 'border-emerald-200 bg-emerald-50' : tone === 'red' ? 'border-rose-200 bg-rose-50' : 'border-slate-200 bg-white'}`}><div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div><div className="mt-2 text-2xl font-black text-slate-950">{value}</div></div>; }
