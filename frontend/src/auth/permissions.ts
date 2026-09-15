import type { AppProfile } from './AuthContext';

export type UserRole = AppProfile['role'];
export type Permission =
  | 'manage_users' | 'manage_ingredients' | 'manage_projects' | 'manage_formulations' | 'approve_formulations'
  | 'manage_lab' | 'manage_sensory' | 'manage_stability' | 'approve_specifications'
  | 'manage_suppliers' | 'approve_supplier_materials' | 'manage_packaging' | 'approve_packaging'
  | 'manage_production_trials' | 'perform_qc_release' | 'manage_quality_events' | 'manage_capa'
  | 'manage_regulatory' | 'manage_ai_preferences';

export const USER_ROLES: UserRole[] = ['admin', 'rd_manager', 'formulator', 'lab', 'sensory', 'qa', 'regulatory', 'procurement', 'viewer'];

const ALL_PERMISSIONS: Permission[] = [
  'manage_users', 'manage_ingredients', 'manage_projects', 'manage_formulations', 'approve_formulations',
  'manage_lab', 'manage_sensory', 'manage_stability', 'approve_specifications', 'manage_suppliers',
  'approve_supplier_materials', 'manage_packaging', 'approve_packaging', 'manage_production_trials',
  'perform_qc_release', 'manage_quality_events', 'manage_capa', 'manage_regulatory', 'manage_ai_preferences',
];

export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  admin: ALL_PERMISSIONS,
  rd_manager: ['manage_projects', 'manage_formulations', 'approve_formulations', 'manage_lab', 'manage_sensory', 'manage_stability', 'approve_specifications', 'manage_production_trials', 'manage_ai_preferences'],
  formulator: ['manage_projects', 'manage_formulations', 'manage_production_trials', 'manage_ai_preferences'],
  lab: ['manage_lab', 'manage_stability', 'manage_ai_preferences'],
  sensory: ['manage_sensory', 'manage_ai_preferences'],
  qa: ['manage_stability', 'approve_specifications', 'perform_qc_release', 'manage_quality_events', 'manage_capa', 'manage_ai_preferences'],
  regulatory: ['manage_regulatory', 'manage_ai_preferences'],
  procurement: ['manage_suppliers', 'approve_supplier_materials', 'manage_packaging', 'approve_packaging', 'manage_ai_preferences'],
  viewer: [],
};

export const WORKSPACE_ROLES: UserRole[] = USER_ROLES.filter(role => role !== 'viewer');
export const PROJECT_ROLES: UserRole[] = ['admin', 'rd_manager', 'formulator', 'lab', 'sensory', 'qa', 'regulatory', 'procurement'];
export const LAB_ROLES: UserRole[] = ['admin', 'rd_manager', 'lab'];
export const SENSORY_ROLES: UserRole[] = ['admin', 'rd_manager', 'sensory'];
export const FORMULATION_ROLES: UserRole[] = ['admin', 'rd_manager', 'formulator'];
export const REGULATORY_ROLES: UserRole[] = ['admin', 'regulatory'];
export const COST_ROLES: UserRole[] = ['admin', 'rd_manager', 'formulator', 'procurement'];

export function hasRole(role: UserRole | undefined, allowed?: readonly UserRole[]) {
  return !allowed || (role !== undefined && allowed.includes(role));
}

export function hasPermission(role: UserRole | undefined, permission: Permission) {
  return Boolean(role && ROLE_PERMISSIONS[role].includes(permission));
}

export function canManageFormulations(role: UserRole | undefined) {
  return hasPermission(role, 'manage_formulations');
}

export function canManageIngredients(role: UserRole | undefined) {
  return hasPermission(role, 'manage_ingredients');
}
