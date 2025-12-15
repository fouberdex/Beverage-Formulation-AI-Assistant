import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { Home, Package, FlaskConical, Sparkles, Target, Shield, DollarSign, Menu, X } from 'lucide-react';

// Lazy load pages to catch any import errors
const Dashboard = React.lazy(() => import('./pages/Dashboard'));
const IngredientsPage = React.lazy(() => import('./pages/IngredientsPage'));
const FormulationsPage = React.lazy(() => import('./pages/FormulationsPage'));
const CompatibilityPage = React.lazy(() => import('./pages/CompatibilityPage'));
const AIPage = React.lazy(() => import('./pages/AIPage'));
const TargetGenerationPage = React.lazy(() => import('./pages/TargetGenerationPage'));
const RegulatoryPage = React.lazy(() => import('./pages/RegulatoryPage'));
const CostPage = React.lazy(() => import('./pages/CostPage'));

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-lg text-gray-600">Loading...</div>
    </div>
  );
}

function ErrorBoundary({ children }: { children: React.ReactNode }) {
  const [hasError, setHasError] = React.useState(false);
  const [error, setError] = React.useState<Error | null>(null);

  React.useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      setHasError(true);
      setError(new Error(event.message));
    };
    window.addEventListener('error', handleError);
    return () => window.removeEventListener('error', handleError);
  }, []);

  if (hasError) {
    return (
      <div className="min-h-screen bg-red-50 flex items-center justify-center p-4">
        <div className="bg-white p-6 rounded-lg shadow-lg max-w-lg">
          <h1 className="text-xl font-bold text-red-600 mb-2">Something went wrong</h1>
          <p className="text-gray-600">{error?.message || 'Unknown error'}</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

const navItems = [
  { to: '/', icon: Home, label: 'Dashboard' },
  { to: '/ingredients', icon: Package, label: 'Ingredients' },
  { to: '/formulations', icon: FlaskConical, label: 'Formulations' },
  { to: '/compatibility', icon: Shield, label: 'Compatibility' },
  { to: '/ai', icon: Sparkles, label: 'AI Engine' },
  { to: '/target-generation', icon: Target, label: 'Target Gen' },
  { to: '/regulatory', icon: Shield, label: 'Regulatory' },
  { to: '/cost', icon: DollarSign, label: 'Cost & ROI' },
];

function Navigation() {
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const location = useLocation();

  return (
    <nav className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex justify-between h-14">
          <div className="flex items-center">
            <Link to="/" className="flex items-center">
              <FlaskConical className="h-7 w-7 text-sky-600" />
              <span className="ml-2 text-lg font-bold text-gray-900">BeverageAI DZ</span>
            </Link>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden lg:flex lg:items-center lg:space-x-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.to;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`inline-flex items-center px-2 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    isActive
                      ? 'bg-sky-50 text-sky-700'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 mr-1" />
                  {item.label}
                </Link>
              );
            })}
          </div>

          {/* Mobile menu button */}
          <div className="lg:hidden flex items-center">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Navigation */}
        {mobileMenuOpen && (
          <div className="lg:hidden py-2 border-t">
            <div className="grid grid-cols-2 gap-2">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.to;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center px-3 py-2 text-sm font-medium rounded-md ${
                      isActive
                        ? 'bg-sky-50 text-sky-700'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                    }`}
                  >
                    <Icon className="h-4 w-4 mr-2" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <Router>
        <div className="min-h-screen bg-gray-50">
          <Navigation />

          {/* Main Content */}
          <main className="max-w-7xl mx-auto py-4 px-4">
            <React.Suspense fallback={<LoadingFallback />}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/ingredients" element={<IngredientsPage />} />
                <Route path="/formulations" element={<FormulationsPage />} />
                <Route path="/compatibility" element={<CompatibilityPage />} />
                <Route path="/ai" element={<AIPage />} />
                <Route path="/target-generation" element={<TargetGenerationPage />} />
                <Route path="/regulatory" element={<RegulatoryPage />} />
                <Route path="/cost" element={<CostPage />} />
              </Routes>
            </React.Suspense>
          </main>
        </div>
      </Router>
    </ErrorBoundary>
  );
}

export default App;
