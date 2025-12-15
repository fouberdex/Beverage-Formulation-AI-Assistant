import { useState, useEffect } from 'react';
import { regulatoryAPI, formulationsAPI } from '../services/api';
import { Formulation } from '../types';
import { Shield, CheckCircle, XCircle, FileText, Loader, Info } from 'lucide-react';

export default function RegulatoryPage() {
  const [formulations, setFormulations] = useState<Formulation[]>([]);
  const [selectedFormulationId, setSelectedFormulationId] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingFormulations, setLoadingFormulations] = useState(true);
  const [compliance, setCompliance] = useState<any>(null);
  const [labels, setLabels] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'compliance' | 'labels'>('compliance');

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

  async function checkCompliance() {
    if (!selectedFormulationId) return;

    setLoading(true);
    setCompliance(null);
    try {
      const res = await regulatoryAPI.checkCompliance(selectedFormulationId);
      setCompliance(res.data.data);
    } catch (error: any) {
      alert(error.response?.data?.error || 'Error checking compliance');
    } finally {
      setLoading(false);
    }
  }

  async function generateLabels() {
    if (!selectedFormulationId) return;

    setLoading(true);
    setLabels(null);
    try {
      const res = await regulatoryAPI.generateLabels(selectedFormulationId);
      setLabels(res.data.data);
      setActiveTab('labels');
    } catch (error: any) {
      alert(error.response?.data?.error || 'Error generating labels');
    } finally {
      setLoading(false);
    }
  }

  const selectedFormulation = formulations.find(f => f.id === selectedFormulationId);

  return (
    <div className="pb-8">
      <div className="px-4 py-5 sm:px-6">
        <h1 className="text-2xl font-bold text-gray-900">Regulatory & Labeling</h1>
        <p className="mt-1 text-sm text-gray-500">
          Algerian compliance, Halal validation, and label generation (AR/FR/EN)
        </p>
      </div>

      {/* Info Box */}
      <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6 mx-4">
        <div className="flex items-start">
          <Info className="h-5 w-5 text-green-600 mr-3 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-green-800">
            <p className="font-medium mb-1">Compliance Checks Include:</p>
            <ul className="list-disc list-inside space-y-1">
              <li><strong>Halal</strong>: All ingredients must be Halal certified</li>
              <li><strong>Kosher</strong>: Kosher certification status</li>
              <li><strong>Vegan</strong>: No animal-derived ingredients</li>
              <li><strong>Algerian Regulations</strong>: Max percentages, restricted ingredients</li>
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
                  setCompliance(null);
                  setLabels(null);
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
                    <p className="font-medium">{(selectedFormulation.total_percentage || 0).toFixed(2)}%</p>
                  </div>
                  <div>
                    <span className="text-gray-500">Status:</span>
                    <p className="font-medium">{selectedFormulation.status}</p>
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={checkCompliance}
                disabled={loading || !selectedFormulationId}
                className="flex-1 px-4 py-3 bg-sky-600 text-white rounded-md hover:bg-sky-700 disabled:opacity-50 flex items-center justify-center font-medium"
              >
                {loading && activeTab === 'compliance' ? (
                  <Loader className="h-5 w-5 mr-2 animate-spin" />
                ) : (
                  <Shield className="h-5 w-5 mr-2" />
                )}
                Check Compliance
              </button>
              <button
                onClick={generateLabels}
                disabled={loading || !selectedFormulationId}
                className="flex-1 px-4 py-3 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 flex items-center justify-center font-medium"
              >
                {loading && activeTab === 'labels' ? (
                  <Loader className="h-5 w-5 mr-2 animate-spin" />
                ) : (
                  <FileText className="h-5 w-5 mr-2" />
                )}
                Generate Labels
              </button>
            </div>
          </div>
        )}

        {/* Results */}
        {(compliance || labels) && (
          <div className="mt-6 border-t pt-6">
            {/* Tabs */}
            <div className="flex border-b mb-4">
              <button
                onClick={() => setActiveTab('compliance')}
                className={`px-4 py-2 font-medium text-sm border-b-2 -mb-px ${
                  activeTab === 'compliance'
                    ? 'border-sky-600 text-sky-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Compliance Results
              </button>
              <button
                onClick={() => setActiveTab('labels')}
                className={`px-4 py-2 font-medium text-sm border-b-2 -mb-px ${
                  activeTab === 'labels'
                    ? 'border-sky-600 text-sky-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Generated Labels
              </button>
            </div>

            {/* Compliance Tab */}
            {activeTab === 'compliance' && compliance && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-900">Compliance Status</h3>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <ComplianceItem
                    label="Halal Compliant"
                    value={compliance.is_halal_compliant}
                  />
                  <ComplianceItem
                    label="Kosher Compliant"
                    value={compliance.is_kosher_compliant}
                  />
                  <ComplianceItem
                    label="Vegan Compliant"
                    value={compliance.is_vegan_compliant}
                  />
                  <ComplianceItem
                    label="Algerian Regulatory"
                    value={compliance.algerian_regulatory_compliant}
                  />
                </div>

                {compliance.violations && compliance.violations.length > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <div className="flex items-center mb-3">
                      <XCircle className="h-5 w-5 text-red-600 mr-2" />
                      <h4 className="font-semibold text-red-900">Violations ({compliance.violations.length})</h4>
                    </div>
                    <ul className="space-y-2">
                      {compliance.violations.map((violation: any, idx: number) => (
                        <li key={idx} className="flex items-start text-sm text-red-800 bg-red-100 p-3 rounded">
                          <span className="font-medium capitalize mr-2">[{violation.type}]</span>
                          <span>{violation.ingredient && `${violation.ingredient}: `}{violation.message}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {(!compliance.violations || compliance.violations.length === 0) && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <div className="flex items-center">
                      <CheckCircle className="h-6 w-6 text-green-600 mr-3" />
                      <div>
                        <h4 className="font-semibold text-green-900">All Compliance Checks Passed!</h4>
                        <p className="text-sm text-green-700">{compliance.compliance_notes}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Labels Tab */}
            {activeTab === 'labels' && labels && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-900">Generated Labels</h3>
                <p className="text-sm text-gray-500">Labels generated in Arabic, French, and English for regulatory compliance.</p>
                
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {labels.ar && (
                    <LabelCard title="Arabic (العربية)" language="ar" data={labels.ar} />
                  )}
                  {labels.fr && (
                    <LabelCard title="French (Français)" language="fr" data={labels.fr} />
                  )}
                  {labels.en && (
                    <LabelCard title="English" language="en" data={labels.en} />
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ComplianceItem({ label, value }: { label: string; value: boolean }) {
  return (
    <div className={`flex items-center justify-between p-4 rounded-lg ${value ? 'bg-green-50' : 'bg-red-50'}`}>
      <span className="text-sm font-medium text-gray-700">{label}</span>
      {value ? (
        <CheckCircle className="h-6 w-6 text-green-600" />
      ) : (
        <XCircle className="h-6 w-6 text-red-600" />
      )}
    </div>
  );
}

function LabelCard({ title, language, data }: { title: string; language: string; data: any }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className={`px-4 py-2 font-medium text-white ${
        language === 'ar' ? 'bg-green-600' : language === 'fr' ? 'bg-blue-600' : 'bg-purple-600'
      }`}>
        {title}
      </div>
      <div className="p-4">
        <div className={language === 'ar' ? 'text-right' : ''} dir={language === 'ar' ? 'rtl' : 'ltr'}>
          <h4 className="font-bold text-lg mb-3">{data.name}</h4>
          
          <div className="mb-3">
            <p className="text-sm font-medium text-gray-700 mb-1">
              {language === 'ar' ? 'المكونات:' : language === 'fr' ? 'Ingrédients:' : 'Ingredients:'}
            </p>
            <div className="text-sm text-gray-600 space-y-1">
              {data.ingredients?.map((ing: any, idx: number) => (
                <div key={idx} className="flex justify-between">
                  <span>{ing.name}</span>
                  <span className="font-medium">{ing.percentage?.toFixed(2)}%</span>
                </div>
              ))}
            </div>
          </div>

          {data.nutrition && (
            <div className="border-t pt-3">
              <p className="text-sm font-medium text-gray-700 mb-1">
                {language === 'ar' ? 'القيم الغذائية:' : language === 'fr' ? 'Valeurs Nutritionnelles:' : 'Nutrition Facts:'}
              </p>
              <div className="text-sm text-gray-600">
                <p>{language === 'ar' ? 'السعرات:' : language === 'fr' ? 'Calories:' : 'Calories:'} {data.nutrition.calories}</p>
                <p>{language === 'ar' ? 'السكر:' : language === 'fr' ? 'Sucre:' : 'Sugar:'} {data.nutrition.sugar}g</p>
              </div>
            </div>
          )}

          {data.halal && (
            <div className="mt-3 flex items-center text-green-600">
              <CheckCircle className="h-4 w-4 mr-1" />
              <span className="text-sm font-medium">
                {language === 'ar' ? 'حلال' : language === 'fr' ? 'Halal' : 'Halal Certified'}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
