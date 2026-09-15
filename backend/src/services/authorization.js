export const USER_ROLES = Object.freeze({
  ADMIN: 'admin',
  RD_MANAGER: 'rd_manager',
  FORMULATOR: 'formulator',
  LAB: 'lab',
  SENSORY: 'sensory',
  QA: 'qa',
  REGULATORY: 'regulatory',
  PROCUREMENT: 'procurement',
  VIEWER: 'viewer',
});

export const PERMISSIONS = Object.freeze({
  MANAGE_USERS: 'manage_users',
  MANAGE_INGREDIENTS: 'manage_ingredients',
  MANAGE_PROJECTS: 'manage_projects',
  MANAGE_FORMULATIONS: 'manage_formulations',
  APPROVE_FORMULATIONS: 'approve_formulations',
  MANAGE_LAB: 'manage_lab',
  MANAGE_SENSORY: 'manage_sensory',
  MANAGE_STABILITY: 'manage_stability',
  APPROVE_SPECIFICATIONS: 'approve_specifications',
  MANAGE_SUPPLIERS: 'manage_suppliers',
  APPROVE_SUPPLIER_MATERIALS: 'approve_supplier_materials',
  MANAGE_PACKAGING: 'manage_packaging',
  APPROVE_PACKAGING: 'approve_packaging',
  MANAGE_PRODUCTION_TRIALS: 'manage_production_trials',
  PERFORM_QC_RELEASE: 'perform_qc_release',
  MANAGE_QUALITY_EVENTS: 'manage_quality_events',
  MANAGE_CAPA: 'manage_capa',
  MANAGE_REGULATORY: 'manage_regulatory',
  MANAGE_AI_PREFERENCES: 'manage_ai_preferences',
});

const ALL_PERMISSIONS = Object.values(PERMISSIONS);

