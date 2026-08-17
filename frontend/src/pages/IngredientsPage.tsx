import { useEffect, useRef, useState } from 'react';
import { costAPI, ingredientsAPI } from '../services/api';
import { Ingredient } from '../types';
import { Plus, Search, Filter, X, Pencil, Archive } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import Pagination from '../components/Pagination';
import StatusMessage from '../components/StatusMessage';
import { getErrorMessage } from '../services/errors';

export default function IngredientsPage() {
  const { profile } = useAuth();
  const canManageIngredients = profile?.role === 'admin';
  const pageSize = 25;
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [selectedIngredient, setSelectedIngredient] = useState<Ingredient | null>(null);
  const [priceHistory, setPriceHistory] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const editorRef = useRef<HTMLDivElement>(null);

  // Form state for new ingredient
  const [formData, setFormData] = useState({
    code: '',
    name: '',
    name_ar: '',
    name_fr: '',
    category: 'flavor',
    base_price_per_kg: 0,
    calories_per_100g: 0,
    sugar_g: 0,
    halal_certified: true,
    kosher_certified: true,
    vegan: true,
    organic: false,
    regulatory_status: 'pending',
    max_percentage: '' as number | '',
  });

  useEffect(() => {
    void loadCategories();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadIngredients(), 250);
    return () => window.clearTimeout(timer);
  }, [category, search, page]);

  useEffect(() => {
    setPage(1);
  }, [category, search]);

  useEffect(() => {
    if (!showModal) return;
    editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    editorRef.current?.focus();
  }, [showModal, selectedIngredient]);

  async function loadCategories() {
    try {
      const res = await ingredientsAPI.getCategories();
      setCategories(res.data.data);
    } catch (error) {
      console.error('Error loading categories:', error);
    }
  }

  async function loadIngredients() {
    setLoading(true);
    setError('');
    try {
      const res = await ingredientsAPI.getAll({
        search,
        category: category || undefined,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
      setIngredients(res.data.data);
      setTotal(res.data.pagination.total);
    } catch (error) {
      setError(getErrorMessage(error, 'Unable to load ingredients.'));
    } finally {
      setLoading(false);
    }
  }

  function openAddModal() {
    setSelectedIngredient(null);
    setPriceHistory([]);
    setFormData({
      code: `ING-${Date.now()}`,
      name: '',
      name_ar: '',
      name_fr: '',
      category: 'flavor',
      base_price_per_kg: 0,
      calories_per_100g: 0,
      sugar_g: 0,
      halal_certified: true,
      kosher_certified: true,
      vegan: true,
      organic: false,
      regulatory_status: 'pending',
      max_percentage: '',
    });
    setShowModal(true);
  }

  async function openEditModal(ingredient: Ingredient) {
    setSelectedIngredient(ingredient);
    setFormData({
      code: ingredient.code,
      name: ingredient.name,
      name_ar: ingredient.name_ar || '',
      name_fr: ingredient.name_fr || '',
      category: ingredient.category,
      base_price_per_kg: ingredient.base_price_per_kg,
      calories_per_100g: ingredient.calories_per_100g || 0,
      sugar_g: ingredient.sugar_g || 0,
      halal_certified: ingredient.halal_certified,
      kosher_certified: ingredient.kosher_certified,
      vegan: ingredient.vegan,
      organic: ingredient.organic,
      regulatory_status: ingredient.regulatory_status,
      max_percentage: ingredient.max_percentage ?? '',
    });
    setShowModal(true);
    try {
      const response = await costAPI.getPricingHistory(ingredient.id, { limit: 20 });
      setPriceHistory(response.data.data);
    } catch {
      setPriceHistory([]);
    }
  }

  async function archiveIngredient(ingredient: Ingredient) {
    if (!window.confirm(`Archive ${ingredient.name}? This is allowed only when no active formulation uses it.`)) return;
    try {
      await ingredientsAPI.delete(ingredient.id);
      setMessage(`${ingredient.name} was archived.`);
      await loadIngredients();
    } catch (error) {
      setError(getErrorMessage(error, 'Unable to archive ingredient.'));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setMessage('');
    try {
      const payload = { ...formData, max_percentage: formData.max_percentage === '' ? undefined : formData.max_percentage };
      if (selectedIngredient) await ingredientsAPI.update(selectedIngredient.id, payload);
      else await ingredientsAPI.create(payload);
      setShowModal(false);
      setMessage(selectedIngredient ? 'Ingredient updated.' : 'Ingredient created.');
      void loadIngredients();
    } catch (error) {
      setError(getErrorMessage(error, 'Unable to save ingredient.'));
    }
  }

  return (
    <div>
      <div className="px-4 py-5 sm:px-6 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Ingredients</h1>
          <p className="mt-1 text-sm text-gray-500">
            {total} beverage ingredients · DZD/kg values are planning estimates until replaced with supplier quotes
          </p>
        </div>
        {canManageIngredients && (
          <button
            onClick={openAddModal}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-sky-700 hover:bg-sky-800"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Ingredient
          </button>
        )}
      </div>

      <StatusMessage error={error} message={message} />

      {/* The editor is deliberately inline instead of an overlay. This keeps it
          usable in browsers where stacking contexts or modal backdrops fail. */}
      {showModal && (
        <div ref={editorRef} role="region" aria-labelledby="ingredient-editor-title" tabIndex={-1} className="mb-6 scroll-mt-20 rounded-lg border border-sky-200 bg-white shadow-xl outline-none">
          <div className="p-6">
            <div className="mb-6 flex items-center justify-between">
              <h2 id="ingredient-editor-title" className="text-2xl font-bold text-gray-900">
                {selectedIngredient ? 'Edit Ingredient' : 'Add New Ingredient'}
              </h2>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                aria-label="Close ingredient editor"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <IngredientForm
              formData={formData}
              setFormData={setFormData}
              selectedIngredient={selectedIngredient}
              priceHistory={priceHistory}
              onSubmit={handleSubmit}
              onCancel={() => setShowModal(false)}
            />
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white shadow rounded-lg p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              aria-label="Search ingredients"
              type="text"
              placeholder="Search ingredients..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 w-full rounded-md border-gray-300 shadow-sm focus:border-sky-500 focus:ring-sky-500 border p-2"
            />
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <select
              aria-label="Filter ingredients by category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="pl-10 w-full rounded-md border-gray-300 shadow-sm focus:border-sky-500 focus:ring-sky-500 border p-2"
            >
              <option value="">All Categories</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Ingredients Table */}
      <div className="bg-white shadow overflow-hidden sm:rounded-md">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading ingredients...</div>
        ) : ingredients.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No ingredients found</div>
        ) : (
          <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <caption className="sr-only">Ingredient catalog</caption>
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Code
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Name
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Category
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Price (DZD/kg)
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Calories
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Halal
                </th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {ingredients.map((ingredient) => (
                <tr key={ingredient.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {ingredient.code}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {ingredient.name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <span className="px-2 py-1 bg-gray-100 rounded-full text-xs">
                      {ingredient.category}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {ingredient.base_price_per_kg?.toFixed(2) || '0.00'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {ingredient.calories_per_100g || 0}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        ingredient.halal_certified
                          ? 'bg-green-100 text-green-800'
                          : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {ingredient.halal_certified ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    {canManageIngredients ? <>
                      <button type="button" onClick={() => openEditModal(ingredient)} className="p-2 text-sky-600 hover:bg-sky-50 rounded" aria-label={`Edit ${ingredient.name}`}>
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => archiveIngredient(ingredient)} className="p-2 text-amber-700 hover:bg-amber-50 rounded" aria-label={`Archive ${ingredient.name}`}>
                        <Archive className="h-4 w-4" />
                      </button>
                    </> : <span className="text-xs text-gray-400">Read only</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
        {!loading && <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} label="Ingredients" />}
      </div>

    </div>
  );
}

type IngredientFormProps = {
  formData: {
    code: string;
    name: string;
    name_ar: string;
    name_fr: string;
    category: string;
    base_price_per_kg: number;
    calories_per_100g: number;
    sugar_g: number;
    halal_certified: boolean;
    kosher_certified: boolean;
    vegan: boolean;
    organic: boolean;
    regulatory_status: string;
    max_percentage: number | '';
  };
  setFormData: React.Dispatch<React.SetStateAction<IngredientFormProps['formData']>>;
  selectedIngredient: Ingredient | null;
  priceHistory: any[];
  onSubmit: (event: React.FormEvent) => void;
  onCancel: () => void;
};

function IngredientForm({
  formData,
  setFormData,
  selectedIngredient,
  priceHistory,
  onSubmit,
  onCancel,
}: IngredientFormProps) {
  return (
              <form onSubmit={onSubmit}>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Code *
                      </label>
                      <input
                        aria-label="Ingredient code"
                        type="text"
                        value={formData.code}
                        onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                        required
                        className="w-full rounded-md border p-2"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Category *
                      </label>
                      <select
                        aria-label="Ingredient category"
                        value={formData.category}
                        onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                        className="w-full rounded-md border p-2"
                      >
                        <option value="base">Base</option>
                        <option value="sweetener">Sweetener</option>
                        <option value="acidulant">Acidulant</option>
                        <option value="flavor">Flavor</option>
                        <option value="colorant">Colorant</option>
                        <option value="preservative">Preservative</option>
                        <option value="vitamin">Vitamin</option>
                        <option value="mineral">Mineral</option>
                        <option value="stimulant">Stimulant</option>
                        <option value="stabilizer">Stabilizer</option>
                        <option value="juice">Juice Concentrate</option>
                        <option value="extract">Extract</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Name (English) *
                    </label>
                    <input
                      aria-label="Ingredient name in English"
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      required
                      className="w-full rounded-md border p-2"
                      placeholder="e.g., Orange Flavor"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Name (Arabic)
                      </label>
                      <input
                        aria-label="Ingredient name in Arabic"
                        type="text"
                        value={formData.name_ar}
                        onChange={(e) => setFormData({ ...formData, name_ar: e.target.value })}
                        className="w-full rounded-md border p-2"
                        dir="rtl"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Name (French)
                      </label>
                      <input
                        aria-label="Ingredient name in French"
                        type="text"
                        value={formData.name_fr}
                        onChange={(e) => setFormData({ ...formData, name_fr: e.target.value })}
                        className="w-full rounded-md border p-2"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Price (DZD/kg) *
                      </label>
                      <input
                        aria-label="Price in DZD per kilogram"
                        type="number"
                        value={formData.base_price_per_kg}
                        onChange={(e) => setFormData({ ...formData, base_price_per_kg: parseFloat(e.target.value) || 0 })}
                        min="0"
                        step="0.01"
                        className="w-full rounded-md border p-2"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Calories/100g
                      </label>
                      <input
                        aria-label="Calories per 100 grams"
                        type="number"
                        value={formData.calories_per_100g}
                        onChange={(e) => setFormData({ ...formData, calories_per_100g: parseFloat(e.target.value) || 0 })}
                        min="0"
                        className="w-full rounded-md border p-2"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Sugar (g/100g)
                      </label>
                      <input
                        aria-label="Sugar in grams per 100 grams"
                        type="number"
                        value={formData.sugar_g}
                        onChange={(e) => setFormData({ ...formData, sugar_g: parseFloat(e.target.value) || 0 })}
                        min="0"
                        className="w-full rounded-md border p-2"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Maximum Percentage</label>
                      <input aria-label="Maximum percentage" type="number" min="0.0001" max="100" step="0.0001"
                        value={formData.max_percentage}
                        onChange={(e) => setFormData({ ...formData, max_percentage: e.target.value === '' ? '' : Number(e.target.value) })}
                        className="w-full rounded-md border p-2" placeholder="No configured limit" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Regulatory Status</label>
                      <select aria-label="Regulatory status" value={formData.regulatory_status}
                        onChange={(e) => setFormData({ ...formData, regulatory_status: e.target.value })}
                        className="w-full rounded-md border p-2">
                        <option value="pending">Pending review</option>
                        <option value="approved">Approved in local data</option>
                        <option value="restricted">Restricted</option>
                        <option value="prohibited">Prohibited</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex gap-6">
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={formData.halal_certified}
                        onChange={(e) => setFormData({ ...formData, halal_certified: e.target.checked })}
                        className="rounded border-gray-300 text-sky-600 mr-2"
                      />
                      <span className="text-sm text-gray-700">Halal Certified</span>
                    </label>
                    <label className="flex items-center">
                      <input type="checkbox" checked={formData.kosher_certified}
                        onChange={(e) => setFormData({ ...formData, kosher_certified: e.target.checked })}
                        className="rounded border-gray-300 text-sky-600 mr-2" />
                      <span className="text-sm text-gray-700">Kosher Certified</span>
                    </label>
                    <label className="flex items-center">
                      <input type="checkbox" checked={formData.organic}
                        onChange={(e) => setFormData({ ...formData, organic: e.target.checked })}
                        className="rounded border-gray-300 text-sky-600 mr-2" />
                      <span className="text-sm text-gray-700">Organic</span>
                    </label>
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={formData.vegan}
                        onChange={(e) => setFormData({ ...formData, vegan: e.target.checked })}
                        className="rounded border-gray-300 text-sky-600 mr-2"
                      />
                      <span className="text-sm text-gray-700">Vegan</span>
                    </label>
                  </div>

                  {selectedIngredient && (
                    <div className="rounded-md bg-gray-50 p-3">
                      <p className="text-sm font-medium text-gray-700">Recent price history</p>
                      {priceHistory.length === 0 ? (
                        <p className="mt-1 text-xs text-gray-500">No previous price changes recorded.</p>
                      ) : (
                        <ul className="mt-2 space-y-1 text-xs text-gray-600">
                          {priceHistory.slice().reverse().map(record => (
                            <li key={record.id}>{Number(record.price_per_kg).toFixed(2)} {record.currency}/kg — {new Date(record.effective_date).toLocaleDateString()}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>

                <div className="mt-6 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={onCancel}
                    className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-sky-700 text-white rounded-md hover:bg-sky-800"
                  >
                    {selectedIngredient ? 'Save Changes' : 'Add Ingredient'}
                  </button>
                </div>
              </form>
  );
}
