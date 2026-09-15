import axios from 'axios';
import { supabase } from './supabase';
import { normalizeApiError } from './errors';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1';
const API_KEY = import.meta.env.VITE_API_KEY;

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
    ...(API_KEY ? { 'x-api-key': API_KEY } : {}),
  },
});

api.interceptors.request.use(async (config) => {
  if (import.meta.env.MODE === 'e2e') {
    config.headers.Authorization = 'Bearer e2e-token';
    return config;
  }
  const { data } = await supabase.auth.getSession();
  if (data.session?.access_token) config.headers.Authorization = `Bearer ${data.session.access_token}`;
  return config;
});

api.interceptors.response.use(
  response => response,
  error => {
    const normalized = normalizeApiError(error);
    if (normalized.status === 401) window.dispatchEvent(new CustomEvent('beverageai:unauthorized'));
    return Promise.reject(normalized);
  },
);

// Ingredients API
export const ingredientsAPI = {
  getAll: (filters?: any) => api.get('/ingredients', { params: filters }),
  getById: (id: string) => api.get(`/ingredients/${id}`),
  getByCode: (code: string) => api.get(`/ingredients/code/${code}`),
  create: (data: any) => api.post('/ingredients', data),
  update: (id: string, data: any) => api.put(`/ingredients/${id}`, data),
  delete: (id: string) => api.delete(`/ingredients/${id}`),
  getCategories: () => api.get('/ingredients/meta/categories'),
  getStats: () => api.get('/ingredients/meta/stats'),
};

export const projectsAPI = {
  getAll: (filters?: { search?: string; status?: string; limit?: number; offset?: number }) => api.get('/projects', { params: filters }),
  getById: (id: string) => api.get(`/projects/${id}`),
  create: (data: any) => api.post('/projects', data),
  update: (id: string, data: any) => api.put(`/projects/${id}`, data),
  updateBrief: (id: string, brief: any, validate = false) => api.put(`/projects/${id}/brief`, { brief, validate }),
  transition: (id: string, stage: string, note = '') => api.post(`/projects/${id}/transition`, { stage, note }),
  createExperimentalPlan: (id: string, data: any) => api.post(`/projects/${id}/experimental-plans`, data),
  updateExperimentalPlan: (id: string, planId: string, data: any) => api.put(`/projects/${id}/experimental-plans/${planId}`, data),
  generateDoeDesign: (id: string, planId: string, data: any) => api.post(`/projects/${id}/experimental-plans/${planId}/design`, data),
  getDoeAnalysis: (id: string, planId: string) => api.get(`/projects/${id}/experimental-plans/${planId}/analysis`),
  exportDoeReport: (id: string, planId: string) => api.get(`/projects/${id}/experimental-plans/${planId}/report.csv`, { responseType: 'blob' }),
  createPilotBatch: (id: string, planId: string, data: any) => api.post(`/projects/${id}/experimental-plans/${planId}/pilot-batches`, data),
  updatePilotBatch: (id: string, batchId: string, data: any) => api.put(`/projects/${id}/pilot-batches/${batchId}`, data),
  createMilestone: (id: string, data: any) => api.post(`/projects/${id}/milestones`, data),
  updateMilestone: (id: string, milestoneId: string, data: any) => api.put(`/projects/${id}/milestones/${milestoneId}`, data),
  recordDecision: (id: string, data: any) => api.post(`/projects/${id}/decisions`, data),
};

// Formulations API
export const formulationsAPI = {
  getAll: (filters?: any) => api.get('/formulations', { params: filters }),
  getById: (id: string, includeIngredients = true) => 
    api.get(`/formulations/${id}`, { params: { include_ingredients: includeIngredients } }),
  create: (data: any) => api.post('/formulations', data),
  update: (id: string, data: any) => api.put(`/formulations/${id}`, data),
  delete: (id: string) => api.delete(`/formulations/${id}`),
  createVersion: (id: string, data: any) => api.post(`/formulations/${id}/versions`, data),
  getVersions: (id: string) => api.get(`/formulations/${id}/versions`),
  approve: (id: string, note: string) => api.post(`/formulations/${id}/approve`, { note }),
  getNutrition: (id: string) => api.get(`/formulations/${id}/nutrition`),
  getCost: (id: string, batchSize = 1) => 
    api.get(`/formulations/${id}/cost`, { params: { batch_size: batchSize } }),
  getLaboratoryResults: (id: string) => api.get(`/formulations/${id}/laboratory-results`),
  getSensoryAnalytics: (id: string) => api.get(`/formulations/${id}/sensory-analytics`),
  addLaboratoryResult: (id: string, data: any) => api.post(`/formulations/${id}/laboratory-results`, data),
  updateLaboratoryResult: (id: string, resultId: string, data: any) => api.put(`/formulations/${id}/laboratory-results/${resultId}`, data),
  deleteLaboratoryResult: (id: string, resultId: string) => api.delete(`/formulations/${id}/laboratory-results/${resultId}`),
  importLaboratoryResults: (id: string, rows: any[]) => api.post(`/formulations/${id}/laboratory-results/import`, { rows }),
};

