import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { Home, Package, FlaskConical, Sparkles, Target, Shield, DollarSign, Menu, X, LogOut, UserRound, History, ClipboardCheck } from 'lucide-react';
import { useAuth } from './auth/AuthContext';
import AuthPage from './pages/AuthPage';
import { hasRole, WORKSPACE_ROLES, type UserRole } from './auth/permissions';

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

function LoadingFallback() {
  return (
    <div role="status" aria-live="polite" className="flex items-center justify-center min-h-screen">
      <div className="text-lg text-gray-600">Loading...</div>
    </div>
  );
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, details: React.ErrorInfo) { console.error('Unhandled application error', error, details); }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="min-h-screen bg-red-50 flex items-center justify-center p-4">
      <div role="alert" className="bg-white p-6 rounded-lg shadow-lg max-w-lg">
        <h1 className="text-xl font-bold text-red-700 mb-2">Something went wrong</h1>
        <p className="text-gray-600">The page could not be displayed. Your data has not been changed.</p>
        <button type="button" onClick={() => this.setState({ error: null })}
          className="mt-4 rounded-md bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800">Try again</button>
      </div>
    </div>;
  }
}

const navItems = [
  { to: '/', icon: Home, label: 'Dashboard' },
  { to: '/ingredients', icon: Package, label: 'Ingredients' },
  { to: '/formulations', icon: FlaskConical, label: 'Formulations' },
  { to: '/laboratory-results', icon: ClipboardCheck, label: 'Lab Results', roles: WORKSPACE_ROLES },
  { to: '/compatibility', icon: Shield, label: 'Compatibility' },
  { to: '/ai', icon: Sparkles, label: 'AI Engine', roles: WORKSPACE_ROLES },
  { to: '/target-generation', icon: Target, label: 'Target Gen', roles: WORKSPACE_ROLES },
  { to: '/regulatory', icon: Shield, label: 'Regulatory', roles: WORKSPACE_ROLES },
  { to: '/cost', icon: DollarSign, label: 'Cost & ROI', roles: WORKSPACE_ROLES },
  { to: '/history', icon: History, label: 'History' },
  { to: '/account', icon: UserRound, label: 'Account' },
];

function Navigation() {
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const location = useLocation();
  const { profile, session, signOut } = useAuth();
  const visibleItems = navItems.filter(item => hasRole(profile?.role, item.roles));

  React.useEffect(() => setMobileMenuOpen(false), [location.pathname]);
  React.useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMobileMenuOpen(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);

  return (
    <nav aria-label="Primary navigation" className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex justify-between h-14">
          <div className="flex items-center">
            <Link to="/" className="flex items-center">
              <FlaskConical aria-hidden="true" className="h-7 w-7 text-sky-600" />
              <span className="ml-2 text-lg font-bold text-gray-900">BeverageAI DZ</span>
            </Link>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden lg:flex lg:items-center lg:space-x-1">
            {visibleItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.to;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  aria-current={isActive ? 'page' : undefined}
                  className={`inline-flex items-center px-2 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    isActive
                      ? 'bg-sky-50 text-sky-700'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }`}
                >
                  <Icon aria-hidden="true" className="h-3.5 w-3.5 mr-1" />
                  {item.label}
                </Link>
              );
            })}
            <span className="ml-2 max-w-36 truncate border-l pl-3 text-xs text-gray-500" title={session?.user.email}>
              {session?.user.email}
            </span>
            <button type="button" onClick={() => void signOut()} aria-label="Sign out"
              className="ml-1 rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-800">
              <LogOut aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>

          {/* Mobile menu button */}
          <div className="lg:hidden flex items-center">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-navigation"
              aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
              className="p-2 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100"
            >
              {mobileMenuOpen ? <X aria-hidden="true" className="h-5 w-5" /> : <Menu aria-hidden="true" className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Navigation */}
        {mobileMenuOpen && (
          <div id="mobile-navigation" className="lg:hidden py-2 border-t">
            <div className="grid grid-cols-2 gap-2">
              {visibleItems.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.to;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setMobileMenuOpen(false)}
                    aria-current={isActive ? 'page' : undefined}
                    className={`flex items-center px-3 py-2 text-sm font-medium rounded-md ${
                      isActive
                        ? 'bg-sky-50 text-sky-700'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                    }`}
                  >
                    <Icon aria-hidden="true" className="h-4 w-4 mr-2" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
            <button type="button" onClick={() => void signOut()}
              className="mt-2 flex w-full items-center rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
              <LogOut aria-hidden="true" className="mr-2 h-4 w-4" /> Sign out
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}

function RouteFocus() {
  const location = useLocation();
  React.useEffect(() => { document.getElementById('main-content')?.focus(); }, [location.pathname]);
  return null;
}

function RoleRoute({ roles, children }: { roles: readonly UserRole[]; children: React.ReactNode }) {
  const { profile } = useAuth();
  if (hasRole(profile?.role, roles)) return <>{children}</>;
  return <section role="alert" className="mx-auto mt-12 max-w-xl rounded-lg border border-amber-200 bg-amber-50 p-6">
    <h1 className="text-2xl font-bold text-gray-900">Access restricted</h1>
    <p className="mt-2 text-gray-700">Your {profile?.role ?? 'current'} role cannot open this workspace.</p>
    <Link to="/" className="mt-4 inline-block font-medium text-sky-700 underline">Return to dashboard</Link>
  </section>;
}

function App() {
  const { session, loading } = useAuth();

  if (loading) return <LoadingFallback />;
  if (!session) return <AuthPage />;

  return (
    <ErrorBoundary>
      <Router>
        <div className="min-h-screen bg-gray-50">
          <a href="#main-content" className="skip-link">Skip to main content</a>
          <Navigation />
          <RouteFocus />

          {/* Main Content */}
          <main id="main-content" tabIndex={-1} className="max-w-7xl mx-auto py-4 px-4 outline-none">
            <React.Suspense fallback={<LoadingFallback />}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/ingredients" element={<IngredientsPage />} />
                <Route path="/formulations" element={<FormulationsPage />} />
                <Route path="/laboratory-results" element={<RoleRoute roles={WORKSPACE_ROLES}><LaboratoryResultsPage /></RoleRoute>} />
                <Route path="/compatibility" element={<CompatibilityPage />} />
                <Route path="/ai" element={<RoleRoute roles={WORKSPACE_ROLES}><AIPage /></RoleRoute>} />
                <Route path="/target-generation" element={<RoleRoute roles={WORKSPACE_ROLES}><TargetGenerationPage /></RoleRoute>} />
                <Route path="/regulatory" element={<RoleRoute roles={WORKSPACE_ROLES}><RegulatoryPage /></RoleRoute>} />
                <Route path="/cost" element={<RoleRoute roles={WORKSPACE_ROLES}><CostPage /></RoleRoute>} />
                <Route path="/history" element={<HistoryPage />} />
                <Route path="/account" element={<AccountPage />} />
                <Route path="*" element={<section className="py-16 text-center"><h1 className="text-3xl font-bold">Page not found</h1><Link to="/" className="mt-4 inline-block text-sky-700 underline">Return home</Link></section>} />
              </Routes>
            </React.Suspense>
          </main>
        </div>
      </Router>
    </ErrorBoundary>
  );
}

export default App;
