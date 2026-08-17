import { useEffect, useState } from 'react';
import { ingredientsAPI, formulationsAPI } from '../services/api';
import { Package, FlaskConical, TrendingUp, AlertCircle } from 'lucide-react';
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
  const [stats, setStats] = useState({
    ingredients: 0,
    formulations: 0,
    categories: 0,
    loading: true,
  });

  useEffect(() => {
    async function loadStats() {
      try {
        const [ingredientsRes, formulationsRes, categoriesRes] = await Promise.all([
          ingredientsAPI.getStats(),
          formulationsAPI.getAll({ limit: 1 }),
          ingredientsAPI.getCategories(),
        ]);

        setStats({
          ingredients: ingredientsRes.data.data.total_ingredients,
          formulations: formulationsRes.data.pagination.total,
          categories: categoriesRes.data.data.length,
          loading: false,
        });
      } catch (error) {
        setError(getErrorMessage(error, 'Unable to load dashboard totals.'));
        setStats(prev => ({ ...prev, loading: false }));
      }
    }

    loadStats();
  }, []);

  return (
    <div>
      <div className="px-4 py-5 sm:px-6">
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">
          Authenticated beverage formulation and evaluation workspace
        </p>
      </div>
      <StatusMessage error={error} />

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3 mt-6">
        <StatCard
          title="Total Ingredients"
          value={stats.loading ? '...' : stats.ingredients.toLocaleString()}
          icon={<Package className="h-8 w-8 text-primary-600" />}
          description="Active ingredients in database"
        />
        <StatCard
          title="Formulations"
          value={stats.loading ? '...' : stats.formulations.toLocaleString()}
          icon={<FlaskConical className="h-8 w-8 text-green-700" />}
          description="Total formulations created"
        />
        <StatCard
          title="Categories"
          value={stats.loading ? '...' : stats.categories}
          icon={<TrendingUp className="h-8 w-8 text-blue-600" />}
          description="Ingredient categories"
        />
      </div>

      {/* Quick Actions */}
      <div className="mt-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {canAdministerIngredients && <QuickActionCard
            title="Add Ingredient"
            description="Add a new ingredient to the database"
            href="/ingredients"
            icon={<Package />}
          />}
          {canFormulate && <QuickActionCard
            title="Create Formulation"
            description="Create a new beverage formulation"
            href="/formulations"
            icon={<FlaskConical />}
          />}
          {canFormulate && <QuickActionCard
            title="AI Generation"
            description="Generate AI-powered alternatives"
            href="/ai"
            icon={<TrendingUp />}
          />}
          {canFormulate && <QuickActionCard
            title="Target Generation"
            description="Generate from constraints"
            href="/target-generation"
            icon={<AlertCircle />}
          />}
          {!canFormulate && <QuickActionCard title="Review Formulations" description="Inspect formulations in read-only mode" href="/formulations" icon={<FlaskConical />} />}
        </div>
      </div>

      {/* System Info */}
      <div className="mt-8 bg-white shadow rounded-lg p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">System Capabilities</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <CapabilityItem
            title="Data & formulation"
            items={[
              '466 halal beverage ingredients currently loaded',
              'Owner-scoped formulations stored in Supabase',
              'Compatibility screening computed on demand',
            ]}
          />
          <CapabilityItem
            title="Storage & API"
            items={[
              'Indexed PostgreSQL storage with Row Level Security',
              'Atomic formulation and ingredient synchronization',
              'Rate limiting and batch compatibility operations',
            ]}
          />
          <CapabilityItem
            title="Features"
            items={[
              'Gemini-assisted recommendations with local fallback',
              'Draft Algerian compliance checks and labels',
              'Cost, ROI, and ingredient price history',
            ]}
          />
          <CapabilityItem
            title="Access & history"
            items={[
              'Administrator, formulator, and viewer roles',
              'Owner-scoped multi-user data isolation',
              'Formulation versions, generation history, and audit log',
            ]}
          />
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon, description }: any) {
  return (
    <div className="bg-white overflow-hidden shadow rounded-lg">
      <div className="p-5">
        <div className="flex items-center">
          <div className="flex-shrink-0">{icon}</div>
          <div className="ml-5 w-0 flex-1">
            <dl>
              <dt className="text-sm font-medium text-gray-500 truncate">{title}</dt>
              <dd className="text-3xl font-semibold text-gray-900">{value}</dd>
              <dd className="text-xs text-gray-500 mt-1">{description}</dd>
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}

function QuickActionCard({ title, description, href, icon }: any) {
  return (
    <Link
      to={href}
      className="block bg-white overflow-hidden shadow rounded-lg hover:shadow-md transition-shadow"
    >
      <div className="p-5">
        <div className="flex items-center">
          <div className="h-6 w-6 text-sky-600">{icon}</div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-gray-900">{title}</h3>
            <p className="text-xs text-gray-500 mt-1">{description}</p>
          </div>
        </div>
      </div>
    </Link>
  );
}

function CapabilityItem({ title, items }: any) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 mb-2">{title}</h3>
      <ul className="space-y-1">
        {items.map((item: string, idx: number) => (
          <li key={idx} className="text-sm text-gray-600 flex items-center">
            <span className="text-green-500 mr-2">✓</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