export const laboratoryAPI = {
  getLearningSummary: () => api.get('/ai/learning-feedback/summary'),
};

export const sensoryAPI = {
  getStudies: () => api.get('/sensory/studies'),
  getStudy: (id: string) => api.get(`/sensory/studies/${id}`),
  createStudy: (data: any) => api.post('/sensory/studies', data),
  updateStudy: (id: string, data: any) => api.put(`/sensory/studies/${id}`, data),
  updateStatus: (id: string, status: string) => api.put(`/sensory/studies/${id}/status`, { status }),
  getResponses: (id: string) => api.get(`/sensory/studies/${id}/responses`),
  addResponse: (id: string, data: any) => api.post(`/sensory/studies/${id}/responses`, data),
  importResponses: (id: string, rows: any[]) => api.post(`/sensory/studies/${id}/responses/import`, { rows }),
  getAnalytics: (id: string) => api.get(`/sensory/studies/${id}/analytics`),
};

// Compatibility API
export const compatibilityAPI = {
  getIngredientCompatibility: (ingredientAId: string, ingredientBId: string) =>
    api.get(`/compatibility/ingredients/${ingredientAId}/${ingredientBId}`),
  evaluateFormulation: (formulationId: string) =>
    api.get(`/compatibility/formulations/${formulationId}`),
  batchCompute: (ingredientIds?: string[]) =>
    api.post('/compatibility/batch-compute', { ingredient_ids: ingredientIds }),
};

// AI API
export const aiAPI = {
  getGovernance: () => api.get('/ai/governance'),
  updatePreferences: (data: { external_processing_enabled: boolean; include_formulation_name: boolean }) =>
    api.put('/ai/preferences', data),
  generateVariants: (formulationId: string, options: any) =>
    api.post(`/ai/formulations/${formulationId}/generate`, options),
  getVariants: (formulationId: string, filters?: any) =>
    api.get(`/ai/formulations/${formulationId}/variants`, { params: filters }),
  acceptVariant: (variantId: string, data: any) =>
    api.post(`/ai/variants/${variantId}/accept`, data),
  getInsight: (domain: 'laboratory' | 'sensory' | 'regulatory' | 'cost' | 'formulation', context: Record<string, unknown>) =>
    api.post('/ai/insights', { domain, context }),
};

// Target Generation API
export const targetGenerationAPI = {
  generate: (constraints: any) => api.post('/target-generation/generate', constraints),
  save: (data: { candidate?: any; run_id?: string; candidate_id?: string; project_id?: string; name: string }) => api.post('/target-generation/save', data),
  getRuns: (filters?: any) => api.get('/target-generation/runs', { params: filters }),
  getRun: (id: string) => api.get(`/target-generation/runs/${id}`),
};

export const accountAPI = {
  getMe: () => api.get('/auth/me'),
  updateProfile: (displayName: string) => api.put('/auth/profile', { display_name: displayName }),
  getAudit: (filters?: any) => api.get('/audit', { params: filters }),
  getUsers: () => api.get('/admin/users'),
  updateUserRole: (id: string, role: string) => api.put(`/admin/users/${id}/role`, { role }),
};

// Regulatory API
export const regulatoryAPI = {
  checkCompliance: (formulationId: string) =>
    api.post(`/regulatory/formulations/${formulationId}/check`, {}),
  getCompliance: (formulationId: string) =>
    api.get(`/regulatory/formulations/${formulationId}/compliance`),
  generateLabels: (formulationId: string, options?: any) =>
    api.post(`/regulatory/formulations/${formulationId}/labels`, options || {}),
  getLabels: (formulationId: string, language?: string) =>
    api.get(`/regulatory/formulations/${formulationId}/labels`, { params: { language } }),
};

// Cost API
export const costAPI = {
  calculateBatchCost: (formulationId: string, data: any) =>
    api.post(`/cost/formulations/${formulationId}/batch-cost`, data),
  getBatchCosts: (formulationId: string, filters?: any) =>
    api.get(`/cost/formulations/${formulationId}/batch-costs`, { params: filters }),
  compareBatchSizes: (formulationId: string, sizes?: number[]) =>
    api.get(`/cost/formulations/${formulationId}/compare-batch-sizes`, { 
      params: { sizes: sizes?.join(',') } 
    }),
  calculateROI: (formulationId: string, data: any) =>
    api.post(`/cost/formulations/${formulationId}/roi`, data),
  addPricingHistory: (ingredientId: string, data: any) =>
    api.post(`/cost/ingredients/${ingredientId}/pricing`, data),
  getPricingHistory: (ingredientId: string, filters?: any) =>
    api.get(`/cost/ingredients/${ingredientId}/pricing`, { params: filters }),
};

export default api;
