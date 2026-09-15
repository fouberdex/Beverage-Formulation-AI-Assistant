import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { Home, Package, FlaskConical, Sparkles, Target, Shield, DollarSign, Menu, X, LogOut, UserRound, History, ClipboardCheck, BarChart3, FileBadge2, BookOpenCheck, ChevronLeft, ChevronRight, FolderKanban } from 'lucide-react';
import { useAuth } from './auth/AuthContext';
import AuthPage from './pages/AuthPage';
import { hasRole, WORKSPACE_ROLES, type UserRole } from './auth/permissions';
import ThemeSelector from './components/ThemeSelector';
import ErrorState from './components/ErrorState';
import { LoadingState } from './components/LoadingState';

// Lazy load pages to catch any import errors
const Dashboard = React.lazy(() => import('./pages/Dashboard'));
const IngredientsPage = React.lazy(() => import('./pages/IngredientsPage'));
const FormulationsPage = React.lazy(() => import('./pages/FormulationsPage'));
const CompatibilityPage = React.lazy(() => import('./pages/CompatibilityPage'));
const AIPage = React.lazy(() => import('./pages/AIPage'));
const TargetGenerationPage = React.lazy(() => import('./pages/TargetGenerationPage'));
const RegulatoryPage = React.lazy(() => import('./pages/RegulatoryPage'));
const CostPage = React.lazy(() => import('./pages/CostPage'));
const AccountPage = React.lazy(() => import('./pages/AccountPage'));
const HistoryPage = React.lazy(() => import('./pages/HistoryPage'));
const LaboratoryResultsPage = React.lazy(() => import('./pages/LaboratoryResultsPage'));
const SensoryPage = React.lazy(() => import('./pages/SensoryPage'));
const LabelsPage = React.lazy(() => import('./pages/LabelsPage'));
const RagWorkspacePage = React.lazy(() => import('./pages/RagWorkspacePage'));
const ProjectsPage = React.lazy(() => import('./pages/ProjectsPage'));

function LoadingFallback() {
  return <LoadingState label="Loading workspace…"/>;
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, details: React.ErrorInfo) { console.error('Unhandled application error', error, details); }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="flex min-h-screen items-center justify-center bg-app p-4">
      <div role="alert" className="surface-card max-w-lg border-rose-200">
        <h1 className="mb-2 text-xl font-black text-rose-700">Something went wrong</h1>
        <p className="text-slate-600">The page could not be displayed. Your data has not been changed.</p>
        <button type="button" onClick={() => this.setState({ error: null })}
          className="primary-button mt-4">Try again</button>
      </div>
    </div>;
  }
}

const navSections = [
  { label: 'Workspace', items: [
    { to: '/', icon: Home, label: 'Dashboard' },
    { to: '/projects', icon: FolderKanban, label: 'R&D Projects', roles: WORKSPACE_ROLES },
    { to: '/ingredients', icon: Package, label: 'Ingredients' },
    { to: '/formulations', icon: FlaskConical, label: 'Formulations' },
  ] },
  { label: 'Validate', items: [
    { to: '/laboratory-results', icon: ClipboardCheck, label: 'Lab Results', roles: WORKSPACE_ROLES },
    { to: '/sensory', icon: BarChart3, label: 'Sensory', roles: WORKSPACE_ROLES },
    { to: '/compatibility', icon: Shield, label: 'Compatibility' },
  ] },
  { label: 'Intelligence', items: [
    { to: '/ai', icon: Sparkles, label: 'AI Engine', roles: WORKSPACE_ROLES },
    { to: '/target-generation', icon: Target, label: 'Target Generation', roles: WORKSPACE_ROLES },
    { to: '/rag', icon: BookOpenCheck, label: 'RAG Evidence', roles: WORKSPACE_ROLES },
  ] },
  { label: 'Launch', items: [
    { to: '/regulatory', icon: Shield, label: 'Regulatory', roles: WORKSPACE_ROLES },
    { to: '/labels', icon: FileBadge2, label: 'Label Studio', roles: WORKSPACE_ROLES },
    { to: '/cost', icon: DollarSign, label: 'Cost & ROI', roles: WORKSPACE_ROLES },
  ] },
];

