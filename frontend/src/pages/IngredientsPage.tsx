import { useEffect, useState } from 'react';
import { ingredientsAPI } from '../services/api';
import { Ingredient } from '../types';
import { Plus, Search, Filter, X } from 'lucide-react';

export default function IngredientsPage() {
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [showModal, setShowModal] = useState(false);

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
    vegan: true,
  });

  useEffect(() => {
    loadCategories();
    loadIngredients();
  }, [category, search]);

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
    try {
      const res = await ingredientsAPI.getAll({
        search,
        category: category || undefined,
        limit: 100,
      });
      setIngredients(res.data.data);
    } catch (error) {
      console.error('Error loading ingredients:', error);
    } finally {
      setLoading(false);
    }
  }

  function openAddModal() {
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
      vegan: true,
    });
    setShowModal(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await ingredientsAPI.create(formData);
      setShowModal(false);
      loadIngredients();
    } catch (error) {
      console.error('Error creating ingredient:', error);
      alert('Error creating ingredient');
    }
  }

  return (
    <div>
      <div className="px-4 py-5 sm:px-6 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Ingredients</h1>
          <p className="mt-1 text-sm text-gray-500">
            {ingredients.length} ingredients loaded
          </p>
        </div>
        <button
          onClick={openAddModal}
          className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-sky-600 hover:bg-sky-700"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Ingredient
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white shadow rounded-lg p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
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
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Code
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Category
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Price (DZD/kg)
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Calories
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Halal
                </th>
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
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add Ingredient Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Add New Ingredient</h2>
                <button
                  onClick={() => setShowModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              <form onSubmit={handleSubmit}>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Code *
                      </label>
                      <input
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
                        type="number"
                        value={formData.sugar_g}
                        onChange={(e) => setFormData({ ...formData, sugar_g: parseFloat(e.target.value) || 0 })}
                        min="0"
                        className="w-full rounded-md border p-2"
                      />
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
                      <input
                        type="checkbox"
                        checked={formData.vegan}
                        onChange={(e) => setFormData({ ...formData, vegan: e.target.checked })}
                        className="rounded border-gray-300 text-sky-600 mr-2"
                      />
                      <span className="text-sm text-gray-700">Vegan</span>
                    </label>
                  </div>
                </div>

                <div className="mt-6 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-sky-600 text-white rounded-md hover:bg-sky-700"
                  >
                    Add Ingredient
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
