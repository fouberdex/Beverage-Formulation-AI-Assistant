import { useState } from 'react';
import { targetGenerationAPI } from '../services/api';
import { Target, Loader, Info, CheckCircle, ChevronDown, ChevronUp } from 'lucide-react';
import StatusMessage from '../components/StatusMessage';
import { getErrorMessage } from '../services/errors';

export default function TargetGenerationPage() {
  const [constraints, setConstraints] = useState({
    target_calories: '',
    target_sugar: '',
    target_cost_per_liter: '',
    beverage_type: 'soft_drink',
    max_ingredients: 10,
    min_ingredients: 5,
    count: 3,
  });
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [expandedScores, setExpandedScores] = useState<string[]>([]);
  const [successMessage, setSuccessMessage] = useState('');
  const [error, setError] = useState('');

  function toggleScoreExpand(id: string) {
    setExpandedScores(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  }

  async function generate() {
    setLoading(true);
    setError('');
    setResults(null);
    setSuccessMessage('');
    setSavedIds([]);
    try {
      const res = await targetGenerationAPI.generate({
        ...constraints,
        target_calories: constraints.target_calories ? parseFloat(constraints.target_calories) : undefined,
        target_sugar: constraints.target_sugar ? parseFloat(constraints.target_sugar) : undefined,
        target_cost_per_liter: constraints.target_cost_per_liter ? parseFloat(constraints.target_cost_per_liter) : undefined,
        create_formulations: false,
      });
      setResults(res.data.data);
    } catch (error) {
      setError(getErrorMessage(error, 'Unable to generate formulations.'));
    } finally {
      setLoading(false);
    }
  }

  async function saveAsFormulation(candidate: any, index: number) {
    setSavingId(candidate.id);
    setSuccessMessage('');
    
    try {
      const res = await targetGenerationAPI.save({
        candidate,
        name: `Target-Generated #${index + 1} - ${constraints.beverage_type}`,
      });
      
      setSavedIds(prev => [...prev, candidate.id]);
      setSuccessMessage(`✓ Formulation "${res.data.data.name}" created successfully!`);
    } catch (error) {
      setError(getErrorMessage(error, 'Unable to save formulation.'));
    } finally {
      setSavingId(null);
    }
  }

  function getScoreColor(score: number): string {
    if (score >= 90) return 'text-green-700';
    if (score >= 75) return 'text-yellow-700';
    if (score >= 60) return 'text-orange-700';
    return 'text-red-600';
  }

  function getScoreBgColor(score: number): string {
    if (score >= 90) return 'bg-green-100 text-green-800';
    if (score >= 75) return 'bg-yellow-100 text-yellow-800';
    if (score >= 60) return 'bg-orange-100 text-orange-800';
    return 'bg-red-100 text-red-800';
  }

  return (
    <div>
      <StatusMessage error={error} />
      <div className="px-4 py-5 sm:px-6">
        <h1 className="text-3xl font-bold text-gray-900">Target-Based Generation</h1>
        <p className="mt-1 text-sm text-gray-500">
          Generate formulations from constraints (calories, sugar, cost, type)
        </p>
      </div>

      {/* Success Message */}
      {successMessage && (
        <div className="mx-4 mb-4 bg-green-50 border border-green-200 rounded-lg p-4 flex items-center">
          <CheckCircle className="h-5 w-5 text-green-700 mr-3" />
          <span className="text-green-800 font-medium">{successMessage}</span>
          <a href="/formulations" className="ml-auto text-green-700 hover:text-green-900 text-sm font-medium">
            View Formulations →
          </a>
        </div>
      )}

      {/* Info Box */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6 mx-4">
        <div className="flex items-start">
          <Info className="h-5 w-5 text-amber-600 mr-3 mt-0.5" />
          <div className="text-sm text-amber-800">
            <p className="font-medium mb-1">Score Breakdown:</p>
            <ul className="list-disc list-inside space-y-1">
              <li><strong>Target Match (40%)</strong>: How close to your calorie, sugar, and cost targets</li>
              <li><strong>Compatibility (25%)</strong>: Ingredient chemical and physical compatibility</li>
              <li><strong>Sensory (25%)</strong>: Taste balance, sweetness, acidity, flavor intensity</li>
              <li><strong>Stability (10%)</strong>: pH stability, color stability, shelf life prediction</li>
            </ul>
            <p className="mt-2">Local scores are deterministic screening heuristics. They are not laboratory measurements.</p>
          </div>
        </div>
      </div>

      <div className="bg-white shadow rounded-lg p-6 mx-4">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Target Constraints</h2>
        <p className="text-sm text-gray-500 mb-4">Set at least one target constraint for the AI to optimize towards.</p>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Target Calories (per 100ml)
            </label>
            <input
              type="number"
              value={constraints.target_calories}
              onChange={(e) => setConstraints({ ...constraints, target_calories: e.target.value })}
              placeholder="e.g., 45"
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-sky-500 focus:ring-sky-500 border p-2"
            />
            <p className="text-xs text-gray-400 mt-1">Typical: Soda 40-50, Juice 45-60, Water 0</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Target Sugar (g per 100ml)
            </label>
            <input
              type="number"
              value={constraints.target_sugar}
              onChange={(e) => setConstraints({ ...constraints, target_sugar: e.target.value })}
              placeholder="e.g., 10"
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-sky-500 focus:ring-sky-500 border p-2"
            />
            <p className="text-xs text-gray-400 mt-1">Typical: Soda 10-12, Juice 8-12, Diet 0</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Target Cost (DZD per liter)
            </label>
            <input
              type="number"
              value={constraints.target_cost_per_liter}
              onChange={(e) => setConstraints({ ...constraints, target_cost_per_liter: e.target.value })}
              placeholder="e.g., 50"
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-sky-500 focus:ring-sky-500 border p-2"
            />
            <p className="text-xs text-gray-400 mt-1">Ingredient cost only, before overhead</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Beverage Type
            </label>
            <select
              value={constraints.beverage_type}
              onChange={(e) => setConstraints({ ...constraints, beverage_type: e.target.value })}
              className="w-full rounded-md border-gray-300 shadow-sm focus:border-sky-500 focus:ring-sky-500 border p-2"
            >
              <option value="soft_drink">Soft Drink (Carbonated)</option>
              <option value="juice">Juice</option>
              <option value="energy_drink">Energy Drink</option>
              <option value="water">Flavored Water</option>
              <option value="tea">Iced Tea</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Minimum Ingredients</label>
            <input
              type="number"
              min="1"
              max="40"
              value={constraints.min_ingredients}
              onChange={(e) => setConstraints({ ...constraints, min_ingredients: Number(e.target.value) })}
              className="w-full rounded-md border-gray-300 shadow-sm border p-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Maximum Ingredients</label>
            <input
              type="number"
              min="1"
              max="40"
              value={constraints.max_ingredients}
              onChange={(e) => setConstraints({ ...constraints, max_ingredients: Number(e.target.value) })}
              className="w-full rounded-md border-gray-300 shadow-sm border p-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Candidates</label>
            <input
              type="number"
              min="1"
              max="10"
              value={constraints.count}
              onChange={(e) => setConstraints({ ...constraints, count: Number(e.target.value) })}
              className="w-full rounded-md border-gray-300 shadow-sm border p-2"
            />
          </div>
        </div>

        <button
          onClick={generate}
          disabled={loading}
          className="mt-6 w-full px-4 py-3 bg-sky-700 text-white rounded-md hover:bg-sky-800 disabled:opacity-50 flex items-center justify-center font-medium"
        >
          {loading ? (
            <>
              <Loader className="h-5 w-5 mr-2 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Target className="h-5 w-5 mr-2" />
              Generate Candidates
            </>
          )}
        </button>
      </div>

      {results && results.candidates && (
        <div className="mt-6 mx-4">
          <div className={`mb-4 rounded-lg border p-4 ${
            results.ai?.used
              ? 'bg-indigo-50 border-indigo-200 text-indigo-800'
              : 'bg-gray-50 border-gray-200 text-gray-700'
          }`}>
            <p className="font-medium">
              {results.ai?.used
                ? `AI review applied: ${results.ai.provider} / ${results.ai.model}`
                : 'Validated local generation used (no external AI review)'}
            </p>
            {!results.ai?.used && results.ai?.reason && (
              <p className="mt-1 text-sm">{results.ai.reason}</p>
            )}
            {results.ai?.quota && <p className="mt-1 text-sm">External reviews remaining: {results.ai.quota.daily_remaining} today, {results.ai.quota.monthly_remaining} this month.</p>}
            {results.ai?.used && (
              <p className="mt-1 text-sm">
                Ingredient percentages were generated and validated locally; AI only reviewed scores and explanations.
              </p>
            )}
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-4">
            Generated Candidates ({results.candidates.length})
          </h2>
          <div className="space-y-6">
            {results.candidates.map((candidate: any, idx: number) => (
              <div key={candidate.id} className={`bg-white shadow rounded-lg overflow-hidden ${savedIds.includes(candidate.id) ? 'ring-2 ring-green-500' : ''}`}>
                {/* Header */}
                <div className="p-6 border-b">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="text-xl font-semibold text-gray-900">
                        Candidate #{idx + 1}
                        {idx === 0 && <span className="ml-2 text-sm text-green-700">(Best Match)</span>}
                      </h3>
                      <p className="text-sm text-gray-500 mt-1">
                        {candidate.ingredients?.length || 0} ingredients • {candidate.beverage_type}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className={`px-4 py-2 rounded-lg text-lg font-bold ${getScoreBgColor(candidate.overall_score)}`}>
                        {candidate.overall_score?.toFixed(1)} / 100
                      </div>
                      <p className="text-xs text-gray-500 mt-1">Overall Score</p>
                    </div>
                  </div>
                </div>

                <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Ingredients */}
                  <div>
                    <h4 className="font-semibold text-gray-900 mb-3">Ingredients</h4>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {candidate.ingredients?.map((ing: any, i: number) => (
                        <div key={i} className="flex justify-between items-center text-sm bg-gray-50 px-3 py-2 rounded">
                          <div>
                            <span className="text-gray-700 font-medium">{ing.ingredient_name}</span>
                            <span className="text-gray-400 text-xs ml-2">({ing.category})</span>
                          </div>
                          <span className="font-semibold text-gray-900">{ing.percentage.toFixed(2)}%</span>
                        </div>
                      ))}
                    </div>
                    
                    {/* Calculated Values */}
                    {candidate.calculated_values && (
                      <div className="mt-4 pt-4 border-t">
                        <h5 className="text-sm font-medium text-gray-700 mb-2">Calculated Values</h5>
                        <div className="grid grid-cols-3 gap-2 text-sm">
                          <div className="bg-blue-50 p-2 rounded text-center">
                            <p className="text-blue-600 font-semibold">{candidate.calculated_values.calories_per_100ml?.toFixed(1)}</p>
                            <p className="text-xs text-blue-500">Cal/100ml</p>
                          </div>
                          <div className="bg-purple-50 p-2 rounded text-center">
                            <p className="text-purple-600 font-semibold">{candidate.calculated_values.sugar_per_100ml?.toFixed(1)}g</p>
                            <p className="text-xs text-purple-500">Sugar/100ml</p>
                          </div>
                          <div className="bg-green-50 p-2 rounded text-center">
                            <p className="text-green-700 font-semibold">{candidate.calculated_values.cost_per_liter?.toFixed(2)}</p>
                            <p className="text-xs text-green-500">DZD/L</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {candidate.ai_explanation && (
                      <div className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-900">
                        <p className="font-medium mb-1">AI review</p>
                        <p>{candidate.ai_explanation}</p>
                        {candidate.ai_warnings?.length > 0 && (
                          <ul className="mt-2 list-disc pl-5 text-indigo-800">
                            {candidate.ai_warnings.map((warning: string, warningIndex: number) => (
                              <li key={warningIndex}>{warning}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}

                    {candidate.local_warnings?.length > 0 && (
                      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                        <p className="font-medium mb-1">Local screening warnings</p>
                        <ul className="list-disc pl-5">
                          {candidate.local_warnings.map((warning: string, warningIndex: number) => (
                            <li key={warningIndex}>{warning}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  {/* Detailed Scores */}
                  <div>
                    <div 
                      className="flex justify-between items-center cursor-pointer"
                      onClick={() => toggleScoreExpand(candidate.id)}
                    >
                      <h4 className="font-semibold text-gray-900">Detailed Scores</h4>
                      {expandedScores.includes(candidate.id) ? (
                        <ChevronUp className="h-5 w-5 text-gray-400" />
                      ) : (
                        <ChevronDown className="h-5 w-5 text-gray-400" />
                      )}
                    </div>
                    
                    {candidate.scores && (
                      <div className="mt-3 space-y-3">
                        {/* Target Match */}
                        <div className="bg-gray-50 p-3 rounded">
                          <div className="flex justify-between items-center mb-2">
                            <span className="font-medium text-gray-700">Target Match</span>
                            <span className={`font-semibold ${getScoreColor((candidate.scores.calorie_match + candidate.scores.sugar_match + candidate.scores.cost_match) / 3)}`}>
                              {((candidate.scores.calorie_match + candidate.scores.sugar_match + candidate.scores.cost_match) / 3).toFixed(0)}%
                            </span>
                          </div>
                          {expandedScores.includes(candidate.id) && (
                            <div className="space-y-1 text-sm">
                              <ScoreBar label="Calorie Match" value={candidate.scores.calorie_match} />
                              <ScoreBar label="Sugar Match" value={candidate.scores.sugar_match} />
                              <ScoreBar label="Cost Match" value={candidate.scores.cost_match} />
                            </div>
                          )}
                        </div>

                        {/* Compatibility */}
                        <div className="bg-gray-50 p-3 rounded">
                          <div className="flex justify-between items-center">
                            <span className="font-medium text-gray-700">Compatibility</span>
                            <span className={`font-semibold ${getScoreColor(candidate.scores.compatibility)}`}>
                              {candidate.scores.compatibility?.toFixed(0)}%
                            </span>
                          </div>
                        </div>

                        {/* Sensory */}
                        <div className="bg-gray-50 p-3 rounded">
                          <div className="flex justify-between items-center mb-2">
                            <span className="font-medium text-gray-700">Sensory Evaluation</span>
                            <span className={`font-semibold ${getScoreColor(
                              (candidate.scores.sensory.taste_balance + candidate.scores.sensory.sweetness_level + 
                               candidate.scores.sensory.acidity_balance + candidate.scores.sensory.flavor_intensity) / 4
                            )}`}>
                              {((candidate.scores.sensory.taste_balance + candidate.scores.sensory.sweetness_level + 
                                 candidate.scores.sensory.acidity_balance + candidate.scores.sensory.flavor_intensity) / 4).toFixed(0)}%
                            </span>
                          </div>
                          {expandedScores.includes(candidate.id) && (
                            <div className="space-y-1 text-sm">
                              <ScoreBar label="Taste Balance" value={candidate.scores.sensory.taste_balance} />
                              <ScoreBar label="Sweetness Level" value={candidate.scores.sensory.sweetness_level} />
                              <ScoreBar label="Acidity Balance" value={candidate.scores.sensory.acidity_balance} />
                              <ScoreBar label="Flavor Intensity" value={candidate.scores.sensory.flavor_intensity} />
                            </div>
                          )}
                        </div>

                        {/* Stability */}
                        <div className="bg-gray-50 p-3 rounded">
                          <div className="flex justify-between items-center mb-2">
                            <span className="font-medium text-gray-700">Stability Prediction</span>
                            <span className={`font-semibold ${getScoreColor(
                              (candidate.scores.stability.ph_stability + candidate.scores.stability.color_stability) / 2
                            )}`}>
                              {((candidate.scores.stability.ph_stability + candidate.scores.stability.color_stability) / 2).toFixed(0)}%
                            </span>
                          </div>
                          {expandedScores.includes(candidate.id) && (
                            <div className="space-y-1 text-sm">
                              <ScoreBar label="pH Stability" value={candidate.scores.stability.ph_stability} />
                              <ScoreBar label="Color Stability" value={candidate.scores.stability.color_stability} />
                              <div className="flex justify-between items-center mt-2">
                                <span className="text-gray-600">Est. Shelf Life</span>
                                <span className="font-medium text-gray-900">{candidate.scores.stability.shelf_life_months} months</span>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Regulatory */}
                        <div className="bg-gray-50 p-3 rounded">
                          <div className="flex justify-between items-center mb-2">
                            <span className="font-medium text-gray-700">Regulatory Compliance</span>
                            <span className={`font-semibold ${candidate.scores.regulatory.max_limits_ok ? 'text-green-700' : 'text-red-600'}`}>
                              {candidate.scores.regulatory.max_limits_ok ? 'Passed local screen' : 'Review required'}
                            </span>
                          </div>
                          {expandedScores.includes(candidate.id) && (
                            <div className="space-y-1 text-sm">
                              <div className="flex justify-between">
                                <span className="text-gray-600">Halal Certified</span>
                                <span>{candidate.scores.regulatory.halal_compliant ? '✓' : '✕'}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-600">Max Limits OK</span>
                                <span>{candidate.scores.regulatory.max_limits_ok ? '✓' : '✕'}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-600">Preservative OK</span>
                                <span>{candidate.scores.regulatory.preservative_ok ? '✓' : '✕'}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Action Button */}
                <div className="px-6 py-4 bg-gray-50 border-t">
                  {savedIds.includes(candidate.id) ? (
                    <div className="w-full px-4 py-3 bg-green-100 text-green-800 rounded-md text-center font-medium">
                      ✓ Formulation Saved Successfully
                    </div>
                  ) : (
                    <button
                      onClick={() => saveAsFormulation(candidate, idx)}
                      disabled={savingId === candidate.id}
                      className="w-full px-4 py-3 bg-sky-700 text-white rounded-md hover:bg-sky-800 disabled:opacity-50 font-medium flex items-center justify-center"
                    >
                      {savingId === candidate.id ? (
                        <>
                          <Loader className="h-5 w-5 mr-2 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <CheckCircle className="h-5 w-5 mr-2" />
                          Save as Formulation
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const getBarColor = (v: number) => {
    if (v >= 90) return 'bg-green-500';
    if (v >= 75) return 'bg-yellow-500';
    if (v >= 60) return 'bg-orange-500';
    return 'bg-red-500';
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-gray-600 w-32 text-xs">{label}</span>
      <div className="flex-1 bg-gray-200 rounded-full h-2">
        <div 
          className={`h-2 rounded-full ${getBarColor(value)}`}
          style={{ width: `${Math.min(100, value)}%` }}
        />
      </div>
      <span className="text-xs font-medium w-10 text-right">{value?.toFixed(0)}%</span>
    </div>
  );
}
