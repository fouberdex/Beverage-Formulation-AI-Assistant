export const USER_ROLES = Object.freeze({
  ADMIN: 'admin',
  FORMULATOR: 'formulator',
  VIEWER: 'viewer',
});

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function authorizeApiRequest({ method, path, role }) {
  // Administrative resources contain sensitive account data even when the
  // operation is read-only, so this check must precede the safe-method rule.
  if (path.startsWith('/api/v1/admin/') && role !== USER_ROLES.ADMIN) {
    return { allowed: false, reason: 'Administrator access is required' };
  }

  if (SAFE_METHODS.has(method)) return { allowed: true };

  // Every authenticated user may maintain their own account profile.
  if (path === '/api/v1/auth/profile' || path === '/api/v1/ai/preferences') return { allowed: true };

  if (role === USER_ROLES.VIEWER) {
    return { allowed: false, reason: 'This account has read-only access' };
  }

  const changesSharedIngredientData =
    path === '/api/v1/ingredients' ||
    path.startsWith('/api/v1/ingredients/') ||
    path.startsWith('/api/v1/cost/ingredients/');

  if (changesSharedIngredientData && role !== USER_ROLES.ADMIN) {
    return { allowed: false, reason: 'Administrator access is required to change the shared ingredient catalog' };
  }

  return { allowed: true };
}