function Navigation({ collapsed, setCollapsed }: { collapsed: boolean; setCollapsed: (value: boolean) => void }) {
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const mobileTriggerRef = React.useRef<HTMLButtonElement>(null);
  const mobilePanelRef = React.useRef<HTMLDivElement>(null);
  const location = useLocation();
  const { profile, session, signOut } = useAuth();
  const visibleSections = navSections.map(section => ({ ...section, items: section.items.filter(item => hasRole(profile?.role, item.roles)) }));

  React.useEffect(() => setMobileMenuOpen(false), [location.pathname]);
  React.useEffect(() => {
    if (!mobileMenuOpen) return;
    const previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const focusable = () => Array.from(mobilePanelRef.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),select:not([disabled])') || []);
    window.requestAnimationFrame(() => focusable()[0]?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setMobileMenuOpen(false); mobileTriggerRef.current?.focus(); return; }
      if (event.key !== 'Tab') return; const items=focusable(); if(!items.length)return; const first=items[0];const last=items[items.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { document.body.style.overflow=previousOverflow; window.removeEventListener('keydown',onKeyDown); };
  }, [mobileMenuOpen]);

  const NavLink = ({ item, mobile = false }: { item: typeof visibleSections[number]['items'][number]; mobile?: boolean }) => {
    const Icon = item.icon;
    const isActive = item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to);
    return <Link key={item.to} to={item.to} title={collapsed ? item.label : undefined} onClick={() => mobile && setMobileMenuOpen(false)} aria-current={isActive ? 'page' : undefined}
      className={`group flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition ${isActive ? 'bg-sky-50 text-sky-700 ring-1 ring-sky-200' : 'text-slate-600 hover:bg-white hover:text-slate-950 hover:shadow-sm'} ${collapsed && !mobile ? 'justify-center' : ''}`}>
      <Icon aria-hidden="true" className={`h-[18px] w-[18px] shrink-0 ${isActive ? 'text-sky-600' : 'text-slate-400 group-hover:text-slate-700'}`}/>
      {(!collapsed || mobile) && <span>{item.label}</span>}
    </Link>;
  };

  return <>
    <aside className="sticky top-0 hidden h-screen flex-col border-r border-slate-200 bg-slate-50/95 lg:flex">
      <div className={`flex h-[72px] items-center border-b border-slate-200 ${collapsed ? 'justify-center px-2' : 'px-5'}`}>
        <Link to="/" className="flex items-center gap-3" title="BeverageAI DZ">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-500 shadow-sm shadow-sky-200"><FlaskConical className="h-5 w-5 text-white"/></span>
          {!collapsed && <span className="text-lg font-black tracking-tight text-slate-950">BeverageAI <span className="text-sky-700">DZ</span></span>}
        </Link>
      </div>
      <nav aria-label="Primary navigation" className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-5">
        {visibleSections.map(section => <section key={section.label}>
          {!collapsed && <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[.16em] text-slate-600">{section.label}</p>}
          <div className="space-y-1">{section.items.map(item => <NavLink key={item.to} item={item}/>)}</div>
        </section>)}
      </nav>
      <div className="border-t border-slate-200 p-3">
        {!collapsed && <div className="mb-2"><ThemeSelector/></div>}
        <Link to="/history" className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold text-slate-600 hover:bg-white ${collapsed ? 'justify-center' : ''}`} title={collapsed ? 'History' : undefined}><History className="h-[18px] w-[18px] text-slate-400"/>{!collapsed && 'History'}</Link>
        <Link to="/account" className={`mt-1 flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold text-slate-600 hover:bg-white ${collapsed ? 'justify-center' : ''}`} title={collapsed ? 'Account' : undefined}><UserRound className="h-[18px] w-[18px] text-slate-500"/>{!collapsed && <span className="min-w-0"><span className="block">Account</span><span className="block max-w-40 truncate text-[10px] font-normal text-slate-600">{session?.user.email}</span></span>}</Link>
        <div className={`mt-2 flex gap-1 ${collapsed ? 'flex-col' : ''}`}>
          <button type="button" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} className="flex min-h-10 flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-500 hover:border-sky-200 hover:text-sky-700">{collapsed ? <ChevronRight className="h-4 w-4"/> : <><ChevronLeft className="h-4 w-4"/>Collapse</>}</button>
          <button type="button" onClick={() => void signOut()} aria-label="Sign out" title="Sign out" className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-400 hover:border-rose-200 hover:text-rose-600"><LogOut className="h-4 w-4"/></button>
        </div>
      </div>
    </aside>

    <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur lg:hidden">
      <div className="flex items-center justify-between gap-3"><Link to="/" className="flex min-w-0 items-center gap-2 font-black"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-700"><FlaskConical className="h-5 w-5 text-white"/></span><span className="truncate">BeverageAI <span className="text-sky-700">DZ</span></span></Link><div className="flex items-center gap-2"><ThemeSelector compact/><button ref={mobileTriggerRef} type="button" aria-label={mobileMenuOpen?'Close navigation':'Open navigation'} onClick={() => setMobileMenuOpen(!mobileMenuOpen)} aria-expanded={mobileMenuOpen} aria-controls="mobile-navigation" className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600">{mobileMenuOpen ? <X className="h-5 w-5"/> : <Menu className="h-5 w-5"/>}</button></div></div>
    </header>
    {mobileMenuOpen&&<div className="fixed inset-0 z-[70] lg:hidden"><button type="button" aria-label="Close navigation" className="absolute inset-0 rounded-none bg-slate-950/45" onClick={()=>{setMobileMenuOpen(false);mobileTriggerRef.current?.focus();}}/><div ref={mobilePanelRef} role="dialog" aria-modal="true" aria-label="Application navigation" className="absolute inset-y-0 left-0 w-[min(88vw,22rem)] overflow-y-auto border-r border-slate-200 bg-white p-4 shadow-xl"><div className="mb-5 flex items-center justify-between"><strong className="text-lg text-slate-950">BeverageAI DZ</strong><button type="button" aria-label="Close navigation" className="secondary-button !p-2" onClick={()=>{setMobileMenuOpen(false);mobileTriggerRef.current?.focus();}}><X className="h-5 w-5"/></button></div><nav id="mobile-navigation" aria-label="Mobile navigation" className="space-y-4">{visibleSections.map(section => <section key={section.label}><p className="mb-1 px-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">{section.label}</p>{section.items.map(item => <NavLink key={item.to} item={item} mobile/>)}</section>)}<div className="space-y-2 border-t pt-4"><ThemeSelector/><div className="grid grid-cols-2 gap-2"><Link to="/account" onClick={() => setMobileMenuOpen(false)} className="secondary-button justify-center"><UserRound className="h-4 w-4"/>Account</Link><button onClick={() => void signOut()} className="secondary-button justify-center"><LogOut className="h-4 w-4"/>Sign out</button></div></div></nav></div></div>}
  </>;
}

function WorkspaceHeader(){const location=useLocation();const item=navSections.flatMap(section=>section.items).find(entry=>entry.to==='/'?location.pathname==='/':location.pathname.startsWith(entry.to));return <header className="sticky top-0 z-40 hidden h-[60px] items-center justify-between border-b border-slate-200 bg-white/90 px-7 backdrop-blur lg:flex"><div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-slate-600">Industrial R&amp;D workspace</p><p className="text-sm font-black text-slate-900">{item?.label||'Workspace'}</p></div><ThemeSelector/></header>}

function RouteFocus() {
  const location = useLocation();
  React.useEffect(() => { document.getElementById('main-content')?.focus(); }, [location.pathname]);
  return null;
}

function RoleRoute({ roles, children }: { roles: readonly UserRole[]; children: React.ReactNode }) {
  const { profile } = useAuth();
  if (hasRole(profile?.role, roles)) return <>{children}</>;
  return <ErrorState kind="403" title="Access restricted" description={`Your ${profile?.role ?? 'current'} role cannot open this workspace.`}/>;
}

function App() {
  const { session, loading } = useAuth();
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);

  if (loading) return <LoadingFallback />;
  if (!session) return <AuthPage />;

  return (
    <ErrorBoundary>
      <Router>
        <div className={`min-h-screen bg-app lg:grid ${sidebarCollapsed ? 'lg:grid-cols-[5rem_minmax(0,1fr)]' : 'lg:grid-cols-[17rem_minmax(0,1fr)]'}`}>
          <a href="#main-content" className="skip-link">Skip to main content</a>
          <Navigation collapsed={sidebarCollapsed} setCollapsed={setSidebarCollapsed}/>
          <div className="min-w-0"><RouteFocus /><WorkspaceHeader/>
          <main id="main-content" tabIndex={-1} className="mx-auto max-w-[100rem] px-4 py-6 outline-none sm:px-7 lg:px-10 lg:py-8">
            <React.Suspense fallback={<LoadingFallback />}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/ingredients" element={<IngredientsPage />} />
                <Route path="/projects" element={<RoleRoute roles={WORKSPACE_ROLES}><ProjectsPage /></RoleRoute>} />
                <Route path="/formulations" element={<FormulationsPage />} />
                <Route path="/laboratory-results" element={<RoleRoute roles={WORKSPACE_ROLES}><LaboratoryResultsPage /></RoleRoute>} />
                <Route path="/sensory" element={<RoleRoute roles={WORKSPACE_ROLES}><SensoryPage /></RoleRoute>} />
                <Route path="/compatibility" element={<CompatibilityPage />} />
                <Route path="/ai" element={<RoleRoute roles={WORKSPACE_ROLES}><AIPage /></RoleRoute>} />
                <Route path="/target-generation" element={<RoleRoute roles={WORKSPACE_ROLES}><TargetGenerationPage /></RoleRoute>} />
                <Route path="/regulatory" element={<RoleRoute roles={WORKSPACE_ROLES}><RegulatoryPage /></RoleRoute>} />
                <Route path="/labels" element={<RoleRoute roles={WORKSPACE_ROLES}><LabelsPage /></RoleRoute>} />
                <Route path="/cost" element={<RoleRoute roles={WORKSPACE_ROLES}><CostPage /></RoleRoute>} />
                <Route path="/rag" element={<RoleRoute roles={WORKSPACE_ROLES}><RagWorkspacePage /></RoleRoute>} />
                <Route path="/history" element={<HistoryPage />} />
                <Route path="/account" element={<AccountPage />} />
                <Route path="*" element={<ErrorState kind="404" title="Page not found" description="This workspace route does not exist or is no longer available."/>} />
              </Routes>
            </React.Suspense>
          </main></div>
        </div>
      </Router>
    </ErrorBoundary>
  );
}

export default App;
