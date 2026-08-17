import { useEffect, useRef, useState } from 'react';
import { formulationsAPI, ingredientsAPI } from '../services/api';
import { Formulation, Ingredient } from '../types';
import { Plus, Search, X, Trash2, Archive, GitBranch } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { canManageFormulations } from '../auth/permissions';
import Pagination from '../components/Pagination';
import StatusMessage from '../components/StatusMessage';
import { getErrorMessage } from '../services/errors';

interface FormulationIngredientInput {
  ingredient_id: string;
  percentage: number;
}

export default function FormulationsPage() {
  const { profile } = useAuth();
  const canEdit = canManageFormulations(profile?.role);
  const pageSize = 12;
  const [formulations, setFormulations] = useState<Formulation[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [selectedFormulation, setSelectedFormulation] = useState<Formulation | null>(null);
  const [versions, setVersions] = useState<Formulation[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formBeverageType, setFormBeverageType] = useState('soft_drink');
  const [formIngredients, setFormIngredients] = useState<FormulationIngredientInput[]>([]);

  useEffect(() => { void loadIngredients(); }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadFormulations(), 250);
    return () => window.clearTimeout(timer);
  }, [search, page]);

  useEffect(() => { setPage(1); }, [search]);

  useEffect(() => {
    if (!showModal) return;
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeModal();
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]') || []);
      if (focusable.length === 0) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showModal]);

  async function loadFormulations() {
    setLoading(true);
    setError('');
    try {
      const res = await formulationsAPI.getAll({ search, limit: pageSize, offset: (page - 1) * pageSize });
      setFormulations(res.data.data);
      setTotal(res.data.pagination.total);
    } catch (error) {
      setError(getErrorMessage(error, 'Unable to load formulations.'));
    } finally {
      setLoading(false);
    }
  }

  async function loadIngredients() {
    try {
      const res = await ingredientsAPI.getAll({ limit: 500 });
      setIngredients(res.data.data);
    } catch (error) {
      setError(getErrorMessage(error, 'Unable to load the ingredient choices.'));
    }
  }

  function openCreateModal() {
    if (!canEdit) return;
    triggerRef.current = document.activeElement as HTMLElement;
    setSelectedFormulation(null);
    setFormName('');
    setFormDescription('');
    setFormBeverageType('soft_drink');
    setFormIngredients([{ ingredient_id: '', percentage: 0 }]);
    setShowModal(true);
  }

  async function openViewModal(formulation: Formulation) {
    triggerRef.current = document.activeElement as HTMLElement;
    setSelectedFormulation(formulation);
    setFormName(formulation.name);
    setFormDescription(formulation.description || '');
    setFormBeverageType(formulation.beverage_type);
    setFormIngredients(
      formulation.ingredients?.map(i => ({
        ingredient_id: i.ingredient_id,
        percentage: i.percentage,
      })) || []
    );
    setShowModal(true);
    try {
      const response = await formulationsAPI.getVersions(formulation.id);
      setVersions(response.data.data);
    } catch {
      setVersions([]);
    }
  }

  function closeModal() {
    setShowModal(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }

  function addIngredientRow() {
    setFormIngredients([...formIngredients, { ingredient_id: '', percentage: 0 }]);
  }

  function removeIngredientRow(index: number) {
    setFormIngredients(formIngredients.filter((_, i) => i !== index));
  }

  function updateIngredient(index: number, field: 'ingredient_id' | 'percentage', value: string | number) {
    const updated = [...formIngredients];
    if (field === 'percentage') {
      updated[index][field] = parseFloat(value as string) || 0;
    } else {
      updated[index][field] = value as string;
    }
    setFormIngredients(updated);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canEdit) return;
    setError(''); setMessage('');
    
    // Filter out empty ingredient rows
    const validIngredients = formIngredients.filter(i => i.ingredient_id && i.percentage > 0);
    
    if (validIngredients.length === 0) {
      setError('Please add at least one ingredient.');
      return;
    }

    try {
      if (selectedFormulation) {
        // Update existing
        await formulationsAPI.update(selectedFormulation.id, {
          name: formName,
          description: formDescription,
          beverage_type: formBeverageType,
          ingredients: validIngredients,
        });
      } else {
        // Create new
        await formulationsAPI.create({
          name: formName,
          description: formDescription,
          beverage_type: formBeverageType,
          ingredients: validIngredients,
        });
      }
      
      closeModal();
      setMessage(selectedFormulation ? 'Formulation updated.' : 'Formulation created.');
      void loadFormulations();
    } catch (error) {
      setError(getErrorMessage(error, 'Unable to save formulation.'));
    }
  }

  async function archiveSelected() {
    if (!selectedFormulation || !window.confirm(`Archive ${selectedFormulation.name}?`)) return;
    try {
      await formulationsAPI.delete(selectedFormulation.id);
      closeModal();
      setMessage(`${selectedFormulation.name} was archived.`);
      await loadFormulations();
    } catch (error) {
      setError(getErrorMessage(error, 'Unable to archive formulation.'));
    }
  }

  async function createNewVersion() {
    if (!selectedFormulation) return;
    const validIngredients = formIngredients.filter(item => item.ingredient_id && item.percentage > 0);
    try {
      await formulationsAPI.createVersion(selectedFormulation.id, {
        name: formName,
        description: formDescription,
        beverage_type: formBeverageType,
        ingredients: validIngredients,
      });
      closeModal();
      setMessage('A new formulation version was created.');
      await loadFormulations();
    } catch (error) {
      setError(getErrorMessage(error, 'Unable to create a formulation version.'));
    }
  }

  const totalPercentage = formIngredients.reduce((sum, i) => sum + (i.percentage || 0), 0);

  return (
    <div>
      <div className="px-4 py-5 sm:px-6 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Formulations</h1>
          <p className="mt-1 text-sm text-gray-500">
            {canEdit ? 'Create and manage beverage formulations' : 'Review beverage formulations in read-only mode'}
          </p>
        </div>
        {canEdit && <button type="button"
          onClick={openCreateModal}
          className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-sky-700 hover:bg-sky-800"
        >
          <Plus className="h-4 w-4 mr-2" />
          Create Formulation
        </button>}
      </div>

      <StatusMessage error={error} message={message} />

      {/* Search */}
      <div className="bg-white shadow rounded-lg p-4 mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            aria-label="Search formulations"
            type="text"
            placeholder="Search formulations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 w-full rounded-md border-gray-300 shadow-sm focus:border-sky-500 focus:ring-sky-500 border p-2"
          />
        </div>
      </div>

      {/* Formulations Grid */}
      {loading ? (
        <div className="p-8 text-center text-gray-500">Loading formulations...</div>
      ) : formulations.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <p className="text-gray-500 mb-4">{canEdit ? 'No formulations yet. Create your first one!' : 'No formulations found.'}</p>
          {canEdit && <button type="button"
            onClick={openCreateModal}
            className="inline-flex items-center px-4 py-2 bg-sky-700 text-white rounded-md hover:bg-sky-800"
          >
            <Plus className="h-4 w-4 mr-2" />
            Create Formulation
          </button>}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {formulations.map((formulation) => (
            <FormulationCard
              key={formulation.id}
              formulation={formulation}
              onClick={() => openViewModal(formulation)}
            />
          ))}
        </div>
      )}
      {!loading && <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} label="Formulations" />}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="formulation-dialog-title" className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 id="formulation-dialog-title" className="text-2xl font-bold text-gray-900">
                  {selectedFormulation ? (canEdit ? 'Edit Formulation' : 'Formulation Details') : 'Create New Formulation'}
                </h2>
                <button
                  ref={closeButtonRef}
                  type="button"
                  onClick={closeModal}
                  aria-label="Close formulation details"
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              <form onSubmit={handleSubmit}>
                <div className="space-y-4">
                  {/* Basic Info */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="formulation-name" className="block text-sm font-medium text-gray-700 mb-1">
                        Name *
                      </label>
                      <input
                        type="text"
                        id="formulation-name"
                        disabled={!canEdit}
                        value={formName}
                        onChange={(e) => setFormName(e.target.value)}
                        required
                        className="w-full rounded-md border-gray-300 shadow-sm focus:border-sky-500 focus:ring-sky-500 border p-2"
                        placeholder="e.g., Orange Soda Classic"
                      />
                    </div>
                    <div>
                      <label htmlFor="formulation-type" className="block text-sm font-medium text-gray-700 mb-1">
                        Beverage Type
                      </label>
                      <select
                        id="formulation-type"
                        disabled={!canEdit}
                        value={formBeverageType}
                        onChange={(e) => setFormBeverageType(e.target.value)}
                        className="w-full rounded-md border-gray-300 shadow-sm focus:border-sky-500 focus:ring-sky-500 border p-2"
                      >
                        <option value="soft_drink">Soft Drink</option>
                        <option value="juice">Juice</option>
                        <option value="energy_drink">Energy Drink</option>
                        <option value="water">Flavored Water</option>
                        <option value="tea">Tea</option>
                      </select>
                    </div>
                  </div>

                  {selectedFormulation && versions.length > 1 && (
                    <div className="rounded-md bg-gray-50 p-3 text-sm text-gray-700">
                      Version history: {versions.map(version => `v${version.version} (${version.status})`).join(' • ')}
                    </div>
                  )}

                  <div>
                    <label htmlFor="formulation-description" className="block text-sm font-medium text-gray-700 mb-1">
                      Description
                    </label>
                    <textarea
                      id="formulation-description"
                      disabled={!canEdit}
                      value={formDescription}
                      onChange={(e) => setFormDescription(e.target.value)}
                      rows={2}
                      className="w-full rounded-md border-gray-300 shadow-sm focus:border-sky-500 focus:ring-sky-500 border p-2"
                      placeholder="Brief description of this formulation"
                    />
                  </div>

                  {/* Ingredients Section */}
                  <div className="border-t pt-4">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-lg font-semibold text-gray-900">Ingredients</h3>
                      <div className="flex items-center gap-4">
                        <span className={`text-sm font-medium ${
                          Math.abs(totalPercentage - 100) < 0.1 
                            ? 'text-green-700'
                            : 'text-red-600'
                        }`}>
                          Total: {totalPercentage.toFixed(2)}%
                        </span>
                        {canEdit && <button
                          type="button"
                          onClick={addIngredientRow}
                          className="inline-flex items-center px-3 py-1 bg-sky-100 text-sky-700 rounded-md hover:bg-sky-200 text-sm"
                        >
                          <Plus className="h-4 w-4 mr-1" />
                          Add Ingredient
                        </button>}
                      </div>
                    </div>

                    <div className="space-y-2">
                      {/* Header */}
                      <div className="grid grid-cols-12 gap-2 text-sm font-medium text-gray-500 px-2">
                        <div className="col-span-7">Ingredient</div>
                        <div className="col-span-3">Percentage (%)</div>
                        <div className="col-span-2"></div>
                      </div>

                      {/* Ingredient Rows */}
                      {formIngredients.map((fi, index) => (
                        <div key={index} className="grid grid-cols-12 gap-2 items-center">
                          <div className="col-span-7">
                            <select
                              aria-label={`Ingredient ${index + 1}`}
                              disabled={!canEdit}
                              value={fi.ingredient_id}
                              onChange={(e) => updateIngredient(index, 'ingredient_id', e.target.value)}
                              className="w-full rounded-md border-gray-300 shadow-sm focus:border-sky-500 focus:ring-sky-500 border p-2 text-sm"
                            >
                              <option value="">Select ingredient...</option>
                              {ingredients.map((ing) => (
                                <option key={ing.id} value={ing.id}>
                                  {ing.name} ({ing.category}) - {ing.base_price_per_kg} DZD/kg
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="col-span-3">
                            <input
                              aria-label={`Percentage for ingredient ${index + 1}`}
                              disabled={!canEdit}
                              type="number"
                              value={fi.percentage || ''}
                              onChange={(e) => updateIngredient(index, 'percentage', e.target.value)}
                              step="0.01"
                              min="0"
                              max="100"
                              className="w-full rounded-md border-gray-300 shadow-sm focus:border-sky-500 focus:ring-sky-500 border p-2 text-sm"
                              placeholder="0.00"
                            />
                          </div>
                          <div className="col-span-2 flex justify-center">
                            {canEdit && <button
                              type="button"
                              onClick={() => removeIngredientRow(index)}
                              className="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                              aria-label={`Remove ingredient row ${index + 1}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>}
                          </div>
                        </div>
                      ))}

                      {formIngredients.length === 0 && (
                        <div className="text-center py-4 text-gray-500">
                          No ingredients added. Click "Add Ingredient" to start.
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="mt-6 flex flex-wrap justify-end gap-3">
                  {canEdit && selectedFormulation && (
                    <>
                      <button type="button" onClick={archiveSelected}
                        className="mr-auto inline-flex items-center px-4 py-2 border border-amber-300 rounded-md text-amber-800 hover:bg-amber-50">
                        <Archive className="h-4 w-4 mr-2" /> Archive
                      </button>
                      <button type="button" onClick={createNewVersion}
                        className="inline-flex items-center px-4 py-2 border border-sky-300 rounded-md text-sky-700 hover:bg-sky-50">
                        <GitBranch className="h-4 w-4 mr-2" /> Save as New Version
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={closeModal}
                    className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                  >
                    Close
                  </button>
                  {canEdit && <button
                    type="submit"
                    className="px-4 py-2 bg-sky-700 text-white rounded-md hover:bg-sky-800"
                  >
                    {selectedFormulation ? 'Update Formulation' : 'Create Formulation'}
                  </button>}
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FormulationCard({ formulation, onClick }: { formulation: Formulation; onClick: () => void }) {
  return (
    <button type="button"
      onClick={onClick}
      className="w-full bg-white text-left shadow rounded-lg p-6 hover:shadow-md transition-shadow focus:outline-none focus:ring-2 focus:ring-sky-500"
    >
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{formulation.name}</h3>
          <p className="text-sm text-gray-500">{formulation.code}</p>
        </div>
        <span
          className={`px-2 py-1 text-xs font-semibold rounded-full ${
            formulation.status === 'active'
              ? 'bg-green-100 text-green-800'
              : formulation.status === 'draft'
              ? 'bg-yellow-100 text-yellow-800'
              : 'bg-gray-100 text-gray-800'
          }`}
        >
          {formulation.status}
        </span>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Type:</span>
          <span className="text-gray-900">{formulation.beverage_type}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Ingredients:</span>
          <span className="text-gray-900">{formulation.ingredients?.length || 0}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Total %:</span>
          <span className={`font-medium ${
            Math.abs((formulation.total_percentage || 0) - 100) < 0.1 
              ? 'text-green-700'
              : 'text-red-600'
          }`}>
            {(formulation.total_percentage || 0).toFixed(2)}%
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Cost/L:</span>
          <span className="text-gray-900">{(formulation.total_cost_per_liter || 0).toFixed(2)} DZD</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Calories:</span>
          <span className="text-gray-900">{(formulation.total_calories_per_100ml || 0).toFixed(1)}/100ml</span>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-gray-200">
        <span className="text-sm text-sky-600 hover:text-sky-900 font-medium">
          View Details →
        </span>
      </div>
    </button>
  );
}