export const ROLE_PERMISSIONS = Object.freeze({
  [USER_ROLES.ADMIN]: ALL_PERMISSIONS,
  [USER_ROLES.RD_MANAGER]: [
    PERMISSIONS.MANAGE_PROJECTS, PERMISSIONS.MANAGE_FORMULATIONS, PERMISSIONS.APPROVE_FORMULATIONS,
    PERMISSIONS.MANAGE_LAB, PERMISSIONS.MANAGE_SENSORY, PERMISSIONS.MANAGE_STABILITY,
    PERMISSIONS.APPROVE_SPECIFICATIONS, PERMISSIONS.MANAGE_PRODUCTION_TRIALS, PERMISSIONS.MANAGE_AI_PREFERENCES,
  ],
  [USER_ROLES.FORMULATOR]: [
    PERMISSIONS.MANAGE_PROJECTS, PERMISSIONS.MANAGE_FORMULATIONS,
    PERMISSIONS.MANAGE_PRODUCTION_TRIALS, PERMISSIONS.MANAGE_AI_PREFERENCES,
  ],
  [USER_ROLES.LAB]: [PERMISSIONS.MANAGE_LAB, PERMISSIONS.MANAGE_STABILITY, PERMISSIONS.MANAGE_AI_PREFERENCES],
  [USER_ROLES.SENSORY]: [PERMISSIONS.MANAGE_SENSORY, PERMISSIONS.MANAGE_AI_PREFERENCES],
  [USER_ROLES.QA]: [
    PERMISSIONS.MANAGE_STABILITY, PERMISSIONS.APPROVE_SPECIFICATIONS, PERMISSIONS.PERFORM_QC_RELEASE,
    PERMISSIONS.MANAGE_QUALITY_EVENTS, PERMISSIONS.MANAGE_CAPA, PERMISSIONS.MANAGE_AI_PREFERENCES,
  ],
  [USER_ROLES.REGULATORY]: [PERMISSIONS.MANAGE_REGULATORY, PERMISSIONS.MANAGE_AI_PREFERENCES],
  [USER_ROLES.PROCUREMENT]: [
    PERMISSIONS.MANAGE_SUPPLIERS, PERMISSIONS.APPROVE_SUPPLIER_MATERIALS,
    PERMISSIONS.MANAGE_PACKAGING, PERMISSIONS.APPROVE_PACKAGING, PERMISSIONS.MANAGE_AI_PREFERENCES,
  ],
  [USER_ROLES.VIEWER]: [],
});

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const mutationRules = [
  { test: path => path.startsWith('/api/v1/admin/'), permissions: [PERMISSIONS.MANAGE_USERS] },
  { test: path => path === '/api/v1/ingredients' || path.startsWith('/api/v1/ingredients/'), permissions: [PERMISSIONS.MANAGE_INGREDIENTS] },
  { test: path => /^\/api\/v1\/cost\/ingredients\/[^/]+\/pricing$/.test(path), permissions: [PERMISSIONS.MANAGE_SUPPLIERS] },
  { test: path => /\/specifications\/[^/]+\/approve$/.test(path), permissions: [PERMISSIONS.APPROVE_SPECIFICATIONS] },
  { test: path => /\/packaging-configurations\/[^/]+\/approve$/.test(path), permissions: [PERMISSIONS.APPROVE_PACKAGING] },
  { test: path => /\/material-specifications\/[^/]+\/approve$/.test(path), permissions: [PERMISSIONS.APPROVE_SUPPLIER_MATERIALS] },
  { test: path => path.includes('/qc-releases'), permissions: [PERMISSIONS.PERFORM_QC_RELEASE] },
  { test: path => path.includes('/quality-events/') && path.endsWith('/capas'), permissions: [PERMISSIONS.MANAGE_CAPA] },
  { test: path => path.includes('/capas/'), permissions: [PERMISSIONS.MANAGE_CAPA] },
  { test: path => path.includes('/quality-events'), permissions: [PERMISSIONS.MANAGE_QUALITY_EVENTS] },
  { test: path => path.includes('/production-trials') || path.includes('/pilot-batches'), permissions: [PERMISSIONS.MANAGE_PRODUCTION_TRIALS] },
  { test: path => path.includes('/stability-programs') || path.includes('/specifications'), permissions: [PERMISSIONS.MANAGE_STABILITY] },
  { test: path => path.includes('/packaging-configurations') || path.startsWith('/api/v1/supply-chain/packaging-components'), permissions: [PERMISSIONS.MANAGE_PACKAGING] },
  { test: path => path.startsWith('/api/v1/supply-chain/'), permissions: [PERMISSIONS.MANAGE_SUPPLIERS] },
  { test: path => path.includes('/laboratory-results'), permissions: [PERMISSIONS.MANAGE_LAB] },
  { test: path => path.startsWith('/api/v1/sensory/'), permissions: [PERMISSIONS.MANAGE_SENSORY] },
  { test: path => /^\/api\/v1\/formulations\/[^/]+\/approve$/.test(path), permissions: [PERMISSIONS.APPROVE_FORMULATIONS] },
  { test: path => path === '/api/v1/formulations' || path.startsWith('/api/v1/formulations/'), permissions: [PERMISSIONS.MANAGE_FORMULATIONS] },
  { test: path => path.startsWith('/api/v1/regulatory/'), permissions: [PERMISSIONS.MANAGE_REGULATORY] },
  { test: path => path.startsWith('/api/v1/compatibility/') || path.startsWith('/api/v1/target-generation/'), permissions: [PERMISSIONS.MANAGE_FORMULATIONS] },
  { test: path => path.startsWith('/api/v1/cost/formulations/'), anyPermissions: [PERMISSIONS.MANAGE_FORMULATIONS, PERMISSIONS.MANAGE_SUPPLIERS] },
  { test: path => path.startsWith('/api/v1/ai/formulations/') || path.startsWith('/api/v1/ai/variants/'), permissions: [PERMISSIONS.MANAGE_FORMULATIONS] },
  { test: path => path === '/api/v1/ai/insights', permissions: [PERMISSIONS.MANAGE_AI_PREFERENCES] },
  { test: path => path === '/api/v1/projects' || path.startsWith('/api/v1/projects/'), permissions: [PERMISSIONS.MANAGE_PROJECTS] },
];

export function hasPermission(role, permission) {
  return Boolean(ROLE_PERMISSIONS[role]?.includes(permission));
}

function denied(reason, permission = null) {
  return { allowed: false, reason, permission };
}

export function authorizeApiRequest({ method, path, role }) {
  if (!Object.values(USER_ROLES).includes(role)) return denied('A valid workspace role is required');

  if (path.startsWith('/api/v1/admin/') && !hasPermission(role, PERMISSIONS.MANAGE_USERS)) {
    return denied('User-management permission is required', PERMISSIONS.MANAGE_USERS);
  }

  if (SAFE_METHODS.has(method)) return { allowed: true, permission: null };

  // Account identity and privacy consent are owner-scoped self-service actions.
  if (path === '/api/v1/auth/profile' || path === '/api/v1/ai/preferences') {
    return { allowed: true, permission: null };
  }

  const rule = mutationRules.find(candidate => candidate.test(path));
  if (!rule) return denied('This mutation has no authorization policy and is denied by default');

  const required = rule.permissions || [];
  const alternatives = rule.anyPermissions || [];
  const allowed = required.every(permission => hasPermission(role, permission))
    && (alternatives.length === 0 || alternatives.some(permission => hasPermission(role, permission)));
  if (!allowed) {
    const permission = required[0] || alternatives[0];
    return denied(`Permission ${permission} is required`, permission);
  }
  return { allowed: true, permission: required[0] || alternatives.find(permission => hasPermission(role, permission)) || null };
}
