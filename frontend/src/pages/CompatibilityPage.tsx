import { useState, useEffect } from 'react';
import { compatibilityAPI, formulationsAPI } from '../services/api';
import { Formulation } from '../types';
import { AlertTriangle, CheckCircle, XCircle, Info, Shield } from 'lucide-react';

export default function CompatibilityPage() {
  const [formulations, setFormulations] = useState<Formulation[]>([]);
  const [selectedFormulationId, setSelectedFormulationId] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingFormulations, setLoadingFormulations] = useState(true);
  const [result, setResult] = useState<any>(null);

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

  async function evaluateCompatibility() {
    if (!selectedFormulationId) {
      alert('Please select a formulation');
      return;
    }

    setLoading(true);
    setResult(null);
    try {
      const res = await compatibilityAPI.evaluateFormulation(selectedFormulationId);
      setResult(res.data.data);
    } catch (error: any) {
      alert(error.response?.data?.error || 'Error evaluating compatibility');
    } finally {
      setLoading(false);
    }
  }

  const selectedFormulation = formulations.find(f => f.id === selectedFormulationId);

  return (
    <div>
      <div className="px-4 py-5 sm:px-6">
        <h1 className="text-3xl font-bold text-gray-900">Compatibility & Risk Engine</h1>
        <p className="mt-1 text-sm text-gray-500">
          Evaluate formulation compatibility and identify potential risks
        </p>
      </div>

      {/* Info Box */}
      <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 mb-6 mx-4">
        <div className="flex items-start">
          <Info className="h-5 w-5 text-purple-600 mr-3 mt-0.5" />
          <div className="text-sm text-purple-800">
            <p className="font-medium mb-1">What this checks:</p>
            <ul className="list-disc list-inside space-y-1">
              <li><strong>Chemical Risks</strong>: pH incompatibility, reactions between ingredients</li>
              <li><strong>Physical Risks</strong>: Precipitation, phase separation, cloudiness</li>
              <li><strong>Sensory Risks</strong>: Off-flavors, color changes, texture issues</li>
              <li><strong>Regulatory Risks</strong>: Ingredients exceeding allowed percentages</li>
              <li><strong>Formulation Validation</strong>: Total percentage should equal 100%</li>
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
                Select Formulation to Evaluate
              </label>
              <select
                value={selectedFormulationId}
                onChange={(e) => {
                  setSelectedFormulationId(e.target.value);
                  setResult(null);
                }}
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
                <h4 className="font-medium text-gray-900 mb-2">Formulation Details:</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className="text-gray-500">Type:</span>
                    <p className="font-medium">{selectedFormulation.beverage_type}</p>
                  </div>
                  <div>
                    <span className="text-gray-500">Ingredients:</span>
                    <p className="font-medium">{selectedFormulation.ingredients?.length || 0}</p>
                  </div>
                  <div>
                    <span className="text-gray-500">Total %:</span>
                    <p className={`font-medium ${
                      Math.abs((selectedFormulation.total_percentage || 0) - 100) < 0.1 
                        ? 'text-green-600' 
                        : 'text-red-600'
                    }`}>
                      {(selectedFormulation.total_percentage || 0).toFixed(2)}%
                    </p>
                  </div>
                  <div>
                    <span className="text-gray-500">Status:</span>
                    <p className="font-medium">{selectedFormulation.status}</p>
                  </div>
                </div>
                
                {selectedFormulation.ingredients && selectedFormulation.ingredients.length > 0 && (
                  <div className="mt-3 pt-3 border-t">
                    <span className="text-gray-500 text-sm">Ingredients: </span>
                    <span className="text-sm text-gray-700">
                      {selectedFormulation.ingredients.map(i => i.ingredient_name).join(', ')}
                    </span>
                  </div>
                )}
              </div>
            )}

            <button
              onClick={evaluateCompatibility}
              disabled={loading || !selectedFormulationId}
              className="w-full px-4 py-3 bg-sky-600 text-white rounded-md hover:bg-sky-700 disabled:opacity-50 flex items-center justify-center font-medium"
            >
              {loading ? (
                <>
                  <Shield className="h-5 w-5 mr-2 animate-pulse" />
                  Evaluating...
                </>
              ) : (
                <>
                  <Shield className="h-5 w-5 mr-2" />
                  Evaluate Compatibility
                </>
              )}
            </button>
          </div>
        )}

        {result && (
          <div className="mt-6 space-y-4">
            {/* Overall Score */}
            <div className={`rounded-lg p-6 ${
              result.overall_score >= 90 ? 'bg-green-50 border border-green-200' :
              result.overall_score >= 70 ? 'bg-yellow-50 border border-yellow-200' :
              result.overall_score >= 50 ? 'bg-orange-50 border border-orange-200' :
              'bg-red-50 border border-red-200'
            }`}>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Overall Compatibility Score</h3>
                  <p className="text-sm text-gray-600 mt-1">
                    {result.overall_score >= 90 ? 'Excellent - No significant issues detected' :
                     result.overall_score >= 70 ? 'Good - Minor issues may need attention' :
                     result.overall_score >= 50 ? 'Fair - Several issues detected' :
                     'Poor - Significant compatibility issues'}
                  </p>
                </div>
                <div className={`text-4xl font-bold ${
                  result.overall_score >= 90 ? 'text-green-600' :
                  result.overall_score >= 70 ? 'text-yellow-600' :
                  result.overall_score >= 50 ? 'text-orange-600' :
                  'text-red-600'
                }`}>
                  {result.overall_score}/100
                </div>
              </div>
              {result.evaluation_time_ms && (
                <p className="mt-2 text-xs text-gray-500">
                  Evaluation completed in {result.evaluation_time_ms}ms
                </p>
              )}
            </div>

            {/* Risks */}
            {result.risks && result.risks.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <div className="flex items-center mb-3">
                  <XCircle className="h-5 w-5 text-red-600 mr-2" />
                  <h3 className="text-lg font-semibold text-red-900">Critical Risks ({result.risks.length})</h3>
                </div>
                <ul className="space-y-2">
                  {result.risks.map((risk: any, idx: number) => (
                    <li key={idx} className="flex items-start text-sm text-red-800 bg-red-100 p-3 rounded">
                      <span className="font-medium capitalize mr-2">[{risk.type}]</span>
                      <span>{risk.description}</span>
                      {risk.severity && (
                        <span className="ml-auto px-2 py-0.5 bg-red-200 rounded text-xs font-medium">
                          {risk.severity}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Warnings */}
            {result.warnings && result.warnings.length > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <div className="flex items-center mb-3">
                  <AlertTriangle className="h-5 w-5 text-yellow-600 mr-2" />
                  <h3 className="text-lg font-semibold text-yellow-900">Warnings ({result.warnings.length})</h3>
                </div>
                <ul className="space-y-2">
                  {result.warnings.map((warning: any, idx: number) => (
                    <li key={idx} className="flex items-start text-sm text-yellow-800 bg-yellow-100 p-3 rounded">
                      <span className="font-medium capitalize mr-2">[{warning.type}]</span>
                      <span>{warning.description}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* All Clear */}
            {(!result.risks || result.risks.length === 0) &&
              (!result.warnings || result.warnings.length === 0) && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex items-center">
                    <CheckCircle className="h-6 w-6 text-green-600 mr-3" />
                    <div>
                      <h3 className="text-lg font-semibold text-green-900">All Clear!</h3>
                      <p className="text-sm text-green-700">No compatibility risks or warnings detected.</p>
                    </div>
                  </div>
                </div>
              )}

            {/* Checks Performed */}
            {result.checks_performed && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Checks Performed:</h3>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  {Object.entries(result.checks_performed).map(([check, passed]) => (
                    <div key={check} className="flex items-center text-sm">
                      <CheckCircle className={`h-4 w-4 mr-1 ${passed ? 'text-green-500' : 'text-gray-300'}`} />
                      <span className="text-gray-600 capitalize">{check.replace(/_/g, ' ')}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
