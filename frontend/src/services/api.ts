import axios from 'axios';
import { supabase } from './supabase';

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
  const { data } = await supabase.auth.getSession();
  if (data.session?.access_token) config.headers.Authorization = `Bearer ${data.session.access_token}`;
  return config;
});

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
  getNutrition: (id: string) => api.get(`/formulations/${id}/nutrition`),
  getCost: (id: string, batchSize = 1) => 
    api.get(`/formulations/${id}/cost`, { params: { batch_size: batchSize } }),
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
  generateVariants: (formulationId: string, options: any) =>
    api.post(`/ai/formulations/${formulationId}/generate`, options),
  getVariants: (formulationId: string, filters?: any) =>
    api.get(`/ai/formulations/${formulationId}/variants`, { params: filters }),
  acceptVariant: (variantId: string, data: any) =>
    api.post(`/ai/variants/${variantId}/accept`, data),
};

// Target Generation API
export const targetGenerationAPI = {
  generate: (constraints: any) => api.post('/target-generation/generate', constraints),
  save: (data: { candidate: any; name: string }) => api.post('/target-generation/save', data),
};

// Regulatory API
export const regulatoryAPI = {
  checkCompliance: (formulationId: string) =>
    api.post(`/regulatory/formulations/${formulationId}/check`),
  getCompliance: (formulationId: string) =>
    api.get(`/regulatory/formulations/${formulationId}/compliance`),
  generateLabels: (formulationId: string) =>
    api.post(`/regulatory/formulations/${formulationId}/labels`),
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
