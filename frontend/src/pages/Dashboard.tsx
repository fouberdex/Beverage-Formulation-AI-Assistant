import { useEffect, useMemo, useState } from 'react';
import { ingredientsAPI, formulationsAPI } from '../services/api';
import { ArrowRight, BarChart3, Check, ClipboardCheck, FileBadge2, FileSpreadsheet, FlaskConical, Package, Plus, Sparkles, TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { canManageFormulations, canManageIngredients } from '../auth/permissions';
import StatusMessage from '../components/StatusMessage';
import { getErrorMessage } from '../services/errors';

export default function Dashboard() {
  const { profile } = useAuth();
  const canFormulate = canManageFormulations(profile?.role);
  const canAdministerIngredients = canManageIngredients(profile?.role);
  const [error, setError] = useState('');
  const [stats, setStats] = useState({ ingredients: 0, formulations: 0, categories: 0, loading: true });

  useEffect(() => {
    void (async () => {
      try {
        const [ingredientsRes, formulationsRes, categoriesRes] = await Promise.all([
          ingredientsAPI.getStats(), formulationsAPI.getAll({ limit: 1 }), ingredientsAPI.getCategories(),
        ]);
        setStats({ ingredients: ingredientsRes.data.data.total_ingredients, formulations: formulationsRes.data.pagination.total, categories: categoriesRes.data.data.length, loading: false });
      } catch (reason) {
        setError(getErrorMessage(reason, 'Unable to load dashboard totals.'));
        setStats(current => ({ ...current, loading: false }));
      }
    })();
  }, []);

  const firstName = useMemo(() => profile?.display_name?.trim().split(/\s+/)[0] || 'Formulator', [profile?.display_name]);
  const completedSteps = Number(stats.formulations > 0) + Number(stats.ingredients > 0);

  return <div className="space-y-8 pb-12">
    <header className="flex flex-col gap-5 border-b border-slate-200 pb-6 sm:flex-row sm:items-center sm:justify-between">
      <div><p className="eyebrow">R&D workspace</p><h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950">Good to see you, {firstName}</h1><p className="mt-1 text-sm text-slate-600">Move from formulation to evidence, economics and launch readiness.</p></div>
      {canFormulate && <div className="flex flex-wrap gap-2"><Link to="/ai" className="secondary-button"><Sparkles className="h-4 w-4"/>Fill with AI</Link><Link to="/formulations" className="secondary-button"><FileSpreadsheet className="h-4 w-4"/>Import from Excel</Link><Link to="/formulations" className="primary-button"><Plus className="h-4 w-4"/>New formulation</Link></div>}
    </header>
    <StatusMessage error={error}/>

    <section className="overflow-hidden rounded-2xl border border-sky-200 bg-sky-50/70 p-6 shadow-sm sm:p-8">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between"><div><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-700 text-white"><Sparkles className="h-5 w-5"/></span><div><p className="eyebrow">Getting started</p><h2 className="text-xl font-black text-slate-950">Build a decision-ready beverage project</h2></div></div><p className="mt-3 text-sm text-slate-600">{completedSteps} of 4 foundations ready — continue exactly where your product workflow needs attention.</p></div><Link to="/formulations" className="primary-button shrink-0">Open formulations <ArrowRight className="h-4 w-4"/></Link></div>
      <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-white"><div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: `${Math.max(15, completedSteps * 25)}%` }}/></div>
      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <ProgressStep done={stats.formulations > 0} title="Create a formulation" detail="Ingredients, quantities and product targets" href="/formulations"/>
        <ProgressStep done={stats.ingredients > 0} title="Validate inputs" detail="Ingredient specs and compatibility" href="/ingredients"/>
        <ProgressStep title="Capture evidence" detail="Lab and sensory results" href="/laboratory-results"/>
        <ProgressStep title="Prepare launch" detail="Cost, compliance and label" href="/labels"/>
      </div>
    </section>

    <section><div className="mb-4"><p className="eyebrow">Fast paths</p><h2 className="mt-1 text-2xl font-black text-slate-950">Get started</h2></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {canFormulate && <ActionCard tone="teal" icon={FlaskConical} title="Create a formulation" description="Start from scratch or refine an existing beverage recipe." button="New formulation" href="/formulations"/>}
      {canAdministerIngredients && <ActionCard tone="blue" icon={Package} title="Build ingredient data" description="Create and manage custom ingredient, nutrition and cost records." button="Add ingredient" href="/ingredients"/>}
      {canFormulate && <ActionCard tone="violet" icon={ClipboardCheck} title="Capture product evidence" description="Store laboratory measurements and run sensory studies." button="Open validation" href="/laboratory-results"/>}
      {canFormulate && <ActionCard tone="orange" icon={FileBadge2} title="Prepare the label" description="Generate a market-specific draft and review missing evidence." button="Open Label Studio" href="/labels"/>}
    </div></section>

    <section className="grid gap-4 sm:grid-cols-3">
      <StatCard title="Ingredients" value={stats.loading ? '—' : stats.ingredients.toLocaleString()} detail="active database records" icon={Package}/>
      <StatCard title="Formulations" value={stats.loading ? '—' : stats.formulations.toLocaleString()} detail="saved product recipes" icon={FlaskConical}/>
      <StatCard title="Categories" value={stats.loading ? '—' : String(stats.categories)} detail="ingredient families" icon={TrendingUp}/>
    </section>

    <section className="surface-card"><div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between"><div><p className="eyebrow">Connected workflow</p><h2 className="mt-1 text-xl font-black">One product record, every R&D decision</h2><p className="mt-1 max-w-3xl text-sm text-slate-600">Laboratory, sensory, cost, regulatory and Gemini insights remain attached to your authenticated workspace instead of disappearing between sessions.</p></div><Link to="/history" className="secondary-button shrink-0"><BarChart3 className="h-4 w-4"/>View activity</Link></div></section>
  </div>;
}

function ProgressStep({ done = false, title, detail, href }: { done?: boolean; title: string; detail: string; href: string }) {
  return <Link to={href} className="group flex min-h-24 gap-3 rounded-xl border border-sky-100 bg-white p-4 shadow-sm transition hover:border-sky-300 hover:shadow-md"><span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${done ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-sky-700 text-sky-700'}`}>{done ? <Check className="h-3.5 w-3.5"/> : <span className="h-2 w-2 rounded-full bg-current"/>}</span><span><strong className="block text-sm text-slate-800 group-hover:text-sky-700">{title}</strong><span className="mt-1 block text-xs leading-5 text-slate-600">{detail}</span></span></Link>;
}

const tones = { teal: 'bg-teal-700', blue: 'bg-sky-700', violet: 'bg-violet-700', orange: 'bg-orange-700' } as const;
function ActionCard({ tone, icon: Icon, title, description, button, href }: { tone: keyof typeof tones; icon: typeof Package; title: string; description: string; button: string; href: string }) {
  return <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className={`${tones[tone]} flex h-28 items-center justify-between px-6 text-white`}><h3 className="max-w-[11rem] text-xl font-black leading-tight">{title}</h3><Icon className="h-12 w-12 opacity-80"/></div><div className="flex min-h-44 flex-col p-5"><p className="text-sm leading-6 text-slate-600">{description}</p><Link to={href} className="primary-button mt-auto w-fit">{button}<ArrowRight className="h-4 w-4"/></Link></div></article>;
}

function StatCard({ title, value, detail, icon: Icon }: { title: string; value: string; detail: string; icon: typeof Package }) {
  return <div className="surface-card flex items-center gap-4"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-50 text-sky-700"><Icon className="h-5 w-5"/></span><div><div className="text-2xl font-black text-slate-950">{value}</div><div className="text-sm font-bold text-slate-700">{title}</div><div className="text-xs text-slate-600">{detail}</div></div></div>;
}
