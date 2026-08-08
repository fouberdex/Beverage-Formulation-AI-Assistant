import { useState, useEffect } from 'react';
import { aiAPI, formulationsAPI } from '../services/api';
import { Formulation } from '../types';
import { Sparkles, Loader, Info, CheckCircle, AlertTriangle, ShieldCheck } from 'lucide-react';

type AIStatus = {
  provider: string;
  model: string;
  configured: boolean;
  used: boolean;
  reason?: string;
};

export default function AIPage() {
  const [formulations, setFormulations] = useState<Formulation[]>([]);
  const [selectedFormulationId, setSelectedFormulationId] = useState('');
  const [count, setCount] = useState(5);
  const [generationType, setGenerationType] = useState('optimization');
  const [targets, setTargets] = useState({ calories: '', sugar: '', cost: '' });
  const [loading, setLoading] = useState(false);
  const [loadingFormulations, setLoadingFormulations] = useState(true);
  const [variants, setVariants] = useState<any[]>([]);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [aiStatus, setAiStatus] = useState<AIStatus | null>(null);

  useEffect(() => {
    loadFormulations();
  }, []);

  async function loadFormulations() {
    setLoadingFormulations(true);
    try {
      const res = await formulationsAPI.getAll({ limit: 100 });
      setFormulations(res.data.data);
      if (res.data.data.length > 0) {
        setSelectedFormulationId(res.data.data[0].id);
      }
    } catch (error) {
      console.error('Error loading formulations:', error);
    } finally {
      setLoadingFormulations(false);
    }
  }

  async function generateVariants() {
    if (!selectedFormulationId) {
      alert('Please select a formulation first');
      return;
    }

    setLoading(true);
    setVariants([]);
    setSuccessMessage('');
    setAiStatus(null);
    try {
      const res = await aiAPI.generateVariants(selectedFormulationId, {
        count: Math.min(count, 10),
        generation_type: generationType,
        target_calories: targets.calories === '' ? undefined : Number(targets.calories),
        target_sugar: targets.sugar === '' ? undefined : Number(targets.sugar),
        target_cost_per_liter: targets.cost === '' ? undefined : Number(targets.cost),
      });
      setVariants(res.data.data);
      setAiStatus(res.data.ai || null);
    } catch (error: any) {
      alert(error.response?.data?.error || 'Error generating variants');
    } finally {
      setLoading(false);
    }
  }

  async function loadPreviousVariants() {
    if (!selectedFormulationId) return;
    setLoading(true);
    setAiStatus(null);
    try {
      const response = await aiAPI.getVariants(selectedFormulationId, { limit: 50 });
      setVariants(response.data.data);
    } catch (error: any) {
      alert(error.response?.data?.error || 'Error loading saved variants');
    } finally {
      setLoading(false);
    }
  }

  async function acceptVariant(variant: any) {
    setAcceptingId(variant.id);
    setSuccessMessage('');
    
    try {
      const selectedFormulation = formulations.find(f => f.id === selectedFormulationId);
      
      const res = await aiAPI.acceptVariant(variant.id, {
        variant_data: {
          ingredients: variant.variant_ingredients,
          source_name: selectedFormulation?.name || 'AI Variant',
          beverage_type: selectedFormulation?.beverage_type || 'soft_drink',
          explanation: variant.explanation,
        }
      });
      
      setSuccessMessage(`✓ Formulation "${res.data.data.name}" created successfully!`);
      
      // Reload formulations to include the new one
      loadFormulations();
      
      // Update variant status
      setVariants(variants.map(v => 
        v.id === variant.id ? { ...v, status: 'accepted' } : v
      ));
    } catch (error: any) {
      alert(error.response?.data?.error || 'Error creating formulation from variant');
    } finally {
      setAcceptingId(null);
    }
  }

  const selectedFormulation = formulations.find(f => f.id === selectedFormulationId);

  return (
    <div>
      <div className="px-4 py-5 sm:px-6">
        <h1 className="text-3xl font-bold text-gray-900">AI Recommendation Engine</h1>
        <p className="mt-1 text-sm text-gray-500">
          Generate locally validated alternatives, then have Gemini review and rank them
        </p>
      </div>

      {/* Success Message */}
      {successMessage && (
        <div className="mx-4 mb-4 bg-green-50 border border-green-200 rounded-lg p-4 flex items-center">
          <CheckCircle className="h-5 w-5 text-green-600 mr-3" />
          <span className="text-green-800 font-medium">{successMessage}</span>
          <a href="/formulations" className="ml-auto text-green-700 hover:text-green-900 text-sm font-medium">
            View Formulations →
          </a>
        </div>
      )}

      {/* Info Box */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6 mx-4">
        <div className="flex items-start">
          <Info className="h-5 w-5 text-blue-600 mr-3 mt-0.5" />
          <div className="text-sm text-blue-800">
            <p className="font-medium mb-1">How it works:</p>
            <ul className="list-disc list-inside space-y-1">
              <li><strong>Optimization</strong>: Reduces cost while maintaining quality (±10% ingredient changes)</li>
              <li><strong>Alternative</strong>: Tries same-category ingredient substitutions and different proportions</li>
              <li><strong>Constraint-Based</strong>: Generates based on specific targets</li>
              <li><strong>Safety</strong>: Percentages, ingredient limits, compatibility, cost, and nutrition are checked locally</li>
              <li><strong>AI Review</strong>: Gemini ranks candidates and explains tradeoffs; it does not replace lab or legal validation</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="bg-white shadow rounded-lg p-6 mx-4">
        {loadingFormulations ? (
          <div className="text-center py-8 text-gray-500">Loading formulations...</div>
        ) : formulations.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500 mb-4">No formulations found. Create a formulation first!</p>
            <a href="/formulations" className="text-sky-600 hover:text-sky-800 font-medium">
              Go to Formulations →
            </a>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Source Formulation *
              </label>
              <select
                value={selectedFormulationId}
                onChange={(e) => setSelectedFormulationId(e.target.value)}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-sky-500 focus:ring-sky-500 border p-2"
              >
                {formulations.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({f.code}) - {f.ingredients?.length || 0} ingredients
                  </option>
                ))}
              </select>
            </div>

            {selectedFormulation && (
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-medium text-gray-900 mb-2">Selected Formulation Details:</h4>
                <div className="grid grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className="text-gray-500">Type:</span>
                    <p className="font-medium">{selectedFormulation.beverage_type}</p>
                  </div>
                  <div>
                    <span className="text-gray-500">Ingredients:</span>
                    <p className="font-medium">{selectedFormulation.ingredients?.length || 0}</p>
                  </div>
                  <div>
                    <span className="text-gray-500">Cost/L:</span>
                    <p className="font-medium">{(selectedFormulation.total_cost_per_liter || 0).toFixed(2)} DZD</p>
                  </div>
                  <div>
                    <span className="text-gray-500">Calories:</span>
                    <p className="font-medium">{(selectedFormulation.total_calories_per_100ml || 0).toFixed(1)}/100ml</p>
                  </div>
                </div>
                {selectedFormulation.ingredients && selectedFormulation.ingredients.length > 0 && (
                  <div className="mt-3 pt-3 border-t text-sm">
                    <span className="text-gray-500">Ingredients: </span>
                    <span className="text-gray-700">
                      {selectedFormulation.ingredients.map(i => `${i.ingredient_name} (${i.percentage.toFixed(1)}%)`).join(', ')}
                    </span>
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Number of Variants (max 10)
                </label>
                <input
                  type="number"
                  value={count}
                  onChange={(e) => setCount(parseInt(e.target.value) || 5)}
                  min="1"
                  max="10"
                  className="w-full rounded-md border-gray-300 shadow-sm focus:border-sky-500 focus:ring-sky-500 border p-2"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Generation Type
                </label>
                <select
                  value={generationType}
                  onChange={(e) => setGenerationType(e.target.value)}
                  className="w-full rounded-md border-gray-300 shadow-sm focus:border-sky-500 focus:ring-sky-500 border p-2"
                >
                  <option value="optimization">Optimization (Cost Reduction)</option>
                  <option value="alternative">Alternative (Substitutions + Ratios)</option>
                  <option value="constraint_based">Constraint-Based (Target Goals)</option>
                </select>
              </div>
            </div>

            {generationType === 'constraint_based' && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 rounded-lg bg-sky-50 p-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Target Calories/100ml</label>
                  <input type="number" min="0" step="0.1" value={targets.calories}
                    onChange={(e) => setTargets({ ...targets, calories: e.target.value })}
                    className="w-full rounded-md border p-2" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Target Sugar g/100ml</label>
                  <input type="number" min="0" step="0.1" value={targets.sugar}
                    onChange={(e) => setTargets({ ...targets, sugar: e.target.value })}
                    className="w-full rounded-md border p-2" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Target Cost DZD/L</label>
                  <input type="number" min="0" step="0.01" value={targets.cost}
                    onChange={(e) => setTargets({ ...targets, cost: e.target.value })}
                    className="w-full rounded-md border p-2" />
                </div>
              </div>
            )}

            <button
              onClick={generateVariants}
              disabled={loading || !selectedFormulationId}
              className="w-full px-4 py-3 bg-sky-600 text-white rounded-md hover:bg-sky-700 disabled:opacity-50 flex items-center justify-center font-medium"
            >
              {loading ? (
                <>
                  <Loader className="h-5 w-5 mr-2 animate-spin" />
                  Generating Variants...
                </>
              ) : (
                <>
                  <Sparkles className="h-5 w-5 mr-2" />
                  Generate AI Variants
                </>
              )}
            </button>
            <button
              onClick={loadPreviousVariants}
              disabled={loading || !selectedFormulationId}
              className="w-full px-4 py-2 border border-sky-300 text-sky-700 rounded-md hover:bg-sky-50 disabled:opacity-50"
            >
              Load Previous Variants
            </button>
          </div>
        )}
      </div>

      {variants.length > 0 && (
        <div className="mt-6 mx-4">
          {aiStatus && (
            <div className={`mb-4 rounded-lg border p-4 ${
              aiStatus.used
                ? 'bg-green-50 border-green-200 text-green-800'
                : 'bg-amber-50 border-amber-200 text-amber-800'
            }`}>
              <div className="flex items-start">
                {aiStatus.used
                  ? <Sparkles className="h-5 w-5 mr-3 mt-0.5" />
                  : <AlertTriangle className="h-5 w-5 mr-3 mt-0.5" />}
                <div className="text-sm">
                  <p className="font-semibold">
                    {aiStatus.used
                      ? `AI review applied: ${aiStatus.provider} / ${aiStatus.model}`
                      : 'Validated local generation used (no external AI review)'}
                  </p>
                  {!aiStatus.used && <p className="mt-1">{aiStatus.reason || 'Gemini review was unavailable'}</p>}
                  <p className="mt-1">All ingredient percentages and displayed numerical changes were calculated by the backend.</p>
                </div>
              </div>
            </div>
          )}
          <h2 className="text-xl font-semibold text-gray-900 mb-4">
            Generated Variants ({variants.length})
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {variants.map((variant, idx) => (
              <div key={variant.id} className={`bg-white shadow rounded-lg p-6 ${variant.status === 'accepted' ? 'ring-2 ring-green-500' : ''}`}>
                <div className="flex justify-between items-start mb-4">
                  <h3 className="text-lg font-medium text-gray-900">Variant {idx + 1}</h3>
                  <div className="text-right">
                    {variant.status === 'accepted' ? (
                      <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">
                        ✓ Accepted
                      </span>
                    ) : (
                      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                        variant.confidence_score >= 85 ? 'bg-green-100 text-green-800' :
                        variant.confidence_score >= 70 ? 'bg-yellow-100 text-yellow-800' :
                        'bg-red-100 text-red-800'
                      }`}>
                        {variant.confidence_score?.toFixed(0)}% confidence
                      </span>
                    )}
                    {variant.recommended && variant.status !== 'accepted' && (
                      <p className="mt-2 text-xs font-semibold text-sky-700">AI recommended</p>
                    )}
                  </div>
                </div>
                
                <p className="text-sm text-gray-600 mb-3">{variant.explanation}</p>
                
                {/* Show variant ingredients */}
                {variant.variant_ingredients && variant.variant_ingredients.length > 0 && (
                  <div className="mb-3 p-3 bg-gray-50 rounded text-sm">
                    <p className="font-medium text-gray-700 mb-2">Ingredients:</p>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {variant.variant_ingredients.map((ing: any, i: number) => (
                        <div key={i} className="flex justify-between text-xs">
                          <span className="text-gray-600">{ing.ingredient_name}</span>
                          <span className="font-medium">{ing.percentage.toFixed(2)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                <div className="space-y-2 text-sm border-t pt-3">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Calculated Cost/L:</span>
                    <span className="font-medium">{variant.calculated_values?.cost_per_liter?.toFixed(2)} DZD</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Compatibility:</span>
                    <span className="font-medium">{variant.compatibility_score?.toFixed(0)}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Cost Change:</span>
                    <span className={variant.cost_difference_percent < 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                      {variant.cost_difference_percent > 0 ? '+' : ''}
                      {variant.cost_difference_percent?.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Calorie Change:</span>
                    <span className={variant.calorie_difference_percent < 0 ? 'text-green-600 font-medium' : 'text-orange-600 font-medium'}>
                      {variant.calorie_difference_percent > 0 ? '+' : ''}
                      {variant.calorie_difference_percent?.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Sugar Change:</span>
                    <span className={variant.sugar_difference_percent < 0 ? 'text-green-600 font-medium' : 'text-orange-600 font-medium'}>
                      {variant.sugar_difference_percent > 0 ? '+' : ''}
                      {variant.sugar_difference_percent?.toFixed(1)}%
                    </span>
                  </div>
                </div>

                <div className={`mt-3 rounded p-3 text-xs ${
                  variant.regulatory?.passes_local_checks
                    ? 'bg-green-50 text-green-800'
                    : 'bg-red-50 text-red-800'
                }`}>
                  <div className="flex items-center font-semibold">
                    <ShieldCheck className="h-4 w-4 mr-2" />
                    {variant.regulatory?.passes_local_checks
                      ? 'Passed local ingredient-limit screening'
                      : 'Local regulatory screening found a concern'}
                  </div>
                  <p className="mt-1">Lab and legal validation are still required.</p>
                </div>

                {variant.warnings?.length > 0 && (
                  <div className="mt-3 rounded bg-amber-50 p-3 text-xs text-amber-900">
                    <p className="font-semibold flex items-center mb-1">
                      <AlertTriangle className="h-4 w-4 mr-2" /> Warnings
                    </p>
                    <ul className="list-disc pl-5 space-y-1">
                      {variant.warnings.map((warning: string, warningIndex: number) => (
                        <li key={warningIndex}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                )}
                
                {variant.status !== 'accepted' && (
                  <button 
                    onClick={() => acceptVariant(variant)}
                    disabled={acceptingId === variant.id}
                    className="mt-4 w-full px-4 py-2 bg-sky-600 text-white rounded-md hover:bg-sky-700 disabled:opacity-50 text-sm font-medium flex items-center justify-center"
                  >
                    {acceptingId === variant.id ? (
                      <>
                        <Loader className="h-4 w-4 mr-2 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      <>
                        <CheckCircle className="h-4 w-4 mr-2" />
                        Accept & Create Formulation
                      </>
                    )}
                  </button>
                )}
                
                {variant.status === 'accepted' && (
                  <div className="mt-4 w-full px-4 py-2 bg-green-100 text-green-800 rounded-md text-sm font-medium text-center">
                    ✓ Formulation Created
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
