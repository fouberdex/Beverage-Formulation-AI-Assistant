import type { AppProfile } from './AuthContext';

export type UserRole = AppProfile['role'];

export const WORKSPACE_ROLES: UserRole[] = ['admin', 'formulator'];

export function hasRole(role: UserRole | undefined, allowed?: readonly UserRole[]) {
  return !allowed || (role !== undefined && allowed.includes(role));
}

export function canManageFormulations(role: UserRole | undefined) {
  return role === 'admin' || role === 'formulator';
}

export function canManageIngredients(role: UserRole | undefined) {
  return role === 'admin';
}
