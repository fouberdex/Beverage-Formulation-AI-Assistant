import { useState, useEffect } from 'react';
import { costAPI, formulationsAPI } from '../services/api';
import { Formulation } from '../types';
import { DollarSign, TrendingUp, Calculator, Loader, Info } from 'lucide-react';
import StatusMessage from '../components/StatusMessage';
import { getErrorMessage } from '../services/errors';

export default function CostPage() {
  const [formulations, setFormulations] = useState<Formulation[]>([]);
  const [selectedFormulationId, setSelectedFormulationId] = useState('');
  const [batchSize, setBatchSize] = useState('1000');
  const [overheadPercent, setOverheadPercent] = useState('15');
  const [marginPercent, setMarginPercent] = useState('30');
  const [sellingPrice, setSellingPrice] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingFormulations, setLoadingFormulations] = useState(true);
  const [costData, setCostData] = useState<any>(null);
  const [comparisons, setComparisons] = useState<any[]>([]);
  const [roiData, setRoiData] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'cost' | 'compare' | 'roi'>('cost');
  const [error, setError] = useState('');

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
      setError(getErrorMessage(error, 'Unable to load formulations.'));
    } finally {
      setLoadingFormulations(false);
    }
  }

  async function calculateCost() {
    if (!selectedFormulationId) return;

    setLoading(true);
    setError('');
    setCostData(null);
    try {
      const res = await costAPI.calculateBatchCost(selectedFormulationId, {
        batch_size_liters: parseFloat(batchSize),
        overhead_percent: parseFloat(overheadPercent),
        margin_percent: parseFloat(marginPercent),
      });
      setCostData(res.data.data);
      setActiveTab('cost');
    } catch (error) {
      setError(getErrorMessage(error, 'Unable to calculate cost.'));
    } finally {
      setLoading(false);
    }
  }

  async function compareBatchSizes() {
    if (!selectedFormulationId) return;

    setLoading(true);
    setError('');
    setComparisons([]);
    try {
      const res = await costAPI.compareBatchSizes(selectedFormulationId, [1, 10, 100, 1000, 10000]);
      setComparisons(res.data.data);
      setActiveTab('compare');
    } catch (error) {
      setError(getErrorMessage(error, 'Unable to compare batch sizes.'));
    } finally {
      setLoading(false);
    }
  }

  async function calculateROI() {
    if (!selectedFormulationId || !sellingPrice) {
      setError('Please enter a selling price per liter.');
      return;
    }

    setLoading(true);
    setError('');
    setRoiData(null);
    try {
      const res = await costAPI.calculateROI(selectedFormulationId, {
        batch_size_liters: parseFloat(batchSize),
        selling_price_per_liter: parseFloat(sellingPrice),
      });
      setRoiData(res.data.data);
      setActiveTab('roi');
    } catch (error) {
      setError(getErrorMessage(error, 'Unable to calculate ROI.'));
    } finally {
      setLoading(false);
    }
  }

  const selectedFormulation = formulations.find(f => f.id === selectedFormulationId);

  return (
    <div className="pb-8">
      <div className="px-4 py-5 sm:px-6">
        <h1 className="text-2xl font-bold text-gray-900">Cost & ROI Analysis</h1>
        <p className="mt-1 text-sm text-gray-500">
          Batch costing (1L → 10,000L) with ROI estimation
        </p>
      </div>
      <div className="mx-4 mb-4"><StatusMessage error={error} /></div>

      {/* Info Box */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6 mx-4">
        <div className="flex items-start">
          <Info className="h-5 w-5 text-blue-600 mr-3 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-blue-800">
            <p className="font-medium mb-1">Cost Analysis Features:</p>
            <ul className="list-disc list-inside space-y-1">
              <li><strong>Batch Costing</strong>: Calculate total cost for any batch size</li>
              <li><strong>Compare Sizes</strong>: See cost efficiency at different volumes</li>
              <li><strong>ROI Calculator</strong>: Estimate profit and return on investment</li>
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
                Select Formulation
              </label>
              <select
                value={selectedFormulationId}
                onChange={(e) => {
                  setSelectedFormulationId(e.target.value);
                  setCostData(null);
                  setComparisons([]);
                  setRoiData(null);
                }}
                className="w-full rounded-md border-gray-300 shadow-sm focus:border-sky-500 focus:ring-sky-500 border p-2"
              >
                {formulations.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} - Cost/L: {(f.total_cost_per_liter || 0).toFixed(2)} DZD
                  </option>
                ))}
              </select>
            </div>

            {selectedFormulation && (
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="font-medium text-gray-900 mb-2">Base Cost Information:</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className="text-gray-500">Ingredient Cost:</span>
                    <p className="font-medium text-lg">{(selectedFormulation.total_cost_per_liter || 0).toFixed(2)} DZD/L</p>
                  </div>
                  <div>
                    <span className="text-gray-500">Calories:</span>
                    <p className="font-medium">{(selectedFormulation.total_calories_per_100ml || 0).toFixed(1)}/100ml</p>
                  </div>
                  <div>
                    <span className="text-gray-500">Sugar:</span>
                    <p className="font-medium">{(selectedFormulation.total_sugar_per_100ml || 0).toFixed(1)}g/100ml</p>
                  </div>
                  <div>
                    <span className="text-gray-500">Ingredients:</span>
                    <p className="font-medium">{selectedFormulation.ingredients?.length || 0}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Parameters */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Batch Size (Liters)
                </label>
                <input
                  type="number"
                  value={batchSize}
                  onChange={(e) => setBatchSize(e.target.value)}
                  min="1"
                  className="w-full rounded-md border p-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Overhead %
                </label>
                <input
                  type="number"
                  value={overheadPercent}
                  onChange={(e) => setOverheadPercent(e.target.value)}
                  min="0"
                  max="100"
                  className="w-full rounded-md border p-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Margin %
                </label>
                <input
                  type="number"
                  value={marginPercent}
                  onChange={(e) => setMarginPercent(e.target.value)}
                  min="0"
                  max="100"
                  className="w-full rounded-md border p-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Selling Price (DZD/L)
                </label>
                <input
                  type="number"
                  value={sellingPrice}
                  onChange={(e) => setSellingPrice(e.target.value)}
                  placeholder="For ROI calc"
                  min="0"
                  className="w-full rounded-md border p-2"
                />
              </div>
            </div>

            {/* Action Buttons */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <button
                onClick={calculateCost}
                disabled={loading || !selectedFormulationId}
                className="px-4 py-3 bg-sky-700 text-white rounded-md hover:bg-sky-800 disabled:opacity-50 flex items-center justify-center font-medium"
              >
                {loading && activeTab === 'cost' ? (
                  <Loader className="h-5 w-5 mr-2 animate-spin" />
                ) : (
                  <Calculator className="h-5 w-5 mr-2" />
                )}
                Calculate Cost
              </button>
              <button
                onClick={compareBatchSizes}
                disabled={loading || !selectedFormulationId}
                className="px-4 py-3 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 flex items-center justify-center font-medium"
              >
                {loading && activeTab === 'compare' ? (
                  <Loader className="h-5 w-5 mr-2 animate-spin" />
                ) : (
                  <TrendingUp className="h-5 w-5 mr-2" />
                )}
                Compare Sizes
              </button>
              <button
                onClick={calculateROI}
                disabled={loading || !selectedFormulationId}
                className="px-4 py-3 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:opacity-50 flex items-center justify-center font-medium"
              >
                {loading && activeTab === 'roi' ? (
                  <Loader className="h-5 w-5 mr-2 animate-spin" />
                ) : (
                  <DollarSign className="h-5 w-5 mr-2" />
                )}
                Calculate ROI
              </button>
            </div>
          </div>
        )}

        {/* Results */}
        {(costData || comparisons.length > 0 || roiData) && (
          <div className="mt-6 border-t pt-6">
            {/* Tabs */}
            <div className="flex border-b mb-4 overflow-x-auto">
              <button
                onClick={() => setActiveTab('cost')}
                className={`px-4 py-2 font-medium text-sm border-b-2 -mb-px whitespace-nowrap ${
                  activeTab === 'cost'
                    ? 'border-sky-600 text-sky-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Cost Breakdown
              </button>
              <button
                onClick={() => setActiveTab('compare')}
                className={`px-4 py-2 font-medium text-sm border-b-2 -mb-px whitespace-nowrap ${
                  activeTab === 'compare'
                    ? 'border-sky-600 text-sky-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Size Comparison
              </button>
              <button
                onClick={() => setActiveTab('roi')}
                className={`px-4 py-2 font-medium text-sm border-b-2 -mb-px whitespace-nowrap ${
                  activeTab === 'roi'
                    ? 'border-sky-600 text-sky-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                ROI Analysis
              </button>
            </div>

            {/* Cost Tab */}
            {activeTab === 'cost' && costData && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-900">
                  Cost Breakdown for {costData.batch_size_liters?.toLocaleString()}L Batch
                </h3>
                
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <CostCard 
                    label="Ingredient Cost" 
                    value={costData.breakdown?.ingredient_cost} 
                    color="blue"
                  />
                  <CostCard 
                    label="Overhead Cost" 
                    value={costData.breakdown?.overhead_cost} 
                    color="orange"
                  />
                  <CostCard 
                    label="Total Cost" 
                    value={costData.breakdown?.total_cost} 
                    color="red"
                  />
                  <CostCard 
                    label="+ Margin" 
                    value={costData.breakdown?.margin} 
                    color="green"
                  />
                </div>

                <div className="bg-sky-50 border border-sky-200 rounded-lg p-6">
                  <div className="text-center">
                    <p className="text-sky-600 text-sm font-medium">Final Selling Price</p>
                    <p className="text-4xl font-bold text-sky-700">
                      {costData.breakdown?.final_price?.toLocaleString(undefined, { maximumFractionDigits: 2 })} DZD
                    </p>
                    <p className="text-sky-500 text-sm mt-1">
                      ({costData.per_liter?.final_price?.toFixed(2)} DZD per liter)
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 text-center">
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <p className="text-gray-500 text-sm">Cost per Liter</p>
                    <p className="text-xl font-bold text-gray-900">
                      {costData.per_liter?.total_cost?.toFixed(2)} DZD
                    </p>
                  </div>
                  <div className="bg-green-50 p-4 rounded-lg">
                    <p className="text-green-700 text-sm">Est. Profit</p>
                    <p className="text-xl font-bold text-green-700">
                      {costData.breakdown?.estimated_profit?.toLocaleString(undefined, { maximumFractionDigits: 2 })} DZD
                    </p>
                  </div>
                  <div className="bg-purple-50 p-4 rounded-lg">
                    <p className="text-purple-600 text-sm">Est. ROI</p>
                    <p className="text-xl font-bold text-purple-700">
                      {costData.breakdown?.roi_percent?.toFixed(1)}%
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Compare Tab */}
            {activeTab === 'compare' && comparisons.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Batch Size Comparison</h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Batch Size
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Cost/Liter
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Total Cost
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Price/Liter
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          ROI %
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {comparisons.map((comp, idx) => (
                        <tr key={idx}>
                          <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                            {comp.batch_size_liters?.toLocaleString()} L
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                            {comp.cost_per_liter?.toFixed(2)} DZD
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                            {comp.total_cost?.toLocaleString(undefined, { maximumFractionDigits: 2 })} DZD
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                            {comp.final_price_per_liter?.toFixed(2)} DZD
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm">
                            <span className={`font-medium ${comp.roi_percent >= 25 ? 'text-green-700' : 'text-gray-600'}`}>
                              {comp.roi_percent?.toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  * Per-liter ingredient cost stays constant until quantity-tier supplier pricing is configured. Packaging, labor, freight, tax, and process loss are not included.
                </p>
              </div>
            )}

            {/* ROI Tab */}
            {activeTab === 'roi' && roiData && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-900">ROI Analysis</h3>
                
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <p className="text-gray-500 text-sm">Batch Size</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {roiData.batch_size_liters?.toLocaleString()} L
                    </p>
                  </div>
                  <div className="bg-red-50 p-4 rounded-lg">
                    <p className="text-red-600 text-sm">Total Cost</p>
                    <p className="text-2xl font-bold text-red-700">
                      {roiData.total_cost?.toLocaleString(undefined, { maximumFractionDigits: 2 })} DZD
                    </p>
                  </div>
                  <div className="bg-blue-50 p-4 rounded-lg">
                    <p className="text-blue-600 text-sm">Selling Price/L</p>
                    <p className="text-2xl font-bold text-blue-700">
                      {roiData.selling_price_per_liter?.toFixed(2)} DZD
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-sky-50 p-6 rounded-lg text-center">
                    <p className="text-sky-600 text-sm font-medium">Total Revenue</p>
                    <p className="text-3xl font-bold text-sky-700">
                      {roiData.total_revenue?.toLocaleString(undefined, { maximumFractionDigits: 2 })} DZD
                    </p>
                  </div>
                  <div className="bg-green-50 p-6 rounded-lg text-center">
                    <p className="text-green-700 text-sm font-medium">Profit</p>
                    <p className={`text-3xl font-bold ${roiData.profit >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                      {roiData.profit?.toLocaleString(undefined, { maximumFractionDigits: 2 })} DZD
                    </p>
                  </div>
                </div>

                <div className={`p-6 rounded-lg text-center ${roiData.roi_percent >= 0 ? 'bg-purple-50' : 'bg-red-50'}`}>
                  <p className={`text-sm font-medium ${roiData.roi_percent >= 0 ? 'text-purple-600' : 'text-red-600'}`}>
                    Return on Investment
                  </p>
                  <p className={`text-5xl font-bold ${roiData.roi_percent >= 0 ? 'text-purple-700' : 'text-red-700'}`}>
                    {roiData.roi_percent?.toFixed(1)}%
                  </p>
                  <p className="text-sm text-gray-500 mt-2">
                    Break-even price: {roiData.break_even_price?.toFixed(2)} DZD/L
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CostCard({ label, value, color }: { label: string; value: number; color: string }) {
  const colorClasses = {
    blue: 'bg-blue-50 text-blue-700',
    orange: 'bg-orange-50 text-orange-700',
    red: 'bg-red-50 text-red-700',
    green: 'bg-green-50 text-green-700',
  };

  return (
    <div className={`p-4 rounded-lg ${colorClasses[color as keyof typeof colorClasses]}`}>
      <p className="text-sm opacity-75">{label}</p>
      <p className="text-xl font-bold">
        {value?.toLocaleString(undefined, { maximumFractionDigits: 2 })} DZD
      </p>
    </div>
  );
}
