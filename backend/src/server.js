import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import {
  describeGeminiFailure,
  getAIConfiguration,
  generateExpertInsight,
  reviewFormulationCandidates,
  reviewFormulationVariants,
} from './services/geminiService.js';
import {
  AIQuotaError,
  completeAIUsage,
  getAIPreferences,
  getAIQuotaStatus,
  reserveAIQuota,
  updateAIPreferences,
} from './services/aiGovernance.js';

import { generateId } from './data/mockData.js';
import { getStorageConfiguration, initializePersistentStore } from './data/persistentStore.js';
import { commitRequestStore, loadRequestStore } from './data/requestRepository.js';
import {
  checkSupabaseHealth,
  ensureUserProfile,
  getUserProfile,
  listAuditEvents,
  listUserAccounts,
  updateUserProfile,
  updateUserRole,
  verifySupabaseAccessToken,
} from './services/supabaseClient.js';
import { authorizeApiRequest, USER_ROLES } from './services/authorization.js';
import { analyzeSensoryResults } from './services/sensoryAnalytics.js';
import { analyzeSensoryStudy } from './services/sensoryStudyAnalytics.js';
import { FORMULATION_ENGINE_VERSION, generateFormulationCandidates } from './services/formulationIntelligence.js';
import { DOE_ENGINE_VERSION, analyzeDoeDesign, buildDoeReportCsv, generateDoeDesign } from './services/doeEngine.js';
import { analyzeStabilityProgram } from './services/stabilityEngine.js';
import { buildLabelStabilityEvidence } from './services/labelStabilityEvidence.js';
import { analyzePackagingConfiguration } from './services/packagingEngine.js';
import { analyzeProductionTrial, evaluateQcRelease } from './services/industrialQualityEngine.js';
import { buildProductPassport, structuredWorkspaceSearch } from './services/productPassportEngine.js';
import { buildProjectDevelopmentState } from './services/projectStateEngine.js';
import { validateRuntimeConfiguration } from './services/runtimeConfiguration.js';
import {
  createRequestId,
  observeRequest,
  renderPrometheusMetrics,
  tokensMatch,
} from './services/observability.js';

dotenv.config();
validateRuntimeConfiguration();
await initializePersistentStore();

const production = process.env.NODE_ENV === 'production';
const applicationVersion = process.env.APP_VERSION || '1.0.0';
const trustedProxies = process.env.TRUST_PROXY
  ? process.env.TRUST_PROXY.split(',').map(value => value.trim()).filter(Boolean)
  : false;
const server = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers.x-api-key',
        'res.headers.set-cookie',
        '*.password',
        '*.access_token',
        '*.refresh_token',
        '*.SUPABASE_SECRET_KEY',
        '*.GEMINI_API_KEY',
      ],
      censor: '[REDACTED]',
    },
  },
  genReqId: createRequestId,
  trustProxy: trustedProxies,
  bodyLimit: Number.parseInt(process.env.BODY_LIMIT_BYTES || '1048576', 10),
  requestTimeout: Number.parseInt(process.env.REQUEST_TIMEOUT_MS || '30000', 10),
});

let supabaseOrigin;
try {
  supabaseOrigin = process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).origin : undefined;
} catch {
  supabaseOrigin = undefined;
}

let ragOrigin;
try { ragOrigin = process.env.RAG_URL ? new URL(process.env.RAG_URL).origin : undefined; } catch { ragOrigin = undefined; }

await server.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      connectSrc: ["'self'", ...(supabaseOrigin ? [supabaseOrigin] : [])],
      frameSrc: ["'self'", 'http://127.0.0.1:8503', 'http://localhost:8503', ...(ragOrigin ? [ragOrigin] : [])],
      fontSrc: ["'self'", 'data:'],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
    },
  },
  hsts: production ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
  referrerPolicy: { policy: 'no-referrer' },
});

await server.register(rateLimit, {
  max: Number.parseInt(process.env.RATE_LIMIT_MAX || '200', 10),
  timeWindow: '1 minute',
});

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

await server.register(cors, {
  origin: allowedOrigins,
  credentials: true,
});

const operationalPaths = new Set(['/health', '/ready', '/metrics']);

server.addHook('onRequest', async (request, reply) => {
  reply.header('x-request-id', request.id);
});

server.addHook('onResponse', async (request, reply) => {
  observeRequest({
    method: request.method,
    route: request.routeOptions?.url || 'unmatched',
    statusCode: reply.statusCode,
    durationMs: reply.elapsedTime,
  });
});

server.addHook('onSend', async (request, reply, payload) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && reply.statusCode < 400) {
    let auditEvent = null;
    if (getStorageConfiguration().mode === 'supabase' && request.user?.id) {
      const parts = request.url.split('?')[0].split('/').filter(Boolean);
      auditEvent = {
        owner_id: request.user.id,
        action: request.method.toLowerCase(),
        entity_type: parts[2] || 'api',
        entity_id: parts.length > 3 ? parts.at(-1) : null,
        metadata: { path: request.routeOptions?.url || request.url.split('?')[0], status_code: reply.statusCode },
      };
    }
    await commitRequestStore(request.store, auditEvent);
  }
  return payload;
});

server.addHook('onRequest', async (request, reply) => {
  const pathname = request.url.split('?')[0];
  if (!process.env.API_KEY || operationalPaths.has(pathname) || !pathname.startsWith('/api/') || request.method === 'OPTIONS') return;
  if (request.headers['x-api-key'] !== process.env.API_KEY) {
    return reply.code(401).send({ error: 'Invalid or missing API key' });
  }
});

const initializedUsers = new Set();
server.addHook('preHandler', async (request, reply) => {
  const pathname = request.url.split('?')[0];
  if (operationalPaths.has(pathname) || !pathname.startsWith('/api/') || request.method === 'OPTIONS') return;
  if (process.env.NODE_TEST_CONTEXT) {
    request.user = { id: '00000000-0000-4000-8000-000000000001', email: 'test@beverageai.local' };
    request.profile = { id: request.user.id, display_name: 'Test User', role: USER_ROLES.ADMIN };
  } else if (getStorageConfiguration().mode === 'supabase') {
    const authorization = request.headers.authorization || '';
    const accessToken = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
    if (!accessToken) return reply.code(401).send({ error: 'Authentication required' });
    const user = await verifySupabaseAccessToken(accessToken);
    if (!user) return reply.code(401).send({ error: 'Invalid or expired session' });
    request.user = user;

    if (!initializedUsers.has(user.id)) {
      request.profile = await ensureUserProfile(user);
      initializedUsers.add(user.id);
    } else {
      request.profile = await getUserProfile(user.id);
    }
  } else {
    request.profile = { id: null, display_name: 'Local developer', role: USER_ROLES.ADMIN };
  }

  request.store = await loadRequestStore(request.user?.id);
  const path = request.url.split('?')[0];
  const authorizationResult = authorizeApiRequest({ method: request.method, path, role: request.profile.role });
  if (!authorizationResult.allowed) {
    return reply.code(403).send({ error: authorizationResult.reason });
  }
});

server.setErrorHandler((error, request, reply) => {
  if (error instanceof z.ZodError) {
    return reply.code(400).send({
      error: 'Invalid request',
      details: error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })),
    });
  }

  request.log.error(error);
  return reply.code(error.statusCode || 500).send({
    error: error.statusCode && error.statusCode < 500 ? error.message : 'Internal server error',
  });
});

// Health check endpoint
server.get('/health', async () => {
  const storage = getStorageConfiguration();
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: applicationVersion,
    uptime_seconds: Math.floor(process.uptime()),
    mode: storage.mode,
    persistent: storage.persistent,
  };
});

server.get('/ready', async (_request, reply) => {
  try {
    if (getStorageConfiguration().mode === 'supabase') await checkSupabaseHealth();
    return { status: 'ready', timestamp: new Date().toISOString() };
  } catch (error) {
    server.log.error({ err: error }, 'Readiness check failed');
    return reply.code(503).send({ status: 'not_ready', timestamp: new Date().toISOString() });
  }
});

server.get('/metrics', async (request, reply) => {
  const authorization = request.headers.authorization || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!tokensMatch(token, process.env.METRICS_TOKEN)) {
    return reply.code(process.env.METRICS_TOKEN ? 401 : 404).send({ error: 'Metrics unavailable' });
  }
  return reply
    .type('text/plain; version=0.0.4; charset=utf-8')
    .send(renderPrometheusMetrics({ version: applicationVersion }));
});

const apiPrefix = '/api/v1';

function publicAIGovernance({ preferences, quota }) {
  return {
    privacy: {
      external_processing_enabled: preferences.external_processing_enabled,
      include_formulation_name: preferences.include_formulation_name,
      prompt_or_response_content_stored: false,
    },
    quota,
  };
}

async function prepareExternalAI(request, operation) {
  const configuration = getAIConfiguration();
  const preferences = await getAIPreferences(request.user?.id);
  const quota = await getAIQuotaStatus(request.user?.id);
  const governance = publicAIGovernance({ preferences, quota });
  if (!configuration.configured) {
    return { allowed: false, configuration, preferences, governance, reason: 'GEMINI_API_KEY is not configured' };
  }
  if (!preferences.external_processing_enabled) {
    return { allowed: false, configuration, preferences, governance, reason: 'External AI processing is disabled in privacy settings' };
  }
  try {
    const reservation = await reserveAIQuota({
      ownerId: request.user?.id,
      requestId: request.id,
      operation,
      provider: configuration.provider,
      model: configuration.model,
    });
    governance.quota = {
      ...quota,
      daily_used: reservation.daily_used,
      daily_remaining: Math.max(0, quota.daily_limit - reservation.daily_used),
      monthly_used: reservation.monthly_used,
      monthly_remaining: Math.max(0, quota.monthly_limit - reservation.monthly_used),
    };
    return { allowed: true, configuration, preferences, governance, reservation };
  } catch (error) {
    if (error instanceof AIQuotaError) {
      return { allowed: false, configuration, preferences, governance, reason: error.message, quota_code: error.code };
    }
    throw error;
  }
}

async function finishExternalAI(request, decision, outcome, usage) {
  try {
    await completeAIUsage({
      ownerId: request.user?.id,
      eventId: decision.reservation?.event_id,
      outcome,
      usage,
    });
  } catch (error) {
    request.log.error({ err: error }, 'Unable to finalize external AI usage accounting');
  }
}

function isOwnedByRequest(request, item) {
  return Boolean(item) && (!item.owner_id || item.owner_id === request.user?.id);
}

function findAccessibleFormulation(request, id) {
  const formulation = request.store.formulations.find(item => item.id === id);
  return isOwnedByRequest(request, formulation) ? formulation : null;
}

function accessibleFormulations(request) {
  return request.store.formulations.filter(item => isOwnedByRequest(request, item));
}

function getIngredientById(request, id) {
  return request.store.ingredients.find(item => item.id === id);
}

function addFormulation(request, formulation) {
  const newFormulation = {
    ...formulation,
    id: generateId(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  request.store.formulations.push(newFormulation);
  return newFormulation;
}

function updateFormulation(request, id, data) {
  const index = request.store.formulations.findIndex(item => item.id === id);
  if (index < 0) return null;
  request.store.formulations[index] = {
    ...request.store.formulations[index],
    ...data,
    updated_at: new Date().toISOString(),
  };
  return request.store.formulations[index];
}

function archiveFormulation(request, id) {
  const formulation = request.store.formulations.find(item => item.id === id);
  if (!formulation) return null;
  formulation.status = 'archived';
  formulation.updated_at = new Date().toISOString();
  return formulation;
}

const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const projectStages = ['brief', 'concept', 'formulation', 'laboratory', 'sensory', 'validation', 'industrialization', 'launched'];
const projectTransitions = {
  brief: ['concept'],
  concept: ['formulation'],
  formulation: ['laboratory'],
  laboratory: ['formulation', 'sensory'],
  sensory: ['formulation', 'validation'],
  validation: ['formulation', 'industrialization'],
  industrialization: ['formulation', 'launched'],
  launched: [],
};
const projectBriefFields = {
  business_objective: z.string().trim().min(10).max(2000),
  target_market: z.string().trim().min(2).max(160),
  beverage_category: z.string().trim().min(2).max(120),
  target_claims: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  ingredient_constraints: z.object({
    required: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
    forbidden: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
    notes: z.string().trim().max(1500).default(''),
  }).default({ required: [], forbidden: [], notes: '' }),
  cost_objectives: z.object({
    max_cost_per_liter: z.coerce.number().finite().positive().optional(),
    currency: z.string().trim().min(3).max(3).default('DZD'),
  }).default({ currency: 'DZD' }),
  nutrition_objectives: z.object({
    max_sugar_g_per_100ml: z.coerce.number().finite().nonnegative().optional(),
    max_calories_per_100ml: z.coerce.number().finite().nonnegative().optional(),
    target_ph_min: z.coerce.number().finite().min(0).max(14).optional(),
    target_ph_max: z.coerce.number().finite().min(0).max(14).optional(),
  }).default({}),
  regulatory_constraints: z.object({
    markets: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
    certifications: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
    forbidden_additives: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
  }).default({ markets: [], certifications: [], forbidden_additives: [] }),
  success_criteria: z.array(z.string().trim().min(3).max(300)).min(1).max(20),
};
const projectBriefSchema = z.object(projectBriefFields).superRefine((brief, context) => {
  const { target_ph_min: minimum, target_ph_max: maximum } = brief.nutrition_objectives;
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['nutrition_objectives', 'target_ph_max'], message: 'Maximum target pH must be greater than or equal to minimum target pH' });
  }
  const required = new Set(brief.ingredient_constraints.required.map(value => value.toLowerCase()));
  const overlap = brief.ingredient_constraints.forbidden.find(value => required.has(value.toLowerCase()));
  if (overlap) context.addIssue({ code: z.ZodIssueCode.custom, path: ['ingredient_constraints'], message: `${overlap} cannot be both required and forbidden` });
});
const projectInputSchema = z.object({
  code: z.string().trim().min(1).max(50).optional(),
  name: z.string().trim().min(2).max(160),
  business_objective: z.string().trim().max(2000).default(''),
  target_market: z.string().trim().max(160).default(''),
  beverage_category: z.string().trim().max(120).default(''),
  target_claims: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  priority: z.enum(['low', 'normal', 'high', 'critical']).default('normal'),
  due_date: z.string().date().nullable().optional(),
  ingredient_constraints: projectBriefFields.ingredient_constraints.optional(),
  cost_objectives: projectBriefFields.cost_objectives.optional(),
  nutrition_objectives: projectBriefFields.nutrition_objectives.optional(),
  regulatory_constraints: projectBriefFields.regulatory_constraints.optional(),
  success_criteria: z.array(z.string().trim().min(3).max(300)).max(20).optional(),
});
const experimentalPlanSchema = z.object({
  name: z.string().trim().min(3).max(160),
  objective: z.string().trim().min(10).max(2000),
  hypothesis: z.string().trim().min(10).max(2000),
  formulation_version_id: z.string().trim().min(1),
  status: z.enum(['draft', 'ready', 'running', 'completed', 'cancelled']).default('draft'),
  planned_runs: z.coerce.number().int().min(1).max(100).default(1),
  due_date: z.string().date().nullable().optional(),
  protocol: z.object({
    method: z.string().trim().min(3).max(200),
    variables: z.array(z.string().trim().min(1).max(160)).min(1).max(30),
    controls: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
    procedure_steps: z.array(z.string().trim().min(3).max(500)).min(1).max(50),
    acceptance_criteria: z.array(z.string().trim().min(3).max(300)).min(1).max(30),
  }),
});
const doeDesignSchema = z.object({
  type: z.enum(['full_factorial', 'response_surface']).default('full_factorial'),
  factors: z.array(z.object({
    key: z.string().trim().regex(/^[a-z][a-z0-9_]*$/).max(40),
    label: z.string().trim().min(2).max(120),
    low: z.coerce.number().finite(),
    high: z.coerce.number().finite(),
    unit: z.string().trim().max(30).default(''),
  }).refine(value => value.high > value.low, { message: 'Factor high level must be greater than low level' })).min(1).max(5)
    .refine(items => new Set(items.map(item => item.key)).size === items.length, { message: 'Factor keys must be unique' }),
  responses: z.array(z.object({
    key: z.string().trim().regex(/^[a-z][a-z0-9_]*$/).max(40),
    label: z.string().trim().min(2).max(120),
    goal: z.enum(['maximize', 'minimize', 'target']),
    target: z.coerce.number().finite().nullable().optional(),
    unit: z.string().trim().max(30).default(''),
  }).superRefine((value, context) => {
    if (value.goal === 'target' && value.target == null) context.addIssue({ code: z.ZodIssueCode.custom, path: ['target'], message: 'A target value is required for a target response' });
  })).min(1).max(10).refine(items => new Set(items.map(item => item.key)).size === items.length, { message: 'Response keys must be unique' }),
  center_points: z.coerce.number().int().min(0).max(10).default(1),
  replicates: z.coerce.number().int().min(1).max(5).default(1),
}).superRefine((value, context) => {
  const base = 2 ** value.factors.length;
  const axial = value.type === 'response_surface' ? 2 * value.factors.length : 0;
  if ((base + axial + value.center_points) * value.replicates > 100) context.addIssue({ code: z.ZodIssueCode.custom, message: 'The DOE cannot exceed 100 runs' });
});
const pilotBatchSchema = z.object({
  batch_code: z.string().trim().min(2).max(80),
  formulation_version_id: z.string().trim().min(1),
  batch_size_liters: z.coerce.number().finite().positive().max(100000),
  status: z.enum(['planned', 'in_progress', 'completed', 'rejected']).default('planned'),
  scheduled_at: z.string().datetime().nullable().optional(),
  produced_at: z.string().datetime().nullable().optional(),
  actual_quantities: z.array(z.object({
    material_name: z.string().trim().min(1).max(160), ingredient_id: z.string().trim().min(1).optional(), quantity: z.coerce.number().finite().nonnegative(),
    unit: z.enum(['g', 'kg', 'ml', 'l']), lot_code: z.string().trim().max(100).default(''),
  })).max(80).default([]),
  procedure_notes: z.string().trim().max(5000).default(''),
  deviations: z.array(z.string().trim().min(2).max(500)).max(30).default([]),
  observations: z.string().trim().max(5000).default(''),
  conclusion: z.string().trim().max(3000).default(''),
  doe_run_id: z.string().trim().max(80).nullable().optional(),
  factor_settings: z.record(z.string(), z.object({ coded: z.coerce.number().min(-1).max(1), value: z.coerce.number().finite(), unit: z.string().max(30).default('') })).default({}),
  response_values: z.record(z.string(), z.coerce.number().finite()).default({}),
});
const stabilityLimitSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_]*$/).max(50),
  label: z.string().trim().min(2).max(120),
  source: z.enum(['measurements', 'sensory']),
  unit: z.string().trim().max(30).default(''),
  lower: z.coerce.number().finite().optional(),
  upper: z.coerce.number().finite().optional(),
  max_change_from_baseline: z.coerce.number().finite().nonnegative().optional(),
}).superRefine((value, context) => {
  if (value.lower === undefined && value.upper === undefined && value.max_change_from_baseline === undefined) context.addIssue({ code: z.ZodIssueCode.custom, message: 'At least one acceptance limit is required' });
  if (value.lower !== undefined && value.upper !== undefined && value.lower > value.upper) context.addIssue({ code: z.ZodIssueCode.custom, path: ['upper'], message: 'Upper limit must be greater than or equal to lower limit' });
});
const stabilityProgramSchema = z.object({
  name: z.string().trim().min(3).max(160),
  formulation_version_id: z.string().trim().min(1),
  status: z.enum(['draft', 'running', 'completed', 'cancelled']).default('draft'),
  protocol: z.string().trim().min(10).max(4000),
  storage_conditions: z.array(z.object({ id: z.string().trim().regex(/^[a-z][a-z0-9_-]*$/).max(40), label: z.string().trim().min(2).max(120), temperature_c: z.coerce.number().finite().min(-40).max(100), relative_humidity_percent: z.coerce.number().finite().min(0).max(100).optional(), light_exposure: z.enum(['dark', 'ambient', 'controlled_light']).default('dark') })).min(1).max(12)
    .refine(items => new Set(items.map(item => item.id)).size === items.length, { message: 'Storage condition identifiers must be unique' }),
  timepoints_days: z.array(z.coerce.number().int().min(0).max(3650)).min(2).max(40)
    .refine(items => new Set(items).size === items.length, { message: 'Timepoints must be unique' }),
  replicates_per_timepoint: z.coerce.number().int().min(1).max(20).default(1),
  parameters: z.array(stabilityLimitSchema).min(1).max(30)
    .refine(items => new Set(items.map(item => item.key)).size === items.length, { message: 'Parameter keys must be unique' }),
});
const productSpecificationSchema = z.object({
  name: z.string().trim().min(3).max(160),
  formulation_version_id: z.string().trim().min(1),
  markets: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  effective_date: z.string().date().nullable().optional(),
  notes: z.string().trim().max(3000).default(''),
  limits: z.array(stabilityLimitSchema).min(1).max(40).refine(items => new Set(items.map(item => item.key)).size === items.length, { message: 'Specification keys must be unique' }),
});
const supplierSchema = z.object({
  name: z.string().trim().min(2).max(180),
  status: z.enum(['prospect', 'qualified', 'conditionally_qualified', 'suspended', 'rejected']).default('prospect'),
  country: z.string().trim().max(100).default(''), contact_name: z.string().trim().max(120).default(''),
  contact_email: z.string().trim().email().or(z.literal('')).default(''), phone: z.string().trim().max(60).default(''),
  certifications: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
  qualification_score: z.coerce.number().finite().min(0).max(100).default(0),
  last_audit_date: z.string().date().nullable().optional(), qualification_expiry_date: z.string().date().nullable().optional(),
  notes: z.string().trim().max(3000).default(''),
});
const supplierMaterialSchema = z.object({
  material_code: z.string().trim().min(1).max(100), name: z.string().trim().min(2).max(180),
  ingredient_id: z.string().trim().max(100).nullable().optional(), status: z.enum(['candidate', 'approved', 'restricted', 'discontinued']).default('candidate'),
  manufacturing_site: z.string().trim().max(200).default(''), currency: z.string().trim().min(3).max(3).default('DZD'),
  price_per_kg: z.coerce.number().finite().nonnegative().default(0), moq_kg: z.coerce.number().finite().nonnegative().default(0),
  lead_time_days: z.coerce.number().int().min(0).max(730).default(0), allergens: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
  certifications: z.array(z.string().trim().min(1).max(120)).max(30).default([]), notes: z.string().trim().max(3000).default(''),
});
const specificationLimitSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_]*$/).max(50), label: z.string().trim().min(2).max(120), unit: z.string().trim().max(30).default(''),
  lower: z.coerce.number().finite().optional(), upper: z.coerce.number().finite().optional(), method: z.string().trim().max(160).default(''),
}).superRefine((value, context) => {
  if (value.lower === undefined && value.upper === undefined) context.addIssue({ code: z.ZodIssueCode.custom, message: 'At least one material limit is required' });
  if (value.lower !== undefined && value.upper !== undefined && value.lower > value.upper) context.addIssue({ code: z.ZodIssueCode.custom, path: ['upper'], message: 'Upper limit must be greater than or equal to lower limit' });
});
const materialSpecificationSchema = z.object({
  name: z.string().trim().min(3).max(180), effective_date: z.string().date().nullable().optional(),
  limits: z.array(specificationLimitSchema).min(1).max(50).refine(items => new Set(items.map(item => item.key)).size === items.length, { message: 'Material specification keys must be unique' }),
  notes: z.string().trim().max(3000).default(''),
});
const documentSchema = z.object({
  supplier_id: z.string().trim().min(1).nullable().optional(), supplier_material_id: z.string().trim().min(1).nullable().optional(),
  formulation_version_id: z.string().trim().min(1).nullable().optional(),
  document_type: z.enum(['certificate_of_analysis', 'technical_data_sheet', 'safety_data_sheet', 'certificate', 'audit_report', 'packaging_drawing', 'test_report', 'other']),
  title: z.string().trim().min(3).max(200), file_name: z.string().trim().min(1).max(255), mime_type: z.string().trim().min(3).max(120),
  size_bytes: z.coerce.number().int().min(0).max(100000000), sha256: z.string().trim().toLowerCase().regex(/^[a-f0-9]{64}$/),
  storage_reference: z.string().trim().min(1).max(1000), source: z.string().trim().max(500).default(''),
  issued_date: z.string().date().nullable().optional(), expires_date: z.string().date().nullable().optional(),
  extraction_status: z.enum(['not_requested', 'pending', 'extracted', 'failed']).default('not_requested'), extracted_text: z.string().max(50000).default(''),
});
const packagingComponentSchema = z.object({
  supplier_id: z.string().trim().min(1).nullable().optional(), code: z.string().trim().min(1).max(100), name: z.string().trim().min(2).max(180),
  component_type: z.enum(['bottle', 'can', 'carton', 'pouch', 'closure', 'label', 'sleeve', 'tray', 'case', 'film', 'other']),
  material: z.string().trim().min(1).max(120), status: z.enum(['candidate', 'approved', 'restricted', 'discontinued']).default('candidate'),
  capacity_ml: z.coerce.number().finite().positive().max(100000).nullable().optional(), mass_g: z.coerce.number().finite().nonnegative(),
  recycled_content_percent: z.coerce.number().finite().min(0).max(100).default(0), unit_cost: z.coerce.number().finite().nonnegative(), currency: z.string().trim().min(3).max(3).default('DZD'),
  barrier: z.object({ oxygen_transmission_rate_cc_m2_day: z.coerce.number().finite().nonnegative().nullable().optional(), water_vapor_transmission_rate_g_m2_day: z.coerce.number().finite().nonnegative().nullable().optional(), light_transmission_percent: z.coerce.number().finite().min(0).max(100).nullable().optional() }).default({}),
  food_contact_compliant: z.boolean().default(false), markets: z.array(z.string().trim().min(1).max(80)).max(30).default([]), notes: z.string().trim().max(3000).default(''),
});
const packagingConfigurationSchema = z.object({
  formulation_version_id: z.string().trim().min(1), name: z.string().trim().min(3).max(180), currency: z.string().trim().min(3).max(3).default('DZD'),
  intended_shelf_life_days: z.coerce.number().int().min(1).max(3650), filling_process: z.string().trim().max(200).default(''),
  components: z.array(z.object({ component_id: z.string().trim().min(1), role: z.enum(['primary_container', 'closure', 'label', 'secondary', 'tertiary', 'other']), quantity: z.coerce.number().finite().positive().max(1000) })).min(1).max(30),
  transport_conditions: z.string().trim().max(1000).default(''), notes: z.string().trim().max(3000).default(''),
});
const productionTrialSchema = z.object({
  formulation_version_id: z.string().trim().min(1), packaging_configuration_id: z.string().trim().min(1).nullable().optional(),
  batch_code: z.string().trim().min(2).max(100), site: z.string().trim().min(2).max(180), line: z.string().trim().max(120).default(''),
  status: z.enum(['planned','running','completed','cancelled']).default('planned'), scheduled_at: z.string().datetime().nullable().optional(), produced_at: z.string().datetime().nullable().optional(),
  reference_batch_size_liters: z.coerce.number().finite().positive().max(1000000), planned_batch_size_liters: z.coerce.number().finite().positive().max(1000000),
  saleable_output_liters: z.coerce.number().finite().nonnegative().default(0), rejected_output_liters: z.coerce.number().finite().nonnegative().default(0),
  material_lots: z.array(z.object({ supplier_material_id: z.string().trim().min(1).nullable().optional(), material_name: z.string().trim().min(1).max(180), lot_code: z.string().trim().min(1).max(100), quantity: z.coerce.number().finite().positive(), unit: z.enum(['g','kg','ml','l']) })).max(100).default([]),
  process_parameters: z.array(z.object({ key: z.string().trim().regex(/^[a-z][a-z0-9_]*$/).max(50), label: z.string().trim().min(2).max(120), unit: z.string().trim().max(30).default(''), lower: z.coerce.number().finite().optional(), upper: z.coerce.number().finite().optional(), actual: z.coerce.number().finite() }).superRefine((value,context)=>{ if(value.lower===undefined&&value.upper===undefined) context.addIssue({code:z.ZodIssueCode.custom,message:'At least one process limit is required'}); })).max(50).default([]),
  deviations: z.array(z.string().trim().min(2).max(500)).max(50).default([]), notes: z.string().trim().max(5000).default(''),
});
const qcReleaseSchema = z.object({
  production_trial_id: z.string().trim().min(1), specification_id: z.string().trim().min(1),
  laboratory_result_ids: z.array(z.string().trim().min(1)).min(1).max(50).refine(items=>new Set(items).size===items.length,{message:'Laboratory result identifiers must be unique'}),
  notes: z.string().trim().max(3000).default(''),
});
const qualityEventSchema = z.object({
  production_trial_id: z.string().trim().min(1).nullable().optional(), qc_release_id: z.string().trim().min(1).nullable().optional(),
  event_type: z.enum(['deviation','out_of_specification','nonconformance']), severity: z.enum(['minor','major','critical']),
  title: z.string().trim().min(3).max(180), description: z.string().trim().min(10).max(5000), immediate_action: z.string().trim().max(3000).default(''),
  owner: z.string().trim().max(120).default(''), due_date: z.string().date().nullable().optional(),
});
const capaBaseSchema = z.object({
  action_type: z.enum(['corrective','preventive']), title: z.string().trim().min(3).max(180), action: z.string().trim().min(10).max(5000),
  owner: z.string().trim().min(2).max(120), due_date: z.string().date().nullable().optional(), status: z.enum(['planned','in_progress','implemented','effectiveness_verified','ineffective','cancelled']).default('planned'),
  effectiveness_criteria: z.string().trim().min(5).max(2000), effectiveness_evidence: z.string().trim().max(3000).default(''),
});
const capaSchema = capaBaseSchema.superRefine((value,context)=>{ if(value.status==='effectiveness_verified'&&!value.effectiveness_evidence) context.addIssue({code:z.ZodIssueCode.custom,path:['effectiveness_evidence'],message:'Effectiveness evidence is required before verification'}); });
const capaUpdateSchema = capaBaseSchema.partial();
const milestoneSchema = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(1500).default(''),
  stage: z.enum(projectStages),
  status: z.enum(['planned', 'in_progress', 'completed', 'blocked']).default('planned'),
  due_date: z.string().date().nullable().optional(),
  responsible: z.string().trim().max(120).default(''),
  success_criteria: z.array(z.string().trim().min(3).max(300)).min(1).max(20),
});
const projectDecisionSchema = z.object({
  title: z.string().trim().min(3).max(160),
  outcome: z.enum(['go', 'no_go', 'hold', 'rework']),
  rationale: z.string().trim().min(10).max(3000),
  evidence_refs: z.array(z.string().trim().min(1).max(200)).min(1).max(30),
  formulation_version_id: z.string().trim().min(1).nullable().optional(),
  milestone_id: z.string().trim().min(1).nullable().optional(),
});

function ensureProjectStorage(request, reply) {
  if (request.store.featureAvailability?.projects !== false) return true;
  reply.code(503).send({ error: 'Project storage is not installed. Apply the pending Supabase project migration.' });
  return false;
}

function ensureProjectExecutionStorage(request, reply) {
  if (request.store.featureAvailability?.projectExecution !== false) return true;
  reply.code(503).send({ error: 'Project execution storage is not installed. Apply the pending Supabase R&D execution migration.' });
  return false;
}

function ensureStabilityStorage(request, reply) {
  if (request.store.featureAvailability?.stability !== false) return true;
  reply.code(503).send({ error: 'Stability and specification storage is not installed. Apply the pending Supabase stability migration.', code: 'STABILITY_MIGRATION_REQUIRED' });
  return false;
}

function ensureSupplyChainStorage(request, reply) {
  if (request.store.featureAvailability?.supplyChain !== false) return true;
  reply.code(503).send({ error: 'Supplier, document and packaging storage is not installed. Apply the pending Supabase supply-chain migration.', code: 'SUPPLY_CHAIN_MIGRATION_REQUIRED' });
  return false;
}

function ensureIndustrialQualityStorage(request, reply) {
  if (request.store.featureAvailability?.industrialQuality !== false) return true;
  reply.code(503).send({ error: 'Industrial quality storage is not installed. Apply the pending production quality migration.', code: 'INDUSTRIAL_QUALITY_MIGRATION_REQUIRED' });
  return false;
}

function ownedProject(request, id) {
  return request.store.rdProjects.find(project => project.id === id && isOwnedByRequest(request, project));
}

function projectFormulationVersion(request, project, formulationVersionId) {
  return accessibleFormulations(request).find(item => item.id === formulationVersionId && item.project_id === project.id) || null;
}

function addProjectEvent(request, project, eventType, details = {}) {
  const event = {
    id: generateId(), owner_id: request.user?.id, actor_id: request.user?.id, project_id: project.id,
    event_type: eventType, details, created_at: new Date().toISOString(),
  };
  request.store.rdProjectEvents.push(event);
  return event;
}

server.get(`${apiPrefix}/auth/me`, async (request) => ({
  data: {
    id: request.user?.id,
    email: request.user?.email,
    display_name: request.profile?.display_name || null,
    role: request.profile?.role || USER_ROLES.ADMIN,
  },
}));

// ============================================================================
// R&D PROJECT LIFECYCLE
// ============================================================================

server.get(`${apiPrefix}/projects`, async (request, reply) => {
  if (!ensureProjectStorage(request, reply)) return;
  const query = z.object({
    search: z.string().trim().optional(),
    status: z.enum(['draft', 'active', 'on_hold', 'completed', 'archived', 'all']).default('all'),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  }).parse(request.query);
  let projects = request.store.rdProjects.filter(item => isOwnedByRequest(request, item));
  if (query.status !== 'all') projects = projects.filter(item => item.status === query.status);
  if (query.search) {
    const needle = query.search.toLowerCase();
    projects = projects.filter(item => `${item.code} ${item.name} ${item.beverage_category} ${item.target_market}`.toLowerCase().includes(needle));
  }
  projects.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  const data = projects.slice(query.offset, query.offset + query.limit).map(project => ({
    ...project,
    event_count: request.store.rdProjectEvents.filter(event => event.project_id === project.id && isOwnedByRequest(request, event)).length,
  }));
  return { data, stages: projectStages, pagination: { total: projects.length, limit: query.limit, offset: query.offset, has_more: query.offset + data.length < projects.length } };
});

server.get(`${apiPrefix}/projects/:id`, async (request, reply) => {
  if (!ensureProjectStorage(request, reply)) return;
  const project = ownedProject(request, request.params.id);
  if (!project) return reply.code(404).send({ error: 'Project not found' });
  const events = request.store.rdProjectEvents
    .filter(event => event.project_id === project.id && isOwnedByRequest(request, event))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const formulations = accessibleFormulations(request).filter(item => item.project_id === project.id);
  const formulationIds = new Set(formulations.map(item => item.id));
  const laboratoryResults = request.store.laboratoryResults.filter(item => formulationIds.has(item.formulation_id) && !item.deleted_at && isOwnedByRequest(request, item));
  const sensoryStudies = request.store.sensoryStudies.filter(item => item.project_id === project.id && isOwnedByRequest(request, item));
  const experimentalPlans = request.store.rdExperimentalPlans.filter(item => item.project_id === project.id && isOwnedByRequest(request, item));
  const pilotBatches = request.store.rdPilotBatches.filter(item => item.project_id === project.id && isOwnedByRequest(request, item));
  const milestones = request.store.rdProjectMilestones.filter(item => item.project_id === project.id && isOwnedByRequest(request, item));
  const decisions = request.store.rdProjectDecisions.filter(item => item.project_id === project.id && isOwnedByRequest(request, item));
  const stabilityPrograms = request.store.rdStabilityPrograms.filter(item => item.project_id === project.id && isOwnedByRequest(request, item));
  const stabilityObservations = request.store.rdStabilityObservations.filter(item => item.project_id === project.id && isOwnedByRequest(request, item));
  const specifications = request.store.rdProductSpecifications.filter(item => item.project_id === project.id && isOwnedByRequest(request, item));
  const specificationApprovals = request.store.rdSpecificationApprovals.filter(item => item.project_id === project.id && isOwnedByRequest(request, item));
  const documents = request.store.rdDocuments.filter(item => item.project_id === project.id && isOwnedByRequest(request, item));
  const packagingConfigurations = request.store.rdPackagingConfigurations.filter(item => item.project_id === project.id && isOwnedByRequest(request, item));
  const productionTrials = request.store.rdProductionTrials.filter(item => item.project_id === project.id && isOwnedByRequest(request, item));
  const qcReleases = request.store.rdQcReleases.filter(item => item.project_id === project.id && isOwnedByRequest(request, item));
  const qualityEvents = request.store.rdQualityEvents.filter(item => item.project_id === project.id && isOwnedByRequest(request, item));
  const capaActions = request.store.rdCapaActions.filter(item => item.project_id === project.id && isOwnedByRequest(request, item));
  const traceability = {
    formulations: formulations.map(item => ({ id: item.id, code: item.code, name: item.name, version: item.version, status: item.status, locked_at: item.locked_at || null })),
    laboratory_results: laboratoryResults.map(item => ({ id: item.id, formulation_version_id: item.formulation_id, batch_code: item.batch_code, tested_at: item.tested_at, measurements: item.measurements, sensory: item.sensory })),
    sensory_studies: sensoryStudies.map(item => ({ id: item.id, name: item.name, status: item.status, formulation_version_ids: item.samples.map(sample => sample.formulation_id).filter(Boolean) })),
    experimental_plans: experimentalPlans.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)),
    pilot_batches: pilotBatches.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)),
    milestones: milestones.sort((a, b) => String(a.due_date || '').localeCompare(String(b.due_date || ''))),
    decisions: decisions.sort((a, b) => new Date(b.decided_at) - new Date(a.decided_at)),
    stability_programs: stabilityPrograms.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)),
    stability_observations: stabilityObservations.sort((a, b) => a.timepoint_days - b.timepoint_days),
    product_specifications: specifications.sort((a, b) => b.version - a.version),
    specification_approvals: specificationApprovals.sort((a, b) => new Date(b.decided_at) - new Date(a.decided_at)),
    documents: documents.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)),
    packaging_configurations: packagingConfigurations.sort((a, b) => b.version - a.version),
    production_trials: productionTrials.sort((a,b)=>new Date(b.updated_at)-new Date(a.updated_at)),
    qc_releases: qcReleases.sort((a,b)=>new Date(b.decided_at)-new Date(a.decided_at)),
    quality_events: qualityEvents.sort((a,b)=>new Date(b.updated_at)-new Date(a.updated_at)),
    capa_actions: capaActions.sort((a,b)=>new Date(b.updated_at)-new Date(a.updated_at)),
  };
  const developmentState = buildProjectDevelopmentState(project, traceability);
  return { data: { ...project, events, execution_available: request.store.featureAvailability?.projectExecution !== false, stability_available: request.store.featureAvailability?.stability !== false, supply_chain_available: request.store.featureAvailability?.supplyChain !== false, industrial_quality_available: request.store.featureAvailability?.industrialQuality !== false, traceability, development_state: developmentState, product_passport: buildProductPassport(project, traceability, developmentState) }, allowed_transitions: projectTransitions[project.stage] || [] };
});

server.get(`${apiPrefix}/workspace-search`, async (request) => {
  const query = z.object({ q: z.string().trim().min(2).max(100), types: z.string().trim().max(300).optional(), limit: z.coerce.number().int().min(1).max(50).default(30) }).parse(request.query);
  const requestedTypes = new Set((query.types || '').split(',').map(value => value.trim()).filter(Boolean));
  const include = type => requestedTypes.size === 0 || requestedTypes.has(type);
  const records = [];
  if (include('project')) request.store.rdProjects.filter(item=>isOwnedByRequest(request,item)).forEach(item=>records.push({id:item.id,type:'project',title:item.name,subtitle:`${item.code} · ${item.beverage_category} · ${item.target_market}`,reference:item.code,status:item.status,project_id:item.id,updated_at:item.updated_at,route:`/projects?project=${item.id}`}));
  if (include('formulation')) accessibleFormulations(request).forEach(item=>records.push({id:item.id,type:'formulation',title:item.name,subtitle:`${item.code} · v${item.version} · ${item.beverage_type}`,reference:item.code,status:item.status,project_id:item.project_id||null,updated_at:item.updated_at,route:'/formulations'}));
  if (include('laboratory_result')) request.store.laboratoryResults.filter(item=>!item.deleted_at&&isOwnedByRequest(request,item)).forEach(item=>records.push({id:item.id,type:'laboratory_result',title:item.batch_code||'Laboratory result',subtitle:`Tested ${String(item.tested_at).slice(0,10)}`,reference:item.batch_code||item.id,status:'recorded',project_id:item.project_id||null,updated_at:item.updated_at||item.created_at,route:'/laboratory-results'}));
  if (include('document')) request.store.rdDocuments.filter(item=>isOwnedByRequest(request,item)).forEach(item=>records.push({id:item.id,type:'document',title:item.title,subtitle:`${item.document_type} · ${item.file_name} · ${item.source}`,reference:item.file_name,status:item.review_status,project_id:item.project_id,updated_at:item.updated_at,route:`/projects?project=${item.project_id}`}));
  if (include('production_trial')) request.store.rdProductionTrials.filter(item=>isOwnedByRequest(request,item)).forEach(item=>records.push({id:item.id,type:'production_trial',title:item.batch_code,subtitle:`${item.site} · ${item.line}`,reference:item.batch_code,status:item.status,project_id:item.project_id,updated_at:item.updated_at,route:`/projects?project=${item.project_id}`}));
  if (include('quality_event')) request.store.rdQualityEvents.filter(item=>isOwnedByRequest(request,item)).forEach(item=>records.push({id:item.id,type:'quality_event',title:item.title,subtitle:`${item.event_type} · ${item.severity}`,reference:item.id,status:item.status,project_id:item.project_id,updated_at:item.updated_at,route:`/projects?project=${item.project_id}`}));
  return { data: structuredWorkspaceSearch(query.q, records, query.limit), query: { q: query.q, types: [...requestedTypes], limit: query.limit }, searched_types: ['project','formulation','laboratory_result','document','production_trial','quality_event'].filter(include) };
});

server.post(`${apiPrefix}/projects`, async (request, reply) => {
  if (!ensureProjectStorage(request, reply)) return;
  const input = projectInputSchema.parse(request.body);
  const code = input.code || `RD-${new Date().getFullYear()}-${String(request.store.rdProjects.length + 1).padStart(3, '0')}`;
  if (request.store.rdProjects.some(item => isOwnedByRequest(request, item) && item.code.toLowerCase() === code.toLowerCase())) {
    return reply.code(409).send({ error: 'Project code already exists' });
  }
  const timestamp = new Date().toISOString();
  const project = {
    id: generateId(), owner_id: request.user?.id, ...input, code,
    stage: 'brief', status: 'draft', brief_status: 'draft',
    ingredient_constraints: input.ingredient_constraints || { required: [], forbidden: [], notes: '' },
    cost_objectives: input.cost_objectives || { currency: 'DZD' }, nutrition_objectives: input.nutrition_objectives || {},
    regulatory_constraints: input.regulatory_constraints || { markets: [], certifications: [], forbidden_additives: [] },
    success_criteria: input.success_criteria || [], created_at: timestamp, updated_at: timestamp,
  };
  request.store.rdProjects.push(project);
  addProjectEvent(request, project, 'created', { stage: project.stage, status: project.status });
  return reply.code(201).send({ data: project, allowed_transitions: projectTransitions.brief });
});

server.put(`${apiPrefix}/projects/:id`, async (request, reply) => {
  if (!ensureProjectStorage(request, reply)) return;
  const project = ownedProject(request, request.params.id);
  if (!project) return reply.code(404).send({ error: 'Project not found' });
  const updates = projectInputSchema.partial().extend({
    status: z.enum(['draft', 'active', 'on_hold', 'completed', 'archived']).optional(),
  }).strict().parse(request.body);
  if (updates.code && request.store.rdProjects.some(item => item.id !== project.id && isOwnedByRequest(request, item) && item.code.toLowerCase() === updates.code.toLowerCase())) {
    return reply.code(409).send({ error: 'Project code already exists' });
  }
  const beforeStatus = project.status;
  Object.assign(project, updates, { updated_at: new Date().toISOString() });
  addProjectEvent(request, project, 'updated', { fields: Object.keys(updates), previous_status: beforeStatus, status: project.status });
  return { data: project };
});

server.put(`${apiPrefix}/projects/:id/brief`, async (request, reply) => {
  if (!ensureProjectStorage(request, reply)) return;
  const project = ownedProject(request, request.params.id);
  if (!project) return reply.code(404).send({ error: 'Project not found' });
  const input = z.object({ brief: projectBriefSchema, validate: z.boolean().default(false) }).parse(request.body);
  Object.assign(project, input.brief, { brief_status: input.validate ? 'validated' : 'draft', updated_at: new Date().toISOString() });
  addProjectEvent(request, project, input.validate ? 'brief_validated' : 'brief_updated', {
    status: project.brief_status,
    constraint_counts: {
      required_ingredients: input.brief.ingredient_constraints.required.length,
      forbidden_ingredients: input.brief.ingredient_constraints.forbidden.length,
      success_criteria: input.brief.success_criteria.length,
    },
  });
  return { data: project, allowed_transitions: projectTransitions[project.stage] || [] };
});

server.post(`${apiPrefix}/projects/:id/transition`, async (request, reply) => {
  if (!ensureProjectStorage(request, reply)) return;
  const project = ownedProject(request, request.params.id);
  if (!project) return reply.code(404).send({ error: 'Project not found' });
  const input = z.object({ stage: z.enum(projectStages), note: z.string().trim().max(1000).default('') }).parse(request.body);
  const allowed = projectTransitions[project.stage] || [];
  if (!allowed.includes(input.stage)) {
    return reply.code(409).send({ error: `Invalid transition from ${project.stage} to ${input.stage}`, allowed_transitions: allowed });
  }
  if (project.stage === 'brief' && input.stage === 'concept' && project.brief_status !== 'validated') {
    return reply.code(409).send({ error: 'Validate the structured R&D brief before moving to Concept', code: 'PROJECT_BRIEF_VALIDATION_REQUIRED' });
  }
  const from = project.stage;
  project.stage = input.stage;
  project.status = input.stage === 'launched' ? 'completed' : 'active';
  project.updated_at = new Date().toISOString();
  addProjectEvent(request, project, 'stage_transition', { from, to: input.stage, note: input.note });
  return { data: project, allowed_transitions: projectTransitions[project.stage] || [] };
});

server.post(`${apiPrefix}/projects/:id/experimental-plans`, async (request, reply) => {
  if (!ensureProjectStorage(request, reply)) return;
  if (!ensureProjectExecutionStorage(request, reply)) return;
  const project = ownedProject(request, request.params.id);
  if (!project) return reply.code(404).send({ error: 'Project not found' });
  if (project.brief_status !== 'validated') return reply.code(409).send({ error: 'Validate the structured R&D brief before creating an experimental plan' });
  const input = experimentalPlanSchema.parse(request.body);
  if (!projectFormulationVersion(request, project, input.formulation_version_id)) return reply.code(400).send({ error: 'The experimental plan must reference an exact formulation version from this project' });
  const timestamp = new Date().toISOString();
  const plan = { id: generateId(), owner_id: request.user?.id, project_id: project.id, ...input, created_at: timestamp, updated_at: timestamp };
  request.store.rdExperimentalPlans.push(plan);
  addProjectEvent(request, project, 'experimental_plan_created', { plan_id: plan.id, formulation_version_id: plan.formulation_version_id, status: plan.status });
  return reply.code(201).send({ data: plan });
});

server.put(`${apiPrefix}/projects/:id/experimental-plans/:planId`, async (request, reply) => {
  if (!ensureProjectStorage(request, reply)) return;
  if (!ensureProjectExecutionStorage(request, reply)) return;
  const project = ownedProject(request, request.params.id);
  if (!project) return reply.code(404).send({ error: 'Project not found' });
  const plan = request.store.rdExperimentalPlans.find(item => item.id === request.params.planId && item.project_id === project.id && isOwnedByRequest(request, item));
  if (!plan) return reply.code(404).send({ error: 'Experimental plan not found' });
  const updates = experimentalPlanSchema.partial().parse(request.body);
  const versionId = updates.formulation_version_id || plan.formulation_version_id;
  if (!projectFormulationVersion(request, project, versionId)) return reply.code(400).send({ error: 'The experimental plan must reference an exact formulation version from this project' });
  Object.assign(plan, updates, { updated_at: new Date().toISOString() });
  addProjectEvent(request, project, 'experimental_plan_updated', { plan_id: plan.id, fields: Object.keys(updates), status: plan.status });
  return { data: plan };
});

server.post(`${apiPrefix}/projects/:id/experimental-plans/:planId/design`, async (request, reply) => {
  if (!ensureProjectStorage(request, reply)) return;
  if (!ensureProjectExecutionStorage(request, reply)) return;
  const project = ownedProject(request, request.params.id);
  if (!project) return reply.code(404).send({ error: 'Project not found' });
  const plan = request.store.rdExperimentalPlans.find(item => item.id === request.params.planId && item.project_id === project.id && isOwnedByRequest(request, item));
  if (!plan) return reply.code(404).send({ error: 'Experimental plan not found' });
  if (request.store.rdPilotBatches.some(item => item.experimental_plan_id === plan.id && item.doe_run_id)) {
    return reply.code(409).send({ error: 'The DOE design is locked after its first linked pilot batch. Create a new experimental plan to change factors or levels.', code: 'DOE_DESIGN_LOCKED' });
  }
  const input = doeDesignSchema.parse(request.body);
  const design = generateDoeDesign(input);
  plan.design = design;
  plan.planned_runs = design.run_count;
  plan.updated_at = new Date().toISOString();
  addProjectEvent(request, project, 'doe_design_generated', { plan_id: plan.id, engine_version: DOE_ENGINE_VERSION, signature: design.signature, design_type: design.design_type, run_count: design.run_count });
  return reply.code(201).send({ data: design });
});

server.get(`${apiPrefix}/projects/:id/experimental-plans/:planId/analysis`, async (request, reply) => {
  if (!ensureProjectStorage(request, reply)) return;
  if (!ensureProjectExecutionStorage(request, reply)) return;
  const project = ownedProject(request, request.params.id);
  if (!project) return reply.code(404).send({ error: 'Project not found' });
  const plan = request.store.rdExperimentalPlans.find(item => item.id === request.params.planId && item.project_id === project.id && isOwnedByRequest(request, item));
  if (!plan) return reply.code(404).send({ error: 'Experimental plan not found' });
  if (!plan.design) return reply.code(409).send({ error: 'Generate a deterministic DOE design before requesting analysis', code: 'DOE_DESIGN_REQUIRED' });
  const batches = request.store.rdPilotBatches.filter(item => item.experimental_plan_id === plan.id && isOwnedByRequest(request, item));
  return { data: analyzeDoeDesign(plan.design, batches) };
});

server.get(`${apiPrefix}/projects/:id/experimental-plans/:planId/report.csv`, async (request, reply) => {
  if (!ensureProjectStorage(request, reply)) return;
  if (!ensureProjectExecutionStorage(request, reply)) return;
  const project = ownedProject(request, request.params.id);
  if (!project) return reply.code(404).send({ error: 'Project not found' });
  const plan = request.store.rdExperimentalPlans.find(item => item.id === request.params.planId && item.project_id === project.id && isOwnedByRequest(request, item));
  if (!plan) return reply.code(404).send({ error: 'Experimental plan not found' });
  if (!plan.design) return reply.code(409).send({ error: 'Generate a deterministic DOE design before exporting its report', code: 'DOE_DESIGN_REQUIRED' });
  const batches = request.store.rdPilotBatches.filter(item => item.experimental_plan_id === plan.id && isOwnedByRequest(request, item));
  const filename = `${project.code}-${plan.name}`.replace(/[^a-z0-9-]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${filename}-doe.csv"`).send(buildDoeReportCsv(plan.design, batches));
});

server.post(`${apiPrefix}/projects/:id/stability-programs`, async (request, reply) => {
  if (!ensureProjectStorage(request, reply) || !ensureStabilityStorage(request, reply)) return;
  const project = ownedProject(request, request.params.id);
  if (!project) return reply.code(404).send({ error: 'Project not found' });
  const input = stabilityProgramSchema.parse(request.body);
  if (!projectFormulationVersion(request, project, input.formulation_version_id)) return reply.code(400).send({ error: 'The stability program must reference an exact formulation version from this project' });
  const timestamp = new Date().toISOString();
  const program = { id: generateId(), owner_id: request.user?.id, project_id: project.id, ...input, timepoints_days: [...input.timepoints_days].sort((a, b) => a - b), created_at: timestamp, updated_at: timestamp };
  request.store.rdStabilityPrograms.push(program);
  addProjectEvent(request, project, 'stability_program_created', { program_id: program.id, formulation_version_id: program.formulation_version_id, condition_count: program.storage_conditions.length, timepoint_count: program.timepoints_days.length });
  return reply.code(201).send({ data: program });
});

server.put(`${apiPrefix}/projects/:id/stability-programs/:programId`, async (request, reply) => {
  if (!ensureProjectStorage(request, reply) || !ensureStabilityStorage(request, reply)) return;
  const project = ownedProject(request, request.params.id);
  if (!project) return reply.code(404).send({ error: 'Project not found' });
  const program = request.store.rdStabilityPrograms.find(item => item.id === request.params.programId && item.project_id === project.id && isOwnedByRequest(request, item));
  if (!program) return reply.code(404).send({ error: 'Stability program not found' });
  const updates = stabilityProgramSchema.partial().parse(request.body);
  const hasObservations = request.store.rdStabilityObservations.some(item => item.program_id === program.id && isOwnedByRequest(request, item));
  if (hasObservations && Object.keys(updates).some(key => key !== 'status')) return reply.code(409).send({ error: 'The stability protocol is locked after its first observation. Create a new program to change conditions, timepoints or limits.', code: 'STABILITY_PROTOCOL_LOCKED' });
  const versionId = updates.formulation_version_id || program.formulation_version_id;
  if (!projectFormulationVersion(request, project, versionId)) return reply.code(400).send({ error: 'The stability program must reference an exact formulation version from this project' });
  Object.assign(program, updates, updates.timepoints_days ? { timepoints_days: [...updates.timepoints_days].sort((a, b) => a - b) } : {}, { updated_at: new Date().toISOString() });
  addProjectEvent(request, project, 'stability_program_updated', { program_id: program.id, fields: Object.keys(updates), status: program.status });
  return { data: program };
});

server.post(`${apiPrefix}/projects/:id/stability-programs/:programId/observations`, async (request, reply) => {
  if (!ensureProjectStorage(request, reply) || !ensureStabilityStorage(request, reply)) return;
  const project = ownedProject(request, request.params.id);
  if (!project) return reply.code(404).send({ error: 'Project not found' });
  const program = request.store.rdStabilityPrograms.find(item => item.id === request.params.programId && item.project_id === project.id && isOwnedByRequest(request, item));
  if (!program) return reply.code(404).send({ error: 'Stability program not found' });
  const input = z.object({ laboratory_result_id: z.string().trim().min(1), condition_id: z.string().trim().min(1), timepoint_days: z.coerce.number().int().min(0), replicate: z.coerce.number().int().min(1).max(20).default(1) }).parse(request.body);
  if (!program.storage_conditions.some(item => item.id === input.condition_id)) return reply.code(400).send({ error: 'Storage condition is not declared in this program', code: 'STABILITY_CONDITION_INVALID' });
  if (!program.timepoints_days.includes(input.timepoint_days)) return reply.code(400).send({ error: 'Timepoint is not declared in this program', code: 'STABILITY_TIMEPOINT_INVALID' });
  if (input.replicate > program.replicates_per_timepoint) return reply.code(400).send({ error: 'Replicate exceeds the declared protocol', code: 'STABILITY_REPLICATE_INVALID' });
  const laboratoryResult = request.store.laboratoryResults.find(item => item.id === input.laboratory_result_id && item.formulation_version_id === program.formulation_version_id && item.project_id === project.id && !item.deleted_at && isOwnedByRequest(request, item));
  if (!laboratoryResult) return reply.code(400).send({ error: 'Laboratory result must belong to the exact project and formulation version', code: 'STABILITY_LAB_RESULT_INVALID' });
  if (request.store.rdStabilityObservations.some(item => item.laboratory_result_id === laboratoryResult.id && isOwnedByRequest(request, item))) return reply.code(409).send({ error: 'This laboratory result is already linked to a stability observation', code: 'STABILITY_LAB_RESULT_ALREADY_LINKED' });
  if (request.store.rdStabilityObservations.some(item => item.program_id === program.id && item.condition_id === input.condition_id && item.timepoint_days === input.timepoint_days && item.replicate === input.replicate && isOwnedByRequest(request, item))) return reply.code(409).send({ error: 'This condition, timepoint and replicate slot is already recorded', code: 'STABILITY_SLOT_ALREADY_RECORDED' });
  const values = Object.fromEntries(program.parameters.flatMap(parameter => {
    const value = laboratoryResult[parameter.source]?.[parameter.key];
    return Number.isFinite(value) ? [[parameter.key, value]] : [];
  }));
  const observation = { id: generateId(), owner_id: request.user?.id, project_id: project.id, program_id: program.id, formulation_version_id: program.formulation_version_id, ...input, values, laboratory_tested_at: laboratoryResult.tested_at, recorded_at: new Date().toISOString() };
  request.store.rdStabilityObservations.push(observation);
  if (program.status === 'draft') { program.status = 'running'; program.updated_at = observation.recorded_at; }
  addProjectEvent(request, project, 'stability_observation_recorded', { program_id: program.id, observation_id: observation.id, laboratory_result_id: observation.laboratory_result_id, condition_id: observation.condition_id, timepoint_days: observation.timepoint_days, replicate: observation.replicate });
  return reply.code(201).send({ data: observation });
});

server.get(`${apiPrefix}/projects/:id/stability-programs/:programId/analysis`, async (request, reply) => {
  if (!ensureProjectStorage(request, reply) || !ensureStabilityStorage(request, reply)) return;
  const project = ownedProject(request, request.params.id);
  if (!project) return reply.code(404).send({ error: 'Project not found' });
  const program = request.store.rdStabilityPrograms.find(item => item.id === request.params.programId && item.project_id === project.id && isOwnedByRequest(request, item));
  if (!program) return reply.code(404).send({ error: 'Stability program not found' });
  const observations = request.store.rdStabilityObservations.filter(item => item.program_id === program.id && isOwnedByRequest(request, item));
  const specification = request.store.rdProductSpecifications.filter(item => item.formulation_version_id === program.formulation_version_id && item.status === 'approved' && isOwnedByRequest(request, item)).sort((a, b) => b.version - a.version)[0] || null;
  return { data: analyzeStabilityProgram(program, observations, specification) };
});

server.post(`${apiPrefix}/projects/:id/specifications`, async (request, reply) => {
  if (!ensureProjectStorage(request, reply) || !ensureStabilityStorage(request, reply)) return;
  const project = ownedProject(request, request.params.id);
  if (!project) return reply.code(404).send({ error: 'Project not found' });
  const input = productSpecificationSchema.parse(request.body);
  if (!projectFormulationVersion(request, project, input.formulation_version_id)) return reply.code(400).send({ error: 'The specification must reference an exact formulation version from this project' });
  const version = Math.max(0, ...request.store.rdProductSpecifications.filter(item => item.formulation_version_id === input.formulation_version_id && isOwnedByRequest(request, item)).map(item => item.version)) + 1;
  const timestamp = new Date().toISOString();
  const specification = { id: generateId(), owner_id: request.user?.id, project_id: project.id, ...input, version, status: 'draft', created_at: timestamp, updated_at: timestamp };
  request.store.rdProductSpecifications.push(specification);
  addProjectEvent(request, project, 'product_specification_created', { specification_id: specification.id, formulation_version_id: specification.formulation_version_id, version });
  return reply.code(201).send({ data: specification });
});

server.put(`${apiPrefix}/projects/:id/specifications/:specificationId`, async (request, reply) => {
  if (!ensureProjectStorage(request, reply) || !ensureStabilityStorage(request, reply)) return;
  const project = ownedProject(request, request.params.id);
  if (!project) return reply.code(404).send({ error: 'Project not found' });
  const specification = request.store.rdProductSpecifications.find(item => item.id === request.params.specificationId && item.project_id === project.id && isOwnedByRequest(request, item));
  if (!specification) return reply.code(404).send({ error: 'Product specification not found' });
  if (specification.status !== 'draft') return reply.code(409).send({ error: 'Approved, superseded or withdrawn specifications are immutable', code: 'SPECIFICATION_LOCKED' });
  const updates = productSpecificationSchema.partial().parse(request.body);
  const versionId = updates.formulation_version_id || specification.formulation_version_id;
  if (!projectFormulationVersion(request, project, versionId)) return reply.code(400).send({ error: 'The specification must reference an exact formulation version from this project' });
  Object.assign(specification, updates, { updated_at: new Date().toISOString() });
  addProjectEvent(request, project, 'product_specification_updated', { specification_id: specification.id, fields: Object.keys(updates) });
  return { data: specification };
});

server.post(`${apiPrefix}/projects/:id/specifications/:specificationId/approve`, async (request, reply) => {
  if (!ensureProjectStorage(request, reply) || !ensureStabilityStorage(request, reply)) return;
  const project = ownedProject(request, request.params.id);
  if (!project) return reply.code(404).send({ error: 'Project not found' });
  const specification = request.store.rdProductSpecifications.find(item => item.id === request.params.specificationId && item.project_id === project.id && isOwnedByRequest(request, item));
  if (!specification) return reply.code(404).send({ error: 'Product specification not found' });
  if (specification.status !== 'draft') return reply.code(409).send({ error: 'Only a draft specification can be approved', code: 'SPECIFICATION_NOT_DRAFT' });
  const input = z.object({ rationale: z.string().trim().min(10).max(3000), evidence_refs: z.array(z.string().trim().min(1).max(200)).min(1).max(30) }).parse(request.body);
  const decidedAt = new Date().toISOString();
  request.store.rdProductSpecifications.filter(item => item.formulation_version_id === specification.formulation_version_id && item.status === 'approved' && isOwnedByRequest(request, item)).forEach(item => { item.status = 'superseded'; item.updated_at = decidedAt; });
  specification.status = 'approved'; specification.approved_at = decidedAt; specification.approved_by = request.user?.id; specification.updated_at = decidedAt;
  const approval = { id: generateId(), owner_id: request.user?.id, actor_id: request.user?.id, project_id: project.id, specification_id: specification.id, outcome: 'approved', ...input, decided_at: decidedAt };
  request.store.rdSpecificationApprovals.push(approval);
  addProjectEvent(request, project, 'product_specification_approved', { specification_id: specification.id, formulation_version_id: specification.formulation_version_id, version: specification.version, approval_id: approval.id, evidence_refs: input.evidence_refs });
  return reply.code(201).send({ data: specification, approval });
});

// ============================================================================
// SUPPLIERS, CONTROLLED DOCUMENTS AND PACKAGING
// ============================================================================

server.get(`${apiPrefix}/supply-chain`, async (request, reply) => {
  if (!ensureSupplyChainStorage(request, reply)) return;
  const owned = items => items.filter(item => isOwnedByRequest(request, item));
  return { data: {
    suppliers: owned(request.store.rdSuppliers).sort((a, b) => a.name.localeCompare(b.name)),
    supplier_materials: owned(request.store.rdSupplierMaterials).sort((a, b) => a.name.localeCompare(b.name)),
    material_specifications: owned(request.store.rdMaterialSpecifications).sort((a, b) => b.version - a.version),
    packaging_components: owned(request.store.rdPackagingComponents).sort((a, b) => a.name.localeCompare(b.name)),
  } };
});

server.post(`${apiPrefix}/supply-chain/suppliers`, async (request, reply) => {
  if (!ensureSupplyChainStorage(request, reply)) return;
  const input = supplierSchema.parse(request.body);
  if (request.store.rdSuppliers.some(item => isOwnedByRequest(request, item) && item.name.toLowerCase() === input.name.toLowerCase())) return reply.code(409).send({ error: 'Supplier name already exists in this workspace' });
  const timestamp = new Date().toISOString();
  const supplier = { id: generateId(), owner_id: request.user?.id, ...input, created_at: timestamp, updated_at: timestamp };
  request.store.rdSuppliers.push(supplier);
  return reply.code(201).send({ data: supplier });
});

server.put(`${apiPrefix}/supply-chain/suppliers/:supplierId`, async (request, reply) => {
  if (!ensureSupplyChainStorage(request, reply)) return;
  const supplier = request.store.rdSuppliers.find(item => item.id === request.params.supplierId && isOwnedByRequest(request, item));
  if (!supplier) return reply.code(404).send({ error: 'Supplier not found' });
  const updates = supplierSchema.partial().parse(request.body);
  if (updates.name && request.store.rdSuppliers.some(item => item.id !== supplier.id && isOwnedByRequest(request, item) && item.name.toLowerCase() === updates.name.toLowerCase())) return reply.code(409).send({ error: 'Supplier name already exists in this workspace' });
  Object.assign(supplier, updates, { updated_at: new Date().toISOString() });
  return { data: supplier };
});

server.post(`${apiPrefix}/supply-chain/suppliers/:supplierId/materials`, async (request, reply) => {
  if (!ensureSupplyChainStorage(request, reply)) return;
  const supplier = request.store.rdSuppliers.find(item => item.id === request.params.supplierId && isOwnedByRequest(request, item));
  if (!supplier) return reply.code(404).send({ error: 'Supplier not found' });
  const input = supplierMaterialSchema.parse(request.body);
  if (input.ingredient_id && !request.store.ingredients.some(item => item.id === input.ingredient_id)) return reply.code(400).send({ error: 'Catalog ingredient not found' });
  if (request.store.rdSupplierMaterials.some(item => item.supplier_id === supplier.id && item.material_code.toLowerCase() === input.material_code.toLowerCase() && isOwnedByRequest(request, item))) return reply.code(409).send({ error: 'Material code already exists for this supplier' });
  const timestamp = new Date().toISOString();
  const material = { id: generateId(), owner_id: request.user?.id, supplier_id: supplier.id, ...input, created_at: timestamp, updated_at: timestamp };
  request.store.rdSupplierMaterials.push(material);
  return reply.code(201).send({ data: material });
});

server.put(`${apiPrefix}/supply-chain/materials/:materialId`, async (request, reply) => {
  if (!ensureSupplyChainStorage(request, reply)) return;
  const material = request.store.rdSupplierMaterials.find(item => item.id === request.params.materialId && isOwnedByRequest(request, item));
  if (!material) return reply.code(404).send({ error: 'Supplier material not found' });
  const updates = supplierMaterialSchema.partial().parse(request.body);
  if (updates.ingredient_id && !request.store.ingredients.some(item => item.id === updates.ingredient_id)) return reply.code(400).send({ error: 'Catalog ingredient not found' });
  Object.assign(material, updates, { updated_at: new Date().toISOString() });
  return { data: material };
});

server.post(`${apiPrefix}/supply-chain/materials/:materialId/specifications`, async (request, reply) => {
  if (!ensureSupplyChainStorage(request, reply)) return;
  const material = request.store.rdSupplierMaterials.find(item => item.id === request.params.materialId && isOwnedByRequest(request, item));
  if (!material) return reply.code(404).send({ error: 'Supplier material not found' });
  const input = materialSpecificationSchema.parse(request.body);
  const version = Math.max(0, ...request.store.rdMaterialSpecifications.filter(item => item.supplier_material_id === material.id && isOwnedByRequest(request, item)).map(item => item.version)) + 1;
  const timestamp = new Date().toISOString();
  const specification = { id: generateId(), owner_id: request.user?.id, supplier_material_id: material.id, ...input, version, status: 'draft', created_at: timestamp, updated_at: timestamp };
  request.store.rdMaterialSpecifications.push(specification);
  return reply.code(201).send({ data: specification });
});

server.post(`${apiPrefix}/supply-chain/material-specifications/:specificationId/approve`, async (request, reply) => {
  if (!ensureSupplyChainStorage(request, reply)) return;
  const specification = request.store.rdMaterialSpecifications.find(item => item.id === request.params.specificationId && isOwnedByRequest(request, item));
  if (!specification) return reply.code(404).send({ error: 'Material specification not found' });
  if (specification.status !== 'draft') return reply.code(409).send({ error: 'Only a draft material specification can be approved', code: 'MATERIAL_SPECIFICATION_LOCKED' });
  const input = z.object({ rationale: z.string().trim().min(10).max(3000), evidence_refs: z.array(z.string().trim().min(1).max(200)).min(1).max(30) }).parse(request.body);
  const evidenceDocuments = input.evidence_refs.map(reference => request.store.rdDocuments.find(item => item.id === reference && isOwnedByRequest(request, item)));
  if (evidenceDocuments.some(item => !item)) return reply.code(400).send({ error: 'Every evidence reference must identify an existing controlled document', code: 'MATERIAL_SPECIFICATION_EVIDENCE_NOT_FOUND' });
  if (evidenceDocuments.some(item => item.review_status !== 'accepted')) return reply.code(400).send({ error: 'Every evidence document must be accepted before it can support an approval', code: 'MATERIAL_SPECIFICATION_EVIDENCE_NOT_ACCEPTED' });
  if (evidenceDocuments.some(item => item.supplier_material_id !== specification.supplier_material_id)) return reply.code(400).send({ error: 'Every evidence document must be linked to the supplier material covered by this specification', code: 'MATERIAL_SPECIFICATION_EVIDENCE_MISMATCH' });
  const timestamp = new Date().toISOString();
  request.store.rdMaterialSpecifications.filter(item => item.supplier_material_id === specification.supplier_material_id && item.status === 'approved' && isOwnedByRequest(request, item)).forEach(item => { item.status = 'superseded'; item.updated_at = timestamp; });
  Object.assign(specification, { status: 'approved', approved_at: timestamp, approved_by: request.user?.id, rationale: input.rationale, evidence_refs: input.evidence_refs, updated_at: timestamp });
  return { data: specification };
});

server.post(`${apiPrefix}/supply-chain/packaging-components`, async (request, reply) => {
  if (!ensureSupplyChainStorage(request, reply)) return;
  const input = packagingComponentSchema.parse(request.body);
  if (input.supplier_id && !request.store.rdSuppliers.some(item => item.id === input.supplier_id && isOwnedByRequest(request, item))) return reply.code(400).send({ error: 'Supplier not found in this workspace' });
  if (request.store.rdPackagingComponents.some(item => item.code.toLowerCase() === input.code.toLowerCase() && isOwnedByRequest(request, item))) return reply.code(409).send({ error: 'Packaging component code already exists' });
  const timestamp = new Date().toISOString();
  const component = { id: generateId(), owner_id: request.user?.id, ...input, created_at: timestamp, updated_at: timestamp };
  request.store.rdPackagingComponents.push(component);
  return reply.code(201).send({ data: component });
});

server.put(`${apiPrefix}/supply-chain/packaging-components/:componentId`, async (request, reply) => {
  if (!ensureSupplyChainStorage(request, reply)) return;
  const component = request.store.rdPackagingComponents.find(item => item.id === request.params.componentId && isOwnedByRequest(request, item));
  if (!component) return reply.code(404).send({ error: 'Packaging component not found' });
  const updates = packagingComponentSchema.partial().parse(request.body);
  if (updates.supplier_id && !request.store.rdSuppliers.some(item => item.id === updates.supplier_id && isOwnedByRequest(request, item))) return reply.code(400).send({ error: 'Supplier not found in this workspace' });
  Object.assign(component, updates, { updated_at: new Date().toISOString() });
  return { data: component };
});

server.post(`${apiPrefix}/projects/:id/documents`, async (request, reply) => {
  if (!ensureProjectStorage(request, reply) || !ensureSupplyChainStorage(request, reply)) return;
  const project = ownedProject(request, request.params.id);
  if (!project) return reply.code(404).send({ error: 'Project not found' });
  const input = documentSchema.parse(request.body);
  const supplier = input.supplier_id ? request.store.rdSuppliers.find(item => item.id === input.supplier_id && isOwnedByRequest(request, item)) : null;
  const material = input.supplier_material_id ? request.store.rdSupplierMaterials.find(item => item.id === input.supplier_material_id && isOwnedByRequest(request, item)) : null;
  if (input.supplier_id && !supplier) return reply.code(400).send({ error: 'Supplier not found in this workspace' });
  if (input.supplier_material_id && (!material || (input.supplier_id && material.supplier_id !== input.supplier_id))) return reply.code(400).send({ error: 'Supplier material does not match the selected supplier' });
  if (input.formulation_version_id && !projectFormulationVersion(request, project, input.formulation_version_id)) return reply.code(400).send({ error: 'Document formulation version does not belong to this project' });
  if (request.store.rdDocuments.some(item => item.sha256 === input.sha256 && isOwnedByRequest(request, item))) return reply.code(409).send({ error: 'This exact document is already registered', code: 'DOCUMENT_DUPLICATE_CHECKSUM' });
  const timestamp = new Date().toISOString();
  const document = { id: generateId(), owner_id: request.user?.id, project_id: project.id, ...input, review_status: 'pending', created_at: timestamp, updated_at: timestamp };
  request.store.rdDocuments.push(document);
  addProjectEvent(request, project, 'document_registered', { document_id: document.id, document_type: document.document_type, sha256: document.sha256, supplier_id: document.supplier_id || null, supplier_material_id: document.supplier_material_id || null });
  return reply.code(201).send({ data: document });
});

server.post(`${apiPrefix}/projects/:id/documents/:documentId/review`, async (request, reply) => {
  if (!ensureProjectStorage(request, reply) || !ensureSupplyChainStorage(request, reply)) return;
  const project = ownedProject(request, request.params.id);
  if (!project) return reply.code(404).send({ error: 'Project not found' });
  const document = request.store.rdDocuments.find(item => item.id === request.params.documentId && item.project_id === project.id && isOwnedByRequest(request, item));
  if (!document) return reply.code(404).send({ error: 'Document not found' });
  if (document.review_status !== 'pending') return reply.code(409).send({ error: 'Reviewed documents are immutable; register a revision instead', code: 'DOCUMENT_REVIEW_LOCKED' });
  const input = z.object({ outcome: z.enum(['accepted', 'rejected']), review_notes: z.string().trim().min(10).max(3000) }).parse(request.body);
  Object.assign(document, { review_status: input.outcome, review_notes: input.review_notes, reviewed_by: request.user?.id, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  addProjectEvent(request, project, 'document_reviewed', { document_id: document.id, outcome: input.outcome, sha256: document.sha256 });
  return { data: document };
});

function packagingContext(request, formulationVersionId) {
  const observations = request.store.rdStabilityObservations.filter(item => item.formulation_version_id === formulationVersionId && isOwnedByRequest(request, item));
  return { stability_coverage_days: Math.max(0, ...observations.map(item => Number(item.timepoint_days) || 0)) };
}

server.post(`${apiPrefix}/projects/:id/packaging-configurations`, async (request, reply) => {
  if (!ensureProjectStorage(request, reply) || !ensureSupplyChainStorage(request, reply)) return;
  const project = ownedProject(request, request.params.id);
  if (!project) return reply.code(404).send({ error: 'Project not found' });
  const input = packagingConfigurationSchema.parse(request.body);
  if (!projectFormulationVersion(request, project, input.formulation_version_id)) return reply.code(400).send({ error: 'Packaging configuration must reference an exact formulation version from this project' });
  const componentIds = new Set(input.components.map(item => item.component_id));
  if (componentIds.size !== input.components.length) return reply.code(400).send({ error: 'Each packaging component can appear only once in a configuration' });
  if ([...componentIds].some(id => !request.store.rdPackagingComponents.some(item => item.id === id && isOwnedByRequest(request, item)))) return reply.code(400).send({ error: 'A packaging component is missing or belongs to another workspace' });
  const version = Math.max(0, ...request.store.rdPackagingConfigurations.filter(item => item.formulation_version_id === input.formulation_version_id && isOwnedByRequest(request, item)).map(item => item.version)) + 1;
  const timestamp = new Date().toISOString();
  const configuration = { id: generateId(), owner_id: request.user?.id, project_id: project.id, ...input, version, status: 'draft', created_at: timestamp, updated_at: timestamp };
  configuration.analysis = analyzePackagingConfiguration(configuration, request.store.rdPackagingComponents.filter(item => isOwnedByRequest(request, item)), packagingContext(request, configuration.formulation_version_id));
  request.store.rdPackagingConfigurations.push(configuration);
  addProjectEvent(request, project, 'packaging_configuration_created', { configuration_id: configuration.id, formulation_version_id: configuration.formulation_version_id, version, cost_per_sale_unit: configuration.analysis.economics.cost_per_sale_unit });
  return reply.code(201).send({ data: configuration });
});

server.put(`${apiPrefix}/projects/:id/packaging-configurations/:configurationId`, async (request, reply) => {
  if (!ensureProjectStorage(request, reply) || !ensureSupplyChainStorage(request, reply)) return;
  const project = ownedProject(request, request.params.id);
  if (!project) return reply.code(404).send({ error: 'Project not found' });
  const configuration = request.store.rdPackagingConfigurations.find(item => item.id === request.params.configurationId && item.project_id === project.id && isOwnedByRequest(request, item));
  if (!configuration) return reply.code(404).send({ error: 'Packaging configuration not found' });
  if (configuration.status !== 'draft') return reply.code(409).send({ error: 'Approved packaging configurations are immutable; create a new revision', code: 'PACKAGING_CONFIGURATION_LOCKED' });
  const updates = packagingConfigurationSchema.partial().parse(request.body);
  const versionId = updates.formulation_version_id || configuration.formulation_version_id;
  if (!projectFormulationVersion(request, project, versionId)) return reply.code(400).send({ error: 'Packaging configuration must reference an exact formulation version from this project' });
  const lines = updates.components || configuration.components;
  if (new Set(lines.map(item => item.component_id)).size !== lines.length || lines.some(line => !request.store.rdPackagingComponents.some(item => item.id === line.component_id && isOwnedByRequest(request, item)))) return reply.code(400).send({ error: 'Packaging components must be unique and belong to this workspace' });
  Object.assign(configuration, updates, { updated_at: new Date().toISOString() });
  configuration.analysis = analyzePackagingConfiguration(configuration, request.store.rdPackagingComponents.filter(item => isOwnedByRequest(request, item)), packagingContext(request, versionId));
  addProjectEvent(request, project, 'packaging_configuration_updated', { configuration_id: configuration.id, fields: Object.keys(updates) });
  return { data: configuration };
});

server.get(`${apiPrefix}/projects/:id/packaging-configurations/:configurationId/analysis`, async (request, reply) => {
  if (!ensureProjectStorage(request, reply) || !ensureSupplyChainStorage(request, reply)) return;
  const project = ownedProject(request, request.params.id);
  if (!project) return reply.code(404).send({ error: 'Project not found' });
  const configuration = request.store.rdPackagingConfigurations.find(item => item.id === request.params.configurationId && item.project_id === project.id && isOwnedByRequest(request, item));
  if (!configuration) return reply.code(404).send({ error: 'Packaging configuration not found' });
  const analysis = analyzePackagingConfiguration(configuration, request.store.rdPackagingComponents.filter(item => isOwnedByRequest(request, item)), packagingContext(request, configuration.formulation_version_id));
  return { data: analysis };
});

server.post(`${apiPrefix}/projects/:id/packaging-configurations/:configurationId/approve`, async (request, reply) => {
  if (!ensureProjectStorage(request, reply) || !ensureSupplyChainStorage(request, reply)) return;
  const project = ownedProject(request, request.params.id);
  if (!project) return reply.code(404).send({ error: 'Project not found' });
  const configuration = request.store.rdPackagingConfigurations.find(item => item.id === request.params.configurationId && item.project_id === project.id && isOwnedByRequest(request, item));
  if (!configuration) return reply.code(404).send({ error: 'Packaging configuration not found' });
  if (configuration.status !== 'draft') return reply.code(409).send({ error: 'Only a draft packaging configuration can be approved', code: 'PACKAGING_CONFIGURATION_LOCKED' });
  const input = z.object({ rationale: z.string().trim().min(10).max(3000), evidence_refs: z.array(z.string().trim().min(1).max(200)).min(1).max(30), accept_warnings: z.boolean().default(false) }).parse(request.body);
  const analysis = analyzePackagingConfiguration(configuration, request.store.rdPackagingComponents.filter(item => isOwnedByRequest(request, item)), packagingContext(request, configuration.formulation_version_id));
  if (analysis.warnings.length && !input.accept_warnings) return reply.code(409).send({ error: 'Resolve packaging warnings or explicitly accept them with documented rationale', code: 'PACKAGING_WARNINGS_REQUIRE_ACCEPTANCE', analysis });
  const timestamp = new Date().toISOString();
  request.store.rdPackagingConfigurations.filter(item => item.formulation_version_id === configuration.formulation_version_id && item.status === 'approved' && isOwnedByRequest(request, item)).forEach(item => { item.status = 'superseded'; item.updated_at = timestamp; });
  Object.assign(configuration, { status: 'approved', analysis, approved_at: timestamp, approved_by: request.user?.id, approval_rationale: input.rationale, evidence_refs: input.evidence_refs, warnings_accepted: Boolean(input.accept_warnings), updated_at: timestamp });
  addProjectEvent(request, project, 'packaging_configuration_approved', { configuration_id: configuration.id, formulation_version_id: configuration.formulation_version_id, version: configuration.version, warnings_accepted: configuration.warnings_accepted, evidence_refs: input.evidence_refs });
  return { data: configuration };
});

// ============================================================================
// INDUSTRIALIZATION, QC RELEASE, OOS / DEVIATION AND CAPA
// ============================================================================

server.post(`${apiPrefix}/projects/:id/production-trials`, async (request, reply) => {
  if (!ensureProjectStorage(request, reply) || !ensureIndustrialQualityStorage(request, reply)) return;
  const project = ownedProject(request, request.params.id); if (!project) return reply.code(404).send({error:'Project not found'});
  const input = productionTrialSchema.parse(request.body);
  if (!projectFormulationVersion(request,project,input.formulation_version_id)) return reply.code(400).send({error:'Production trial must reference an exact formulation version from this project'});
  if (input.packaging_configuration_id) {
    const packaging = request.store.rdPackagingConfigurations.find(item=>item.id===input.packaging_configuration_id&&item.project_id===project.id&&item.formulation_version_id===input.formulation_version_id&&item.status==='approved'&&isOwnedByRequest(request,item));
    if (!packaging) return reply.code(400).send({error:'Production trial packaging must be an approved configuration for the exact formulation version'});
  }
  if (input.material_lots.some(lot=>lot.supplier_material_id&&!request.store.rdSupplierMaterials.some(item=>item.id===lot.supplier_material_id&&item.status==='approved'&&isOwnedByRequest(request,item)))) return reply.code(400).send({error:'Every linked supplier material lot must reference an approved material in this workspace'});
  if (request.store.rdProductionTrials.some(item=>item.project_id===project.id&&item.batch_code.toLowerCase()===input.batch_code.toLowerCase()&&isOwnedByRequest(request,item))) return reply.code(409).send({error:'Production batch code already exists in this project'});
  const timestamp=new Date().toISOString(); const trial={id:generateId(),owner_id:request.user?.id,project_id:project.id,...input,created_at:timestamp,updated_at:timestamp};
  trial.analysis=analyzeProductionTrial(trial); request.store.rdProductionTrials.push(trial);
  addProjectEvent(request,project,'production_trial_created',{production_trial_id:trial.id,batch_code:trial.batch_code,formulation_version_id:trial.formulation_version_id,planned_batch_size_liters:trial.planned_batch_size_liters});
  return reply.code(201).send({data:trial});
});

server.put(`${apiPrefix}/projects/:id/production-trials/:trialId`, async (request, reply) => {
  if (!ensureProjectStorage(request, reply) || !ensureIndustrialQualityStorage(request, reply)) return;
  const project=ownedProject(request,request.params.id); if(!project)return reply.code(404).send({error:'Project not found'});
  const trial=request.store.rdProductionTrials.find(item=>item.id===request.params.trialId&&item.project_id===project.id&&isOwnedByRequest(request,item)); if(!trial)return reply.code(404).send({error:'Production trial not found'});
  if(trial.status==='completed'||trial.status==='cancelled')return reply.code(409).send({error:'Completed or cancelled production trials are immutable',code:'PRODUCTION_TRIAL_LOCKED'});
  const updates=productionTrialSchema.partial().parse(request.body); const versionId=updates.formulation_version_id||trial.formulation_version_id;
  if(!projectFormulationVersion(request,project,versionId))return reply.code(400).send({error:'Production trial must reference an exact formulation version from this project'});
  if(updates.material_lots?.some(lot=>lot.supplier_material_id&&!request.store.rdSupplierMaterials.some(item=>item.id===lot.supplier_material_id&&item.status==='approved'&&isOwnedByRequest(request,item))))return reply.code(400).send({error:'Every linked supplier material lot must reference an approved material'});
  Object.assign(trial,updates,{updated_at:new Date().toISOString()}); trial.analysis=analyzeProductionTrial(trial);
  addProjectEvent(request,project,'production_trial_updated',{production_trial_id:trial.id,status:trial.status,yield_percent:trial.analysis.mass_balance.yield_percent,process_status:trial.analysis.status});
  return {data:trial};
});

server.post(`${apiPrefix}/projects/:id/qc-releases`, async (request, reply) => {
  if (!ensureProjectStorage(request, reply) || !ensureIndustrialQualityStorage(request, reply)) return;
  const project=ownedProject(request,request.params.id); if(!project)return reply.code(404).send({error:'Project not found'});
  const input=qcReleaseSchema.parse(request.body);
  const trial=request.store.rdProductionTrials.find(item=>item.id===input.production_trial_id&&item.project_id===project.id&&isOwnedByRequest(request,item));
  if(!trial)return reply.code(400).send({error:'Production trial not found in this project'}); if(trial.status!=='completed')return reply.code(409).send({error:'Complete and lock the production trial before QC disposition',code:'PRODUCTION_TRIAL_NOT_COMPLETED'});
  if(request.store.rdQcReleases.some(item=>item.production_trial_id===trial.id&&isOwnedByRequest(request,item)))return reply.code(409).send({error:'A QC disposition already exists for this production trial',code:'QC_RELEASE_IMMUTABLE'});
  const specification=request.store.rdProductSpecifications.find(item=>item.id===input.specification_id&&item.project_id===project.id&&item.formulation_version_id===trial.formulation_version_id&&item.status==='approved'&&isOwnedByRequest(request,item));
  if(!specification)return reply.code(400).send({error:'QC release requires the approved specification for the exact formulation version'});
  const resultIds=new Set(input.laboratory_result_ids); const laboratoryResults=request.store.laboratoryResults.filter(item=>resultIds.has(item.id)&&item.project_id===project.id&&item.formulation_version_id===trial.formulation_version_id&&!item.deleted_at&&isOwnedByRequest(request,item));
  if(laboratoryResults.length!==resultIds.size)return reply.code(400).send({error:'Every QC laboratory result must belong to the exact project and formulation version'});
  const evaluation=evaluateQcRelease(specification,laboratoryResults); const disposition=evaluation.disposition==='eligible_for_release'?'released':evaluation.disposition;
  const release={id:generateId(),owner_id:request.user?.id,actor_id:request.user?.id,project_id:project.id,production_trial_id:trial.id,formulation_version_id:trial.formulation_version_id,specification_id:specification.id,laboratory_result_ids:input.laboratory_result_ids,notes:input.notes,evaluation,disposition,decided_at:new Date().toISOString()};
  request.store.rdQcReleases.push(release); addProjectEvent(request,project,'qc_disposition_recorded',{qc_release_id:release.id,production_trial_id:trial.id,disposition,specification_id:specification.id,laboratory_result_ids:release.laboratory_result_ids});
  let qualityEvent=null;
  if(disposition==='out_of_specification'){
    const timestamp=new Date().toISOString(); qualityEvent={id:generateId(),owner_id:request.user?.id,project_id:project.id,production_trial_id:trial.id,qc_release_id:release.id,event_type:'out_of_specification',severity:'major',title:`OOS — ${trial.batch_code}`,description:'An approved finished-product limit failed during deterministic QC evaluation.',immediate_action:'Batch placed on hold pending investigation.',owner:'Quality',due_date:null,status:'open',root_cause:'',investigation_notes:'',disposition:'',created_at:timestamp,updated_at:timestamp};
    request.store.rdQualityEvents.push(qualityEvent); addProjectEvent(request,project,'quality_event_opened',{quality_event_id:qualityEvent.id,event_type:qualityEvent.event_type,qc_release_id:release.id,severity:qualityEvent.severity});
  }
  return reply.code(201).send({data:release,quality_event:qualityEvent});
});

server.post(`${apiPrefix}/projects/:id/quality-events`, async (request, reply) => {
  if (!ensureProjectStorage(request, reply) || !ensureIndustrialQualityStorage(request, reply)) return;
  const project=ownedProject(request,request.params.id); if(!project)return reply.code(404).send({error:'Project not found'}); const input=qualityEventSchema.parse(request.body);
  if(input.production_trial_id&&!request.store.rdProductionTrials.some(item=>item.id===input.production_trial_id&&item.project_id===project.id&&isOwnedByRequest(request,item)))return reply.code(400).send({error:'Production trial not found in this project'});
  if(input.qc_release_id&&!request.store.rdQcReleases.some(item=>item.id===input.qc_release_id&&item.project_id===project.id&&isOwnedByRequest(request,item)))return reply.code(400).send({error:'QC release not found in this project'});
  const timestamp=new Date().toISOString(); const event={id:generateId(),owner_id:request.user?.id,project_id:project.id,...input,status:'open',root_cause:'',investigation_notes:'',disposition:'',created_at:timestamp,updated_at:timestamp}; request.store.rdQualityEvents.push(event);
  addProjectEvent(request,project,'quality_event_opened',{quality_event_id:event.id,event_type:event.event_type,severity:event.severity,production_trial_id:event.production_trial_id||null}); return reply.code(201).send({data:event});
});

server.put(`${apiPrefix}/projects/:id/quality-events/:eventId`, async (request, reply) => {
  if (!ensureProjectStorage(request, reply) || !ensureIndustrialQualityStorage(request, reply)) return;
  const project=ownedProject(request,request.params.id); if(!project)return reply.code(404).send({error:'Project not found'}); const event=request.store.rdQualityEvents.find(item=>item.id===request.params.eventId&&item.project_id===project.id&&isOwnedByRequest(request,item)); if(!event)return reply.code(404).send({error:'Quality event not found'});
  if(event.status==='closed')return reply.code(409).send({error:'Closed quality events are immutable',code:'QUALITY_EVENT_LOCKED'});
  const updates=z.object({status:z.enum(['open','investigating','capa_required','closed']).optional(),root_cause:z.string().trim().max(5000).optional(),investigation_notes:z.string().trim().max(5000).optional(),disposition:z.string().trim().max(2000).optional(),owner:z.string().trim().max(120).optional(),due_date:z.string().date().nullable().optional()}).parse(request.body);
  const merged={...event,...updates}; if(merged.status==='closed'&&(!merged.root_cause||merged.root_cause.length<10||!merged.disposition||merged.disposition.length<5))return reply.code(409).send({error:'Root cause and disposition are required before closure',code:'QUALITY_INVESTIGATION_INCOMPLETE'});
  const capas=request.store.rdCapaActions.filter(item=>item.quality_event_id===event.id&&isOwnedByRequest(request,item)); if(merged.status==='closed'&&capas.some(item=>item.status!=='effectiveness_verified'&&item.status!=='cancelled'))return reply.code(409).send({error:'Every active CAPA requires an effectiveness decision before event closure',code:'CAPA_EFFECTIVENESS_REQUIRED'});
  Object.assign(event,updates,{...(updates.status==='closed'?{closed_at:new Date().toISOString(),closed_by:request.user?.id}:{}),updated_at:new Date().toISOString()}); addProjectEvent(request,project,'quality_event_updated',{quality_event_id:event.id,status:event.status}); return {data:event};
});

server.post(`${apiPrefix}/projects/:id/quality-events/:eventId/capas`, async (request, reply) => {
  if (!ensureProjectStorage(request, reply) || !ensureIndustrialQualityStorage(request, reply)) return;
  const project=ownedProject(request,request.params.id);if(!project)return reply.code(404).send({error:'Project not found'});const event=request.store.rdQualityEvents.find(item=>item.id===request.params.eventId&&item.project_id===project.id&&isOwnedByRequest(request,item));if(!event)return reply.code(404).send({error:'Quality event not found'});if(event.status==='closed')return reply.code(409).send({error:'Cannot add CAPA to a closed quality event'});
  const input=capaSchema.parse(request.body);const timestamp=new Date().toISOString();const capa={id:generateId(),owner_id:request.user?.id,project_id:project.id,quality_event_id:event.id,...input,created_at:timestamp,updated_at:timestamp,...(input.status==='effectiveness_verified'?{verified_at:timestamp,verified_by:request.user?.id}:{})};request.store.rdCapaActions.push(capa);if(event.status==='open')event.status='capa_required';event.updated_at=timestamp;addProjectEvent(request,project,'capa_created',{capa_id:capa.id,quality_event_id:event.id,action_type:capa.action_type});return reply.code(201).send({data:capa});
});

server.put(`${apiPrefix}/projects/:id/capas/:capaId`, async (request, reply) => {
  if (!ensureProjectStorage(request, reply) || !ensureIndustrialQualityStorage(request, reply)) return;
  const project=ownedProject(request,request.params.id);if(!project)return reply.code(404).send({error:'Project not found'});const capa=request.store.rdCapaActions.find(item=>item.id===request.params.capaId&&item.project_id===project.id&&isOwnedByRequest(request,item));if(!capa)return reply.code(404).send({error:'CAPA not found'});if(capa.status==='effectiveness_verified'||capa.status==='cancelled')return reply.code(409).send({error:'Verified or cancelled CAPA records are immutable',code:'CAPA_LOCKED'});
  const updates=capaUpdateSchema.parse(request.body);const merged={...capa,...updates};if(merged.status==='effectiveness_verified'&&!merged.effectiveness_evidence)return reply.code(409).send({error:'Effectiveness evidence is required before verification',code:'CAPA_EVIDENCE_REQUIRED'});Object.assign(capa,updates,{...(updates.status==='effectiveness_verified'?{verified_at:new Date().toISOString(),verified_by:request.user?.id}:{}),updated_at:new Date().toISOString()});addProjectEvent(request,project,'capa_updated',{capa_id:capa.id,quality_event_id:capa.quality_event_id,status:capa.status});return {data:capa};
});

server.post(`${apiPrefix}/projects/:id/experimental-plans/:planId/pilot-batches`, async (request, reply) => {
  if (!ensureProjectStorage(request, reply)) return;
  if (!ensureProjectExecutionStorage(request, reply)) return;
  const project = ownedProject(request, request.params.id);
  if (!project) return reply.code(404).send({ error: 'Project not found' });
  const plan = request.store.rdExperimentalPlans.find(item => item.id === request.params.planId && item.project_id === project.id && isOwnedByRequest(request, item));
  if (!plan) return reply.code(404).send({ error: 'Experimental plan not found' });
  const input = pilotBatchSchema.parse(request.body);
  if (input.formulation_version_id !== plan.formulation_version_id || !projectFormulationVersion(request, project, input.formulation_version_id)) {
    return reply.code(400).send({ error: 'The pilot batch must use the exact formulation version defined by its experimental plan' });
  }
  if (input.doe_run_id) {
    const run = plan.design?.runs?.find(item => item.id === input.doe_run_id);
    if (!run) return reply.code(400).send({ error: 'DOE run does not belong to this experimental plan', code: 'DOE_RUN_INVALID' });
    if (request.store.rdPilotBatches.some(item => item.experimental_plan_id === plan.id && item.doe_run_id === input.doe_run_id)) return reply.code(409).send({ error: 'A pilot batch already exists for this DOE run', code: 'DOE_RUN_ALREADY_LINKED' });
    input.factor_settings = run.factor_settings;
    const responseKeys = new Set(plan.design.responses.map(item => item.key));
    if (Object.keys(input.response_values).some(key => !responseKeys.has(key))) return reply.code(400).send({ error: 'A response value is not declared in the DOE design', code: 'DOE_RESPONSE_INVALID' });
  } else if (Object.keys(input.response_values).length) {
    return reply.code(400).send({ error: 'Response values require a linked DOE run', code: 'DOE_RUN_REQUIRED' });
  }
  if (request.store.rdPilotBatches.some(item => item.project_id === project.id && item.batch_code.toLowerCase() === input.batch_code.toLowerCase())) return reply.code(409).send({ error: 'Pilot batch code already exists in this project' });
  const timestamp = new Date().toISOString();
  const batch = { id: generateId(), owner_id: request.user?.id, project_id: project.id, experimental_plan_id: plan.id, ...input, created_at: timestamp, updated_at: timestamp };
  request.store.rdPilotBatches.push(batch);
  addProjectEvent(request, project, 'pilot_batch_created', { plan_id: plan.id, batch_id: batch.id, batch_code: batch.batch_code, formulation_version_id: batch.formulation_version_id });
  return reply.code(201).send({ data: batch });
});

server.put(`${apiPrefix}/projects/:id/pilot-batches/:batchId`, async (request, reply) => {
  if (!ensureProjectStorage(request, reply)) return;
  if (!ensureProjectExecutionStorage(request, reply)) return;
  const project = ownedProject(request, request.params.id);
  if (!project) return reply.code(404).send({ error: 'Project not found' });
  const batch = request.store.rdPilotBatches.find(item => item.id === request.params.batchId && item.project_id === project.id && isOwnedByRequest(request, item));
  if (!batch) return reply.code(404).send({ error: 'Pilot batch not found' });
  const updates = pilotBatchSchema.omit({ formulation_version_id: true, batch_code: true, doe_run_id: true, factor_settings: true }).partial().parse(request.body);
  if (updates.response_values) {
    if (!batch.doe_run_id) return reply.code(400).send({ error: 'Response values require a linked DOE run', code: 'DOE_RUN_REQUIRED' });
    const plan = request.store.rdExperimentalPlans.find(item => item.id === batch.experimental_plan_id && item.project_id === project.id && isOwnedByRequest(request, item));
    const responseKeys = new Set((plan?.design?.responses || []).map(item => item.key));
    if (Object.keys(updates.response_values).some(key => !responseKeys.has(key))) return reply.code(400).send({ error: 'A response value is not declared in the DOE design', code: 'DOE_RESPONSE_INVALID' });
  }
  Object.assign(batch, updates, { updated_at: new Date().toISOString() });
  addProjectEvent(request, project, 'pilot_batch_updated', { batch_id: batch.id, batch_code: batch.batch_code, fields: Object.keys(updates), status: batch.status });
  return { data: batch };
});

server.post(`${apiPrefix}/projects/:id/milestones`, async (request, reply) => {
  if (!ensureProjectStorage(request, reply)) return;
  if (!ensureProjectExecutionStorage(request, reply)) return;
  const project = ownedProject(request, request.params.id);
  if (!project) return reply.code(404).send({ error: 'Project not found' });
  const input = milestoneSchema.parse(request.body);
  const timestamp = new Date().toISOString();
  const milestone = { id: generateId(), owner_id: request.user?.id, project_id: project.id, ...input, created_at: timestamp, updated_at: timestamp };
  request.store.rdProjectMilestones.push(milestone);
  addProjectEvent(request, project, 'milestone_created', { milestone_id: milestone.id, title: milestone.title, due_date: milestone.due_date, status: milestone.status });
  return reply.code(201).send({ data: milestone });
});

server.put(`${apiPrefix}/projects/:id/milestones/:milestoneId`, async (request, reply) => {
  if (!ensureProjectStorage(request, reply)) return;
  if (!ensureProjectExecutionStorage(request, reply)) return;
  const project = ownedProject(request, request.params.id);
  if (!project) return reply.code(404).send({ error: 'Project not found' });
  const milestone = request.store.rdProjectMilestones.find(item => item.id === request.params.milestoneId && item.project_id === project.id && isOwnedByRequest(request, item));
  if (!milestone) return reply.code(404).send({ error: 'Milestone not found' });
  const updates = milestoneSchema.partial().parse(request.body);
  Object.assign(milestone, updates, { updated_at: new Date().toISOString() });
  addProjectEvent(request, project, 'milestone_updated', { milestone_id: milestone.id, fields: Object.keys(updates), status: milestone.status });
  return { data: milestone };
});

server.post(`${apiPrefix}/projects/:id/decisions`, async (request, reply) => {
  if (!ensureProjectStorage(request, reply)) return;
  if (!ensureProjectExecutionStorage(request, reply)) return;
  const project = ownedProject(request, request.params.id);
  if (!project) return reply.code(404).send({ error: 'Project not found' });
  const input = projectDecisionSchema.parse(request.body);
  if (input.formulation_version_id && !projectFormulationVersion(request, project, input.formulation_version_id)) return reply.code(400).send({ error: 'The decision references a formulation version outside this project' });
  if (input.milestone_id && !request.store.rdProjectMilestones.some(item => item.id === input.milestone_id && item.project_id === project.id && isOwnedByRequest(request, item))) return reply.code(400).send({ error: 'The decision references a milestone outside this project' });
  const decision = { id: generateId(), owner_id: request.user?.id, actor_id: request.user?.id, project_id: project.id, ...input, decided_at: new Date().toISOString() };
  request.store.rdProjectDecisions.push(decision);
  addProjectEvent(request, project, 'decision_recorded', { decision_id: decision.id, title: decision.title, outcome: decision.outcome, formulation_version_id: decision.formulation_version_id || null, milestone_id: decision.milestone_id || null });
  return reply.code(201).send({ data: decision });
});

server.put(`${apiPrefix}/auth/profile`, async (request) => {
  const { display_name } = z.object({
    display_name: z.string().trim().min(1).max(100),
  }).parse(request.body);
  if (getStorageConfiguration().mode !== 'supabase') {
    request.profile = { ...request.profile, display_name };
    return { data: request.profile };
  }
  const profile = await updateUserProfile(request.user.id, display_name);
  request.profile = profile;
  return { data: profile };
});

server.get(`${apiPrefix}/ai/governance`, async (request) => {
  const [preferences, quota] = await Promise.all([
    getAIPreferences(request.user?.id),
    getAIQuotaStatus(request.user?.id),
  ]);
  return {
    data: {
      provider: getAIConfiguration(),
      ...publicAIGovernance({ preferences, quota }),
      disclosure: 'Ingredient names, percentages, calculated nutrition, cost, and local screening results are sent only when external processing is enabled. Prompts and responses are not retained by this application.',
    },
  };
});

server.put(`${apiPrefix}/ai/preferences`, async (request) => {
  const preferences = z.object({
    external_processing_enabled: z.boolean(),
    include_formulation_name: z.boolean().default(false),
  }).strict().parse(request.body || {});
  const updated = await updateAIPreferences(request.user?.id, preferences);
  return { data: updated };
});

server.post(`${apiPrefix}/ai/insights`, async (request, reply) => {
  const input = z.object({
    domain: z.enum(['laboratory', 'sensory', 'regulatory', 'cost', 'formulation']),
    context: z.record(z.string(), z.unknown()),
  }).parse(request.body || {});
  const decision = await prepareExternalAI(request, `${input.domain}_insight`);
  if (!decision.allowed) return reply.code(409).send({ error: decision.reason, ai: { ...decision.configuration, used: false, ...decision.governance } });
  try {
    const insight = await generateExpertInsight({ domain: input.domain, context: input.context });
    await finishExternalAI(request, decision, 'succeeded', insight.usage);
    return { data: { ...insight, ...decision.governance } };
  } catch (error) {
    await finishExternalAI(request, decision, 'failed');
    request.log.warn({ err: error, domain: input.domain }, 'Gemini insight failed');
    return reply.code(502).send({ error: describeGeminiFailure(error) });
  }
});

server.get(`${apiPrefix}/audit`, async (request) => {
  const { limit, offset } = paginationSchema.parse(request.query);
  if (getStorageConfiguration().mode !== 'supabase') {
    return { data: [], pagination: { total: 0, limit, offset, has_more: false } };
  }
  const includeAll = request.profile.role === USER_ROLES.ADMIN && request.query.scope === 'all';
  const result = await listAuditEvents({ ownerId: request.user.id, includeAll, limit, offset });
  return {
    data: result.data,
    pagination: { total: result.total, limit, offset, has_more: offset + limit < result.total },
  };
});

server.get(`${apiPrefix}/admin/users`, async () => ({ data: await listUserAccounts() }));

server.put(`${apiPrefix}/admin/users/:id/role`, async (request) => {
  const { role } = z.object({ role: z.enum(Object.values(USER_ROLES)) }).parse(request.body);
  return { data: await updateUserRole(request.params.id, role) };
});

const formulationIngredientSchema = z.object({
  ingredient_id: z.string().min(1),
  percentage: z.coerce.number().finite().positive().max(100),
});

function processFormulationIngredients(request, input) {
  const formIngredients = z.array(formulationIngredientSchema).min(1).max(40).parse(input);
  const ids = formIngredients.map(item => item.ingredient_id);
  if (new Set(ids).size !== ids.length) {
    throw new z.ZodError([{ code: 'custom', path: ['ingredients'], message: 'Ingredient IDs must be unique' }]);
  }

  let totalPercentage = 0;
  let totalCost = 0;
  let totalCalories = 0;
  let totalSugar = 0;

  const processedIngredients = formIngredients.map((item, displayOrder) => {
    const ingredient = getIngredientById(request, item.ingredient_id);
    if (!ingredient || !ingredient.is_active) {
      throw new z.ZodError([{
        code: 'custom',
        path: ['ingredients', displayOrder, 'ingredient_id'],
        message: 'Ingredient does not exist or is inactive',
      }]);
    }

    if (ingredient.regulatory_status === 'prohibited') {
      throw new z.ZodError([{
        code: 'custom',
        path: ['ingredients', displayOrder, 'ingredient_id'],
        message: `${ingredient.name} is marked as prohibited`,
      }]);
    }

    if (ingredient.max_percentage && item.percentage > ingredient.max_percentage + 0.0001) {
      throw new z.ZodError([{
        code: 'custom',
        path: ['ingredients', displayOrder, 'percentage'],
        message: `${ingredient.name} cannot exceed ${ingredient.max_percentage}%`,
      }]);
    }

    const fraction = item.percentage / 100;
    const costContribution = fraction * ingredient.base_price_per_kg;
    totalPercentage += item.percentage;
    totalCost += costContribution;
    totalCalories += fraction * (ingredient.calories_per_100g || 0);
    totalSugar += fraction * (ingredient.sugar_g || 0);

    return {
      ...item,
      ingredient_name: ingredient.name,
      ingredient_code: ingredient.code,
      cost_contribution: costContribution,
      display_order: displayOrder,
    };
  });

  if (Math.abs(totalPercentage - 100) > 0.1001) {
    throw new z.ZodError([{
      code: 'custom',
      path: ['ingredients'],
      message: `Ingredient percentages must total 100% (received ${totalPercentage.toFixed(2)}%)`,
    }]);
  }

  return {
    ingredients: processedIngredients,
    total_percentage: Number(totalPercentage.toFixed(4)),
    total_cost_per_liter: totalCost,
    total_calories_per_100ml: totalCalories,
    total_sugar_per_100ml: totalSugar,
  };
}

// ============================================================================
// INGREDIENTS ROUTES
// ============================================================================

server.get(`${apiPrefix}/ingredients`, async (request) => {
  const { category, search } = request.query;
  const { limit, offset } = paginationSchema.parse(request.query);
  
  let filtered = [...request.store.ingredients].filter(i => i.is_active !== false);
  
  if (category) {
    filtered = filtered.filter(i => i.category === category);
  }
  
  if (search) {
    const searchLower = search.toLowerCase();
    filtered = filtered.filter(i => 
      i.name.toLowerCase().includes(searchLower) ||
      i.code.toLowerCase().includes(searchLower)
    );
  }
  
  const paginated = filtered.slice(offset, offset + limit);
  
  return {
    data: paginated,
    pagination: {
      total: filtered.length,
      limit,
      offset,
      has_more: offset + paginated.length < filtered.length,
    },
  };
});

server.get(`${apiPrefix}/ingredients/:id`, async (request, reply) => {
  const ingredient = request.store.ingredients.find(i => i.id === request.params.id);
  if (!ingredient) {
    return reply.code(404).send({ error: 'Ingredient not found' });
  }
  return { data: ingredient };
});

server.get(`${apiPrefix}/ingredients/code/:code`, async (request, reply) => {
  const ingredient = request.store.ingredients.find(i => i.code.toLowerCase() === request.params.code.toLowerCase());
  if (!ingredient) {
    return reply.code(404).send({ error: 'Ingredient not found' });
  }
  return { data: ingredient };
});

server.get(`${apiPrefix}/ingredients/meta/categories`, async (request) => {
  return { data: request.store.categories };
});

server.get(`${apiPrefix}/ingredients/meta/stats`, async (request) => {
  return {
    data: {
      total_ingredients: request.store.ingredients.filter(i => i.is_active !== false).length,
      total_categories: request.store.categories.length,
      categories: request.store.categories,
    },
  };
});

// Create ingredient
server.post(`${apiPrefix}/ingredients`, async (request, reply) => {
  const ingredientInput = z.object({
    code: z.string().trim().min(1).max(50),
    name: z.string().trim().min(1).max(255),
    name_ar: z.string().trim().max(255).optional().default(''),
    name_fr: z.string().trim().max(255).optional().default(''),
    category: z.string().trim().min(1).max(100),
    base_price_per_kg: z.coerce.number().finite().nonnegative().default(0),
    calories_per_100g: z.coerce.number().finite().nonnegative().default(0),
    sugar_g: z.coerce.number().finite().nonnegative().max(100).default(0),
    halal_certified: z.boolean().default(true),
    kosher_certified: z.boolean().default(true),
    vegan: z.boolean().default(true),
    organic: z.boolean().default(false),
    regulatory_status: z.enum(['approved', 'restricted', 'prohibited', 'pending']).default('pending'),
    max_percentage: z.coerce.number().finite().positive().max(100).optional(),
  }).parse(request.body);

  if (request.store.ingredients.some(item => item.code.toLowerCase() === ingredientInput.code.toLowerCase())) {
    return reply.code(409).send({ error: 'Ingredient code already exists' });
  }

  const {
    code, name, name_ar, name_fr, category, base_price_per_kg,
    calories_per_100g, sugar_g, halal_certified, kosher_certified, vegan, organic,
    regulatory_status, max_percentage,
  } = ingredientInput;

  const newIngredient = {
    id: generateId(),
    code,
    name,
    name_ar: name_ar || '',
    name_fr: name_fr || '',
    category,
    base_price_per_kg,
    calories_per_100g,
    sugar_g,
    halal_certified,
    kosher_certified,
    vegan,
    organic,
    regulatory_status,
    max_percentage,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  request.store.ingredients.push(newIngredient);
  
  // Update categories if new
  if (!request.store.categories.includes(category)) {
    request.store.categories.push(category);
  }

  return reply.code(201).send({ data: newIngredient });
});

server.put(`${apiPrefix}/ingredients/:id`, async (request, reply) => {
  const ingredient = request.store.ingredients.find(item => item.id === request.params.id);
  if (!ingredient) {
    return reply.code(404).send({ error: 'Ingredient not found' });
  }

  const updates = z.object({
    code: z.string().trim().min(1).max(50).optional(),
    name: z.string().trim().min(1).max(255).optional(),
    name_ar: z.string().trim().max(255).optional(),
    name_fr: z.string().trim().max(255).optional(),
    category: z.string().trim().min(1).max(100).optional(),
    base_price_per_kg: z.coerce.number().finite().nonnegative().optional(),
    calories_per_100g: z.coerce.number().finite().nonnegative().optional(),
    sugar_g: z.coerce.number().finite().nonnegative().max(100).optional(),
    halal_certified: z.boolean().optional(),
    kosher_certified: z.boolean().optional(),
    vegan: z.boolean().optional(),
    organic: z.boolean().optional(),
    regulatory_status: z.enum(['approved', 'restricted', 'prohibited', 'pending']).optional(),
    max_percentage: z.coerce.number().finite().positive().max(100).nullable().optional(),
    is_active: z.boolean().optional(),
  }).strict().parse(request.body);

  if (updates.code && request.store.ingredients.some(item => item.id !== ingredient.id && item.code.toLowerCase() === updates.code.toLowerCase())) {
    return reply.code(409).send({ error: 'Ingredient code already exists' });
  }

  const previousPrice = ingredient.base_price_per_kg;
  Object.assign(ingredient, updates, { updated_at: new Date().toISOString() });
  if (updates.category && !request.store.categories.includes(updates.category)) request.store.categories.push(updates.category);
  let recalculatedFormulations = 0;
  if (updates.base_price_per_kg !== undefined && updates.base_price_per_kg !== previousPrice) {
    ingredient.price_per_kg = updates.base_price_per_kg;
    request.store.pricingHistory.push({
      id: generateId(),
      ingredient_id: ingredient.id,
      price_per_kg: updates.base_price_per_kg,
      currency: ingredient.currency || 'DZD',
      effective_date: new Date().toISOString(),
      source: 'ingredient edit',
    });
    for (const formulation of request.store.formulations.filter(item =>
      item.status !== 'archived' && (item.ingredients || []).some(fi => fi.ingredient_id === ingredient.id)
    )) {
      Object.assign(formulation, processFormulationIngredients(request, formulation.ingredients), { updated_at: new Date().toISOString() });
      recalculatedFormulations += 1;
    }
  }
  return { data: ingredient, recalculated_formulations: recalculatedFormulations };
});

server.delete(`${apiPrefix}/ingredients/:id`, async (request, reply) => {
  const ingredient = request.store.ingredients.find(item => item.id === request.params.id);
  if (!ingredient) {
    return reply.code(404).send({ error: 'Ingredient not found' });
  }
  const usedBy = request.store.formulations.filter(item => item.status !== 'archived' &&
    (item.ingredients || []).some(fi => fi.ingredient_id === ingredient.id));
  if (usedBy.length > 0) {
    return reply.code(409).send({
      error: `Ingredient is used by ${usedBy.length} non-archived formulation(s) and cannot be archived`,
    });
  }
  ingredient.is_active = false;
  ingredient.updated_at = new Date().toISOString();
  return { data: ingredient, message: 'Ingredient archived' };
});

// ============================================================================
// FORMULATIONS ROUTES
// ============================================================================

server.get(`${apiPrefix}/formulations`, async (request) => {
  const { search, status } = request.query;
  const { limit, offset } = paginationSchema.extend({ limit: z.coerce.number().int().min(1).max(500).default(50) }).parse(request.query);
  
  const owned = accessibleFormulations(request);
  let filtered = status === 'all' ? owned : owned.filter(item => item.status !== 'archived');
  
  if (status && status !== 'all') {
    filtered = filtered.filter(f => f.status === status);
  }
  
  if (search) {
    const searchLower = search.toLowerCase();
    filtered = filtered.filter(f => 
      f.name.toLowerCase().includes(searchLower) ||
      f.code.toLowerCase().includes(searchLower)
    );
  }
  
  const paginated = filtered.slice(offset, offset + limit);
  
  return {
    data: paginated,
    pagination: {
      total: filtered.length,
      limit,
      offset,
      has_more: offset + paginated.length < filtered.length,
    },
  };
});

server.get(`${apiPrefix}/formulations/:id`, async (request, reply) => {
  const formulation = findAccessibleFormulation(request, request.params.id);
  if (!formulation) {
    return reply.code(404).send({ error: 'Formulation not found' });
  }
  return { data: formulation };
});

server.post(`${apiPrefix}/formulations`, async (request, reply) => {
  const input = z.object({
    code: z.string().trim().min(1).max(100).optional(),
    name: z.string().trim().min(1).max(255),
    description: z.string().trim().max(5000).optional().default(''),
    beverage_type: z.string().trim().min(1).max(100).optional().default('soft_drink'),
    project_id: z.string().trim().min(1).optional(),
    ingredients: z.array(formulationIngredientSchema).min(1).max(40),
  }).parse(request.body);

  if (input.project_id) {
    const project = ownedProject(request, input.project_id);
    if (!project) return reply.code(400).send({ error: 'Linked R&D project is unavailable' });
    if (project.brief_status !== 'validated') return reply.code(409).send({ error: 'Validate the structured R&D brief before creating a linked formulation' });
  }

  const code = input.code || `FORM-${Date.now()}`;
  if (accessibleFormulations(request).some(item => item.code.toLowerCase() === code.toLowerCase())) {
    return reply.code(409).send({ error: 'Formulation code already exists' });
  }

  const totals = processFormulationIngredients(request, input.ingredients);
  
  const newFormulation = addFormulation(request, {
    owner_id: request.user?.id,
    code,
    name: input.name,
    description: input.description,
    beverage_type: input.beverage_type,
    project_id: input.project_id || null,
    version: 1,
    is_latest_version: true,
    status: 'draft',
    ...totals,
  });
  
  return reply.code(201).send({ data: newFormulation });
});

server.put(`${apiPrefix}/formulations/:id`, async (request, reply) => {
  const { id } = request.params;
  const input = z.object({
    name: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().max(5000).optional(),
    status: z.enum(['draft', 'active', 'archived']).optional(),
    beverage_type: z.string().trim().min(1).max(100).optional(),
    ingredients: z.array(formulationIngredientSchema).min(1).max(40).optional(),
  }).strict().parse(request.body);
  
  const existing = findAccessibleFormulation(request, id);
  if (!existing) {
    return reply.code(404).send({ error: 'Formulation not found' });
  }
  if (existing.locked_at) return reply.code(409).send({ error: 'Approved formulation versions are immutable. Create a new version to continue.' });
  
  const updates = {};
  Object.assign(updates, input);
  if (input.ingredients) Object.assign(updates, processFormulationIngredients(request, input.ingredients));
  
  const updated = updateFormulation(request, id, updates);
  return { data: updated };
});

server.delete(`${apiPrefix}/formulations/:id`, async (request, reply) => {
  if (!findAccessibleFormulation(request, request.params.id)) {
    return reply.code(404).send({ error: 'Formulation not found' });
  }
  const deleted = archiveFormulation(request, request.params.id);
  if (!deleted) {
    return reply.code(404).send({ error: 'Formulation not found' });
  }
  return { data: deleted, message: 'Formulation archived' };
});

server.post(`${apiPrefix}/formulations/:id/versions`, async (request, reply) => {
  const source = findAccessibleFormulation(request, request.params.id);
  if (!source) return reply.code(404).send({ error: 'Formulation not found' });

  const input = z.object({
    name: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().max(5000).optional(),
    beverage_type: z.string().trim().min(1).max(100).optional(),
    ingredients: z.array(formulationIngredientSchema).min(1).max(40).optional(),
  }).strict().parse(request.body || {});
  const totals = input.ingredients ? processFormulationIngredients(request, input.ingredients) : {
    ingredients: source.ingredients.map(item => ({ ...item })),
    total_percentage: source.total_percentage,
    total_cost_per_liter: source.total_cost_per_liter,
    total_calories_per_100ml: source.total_calories_per_100ml,
    total_sugar_per_100ml: source.total_sugar_per_100ml,
  };

  source.is_latest_version = false;
  const version = addFormulation(request, {
    ...source,
    ...input,
    ...totals,
    id: undefined,
    code: `${source.code}-V${source.version + 1}`,
    version: source.version + 1,
    parent_formulation_id: source.parent_formulation_id || source.id,
    is_latest_version: true,
    status: 'draft',
    locked_at: undefined,
    locked_by: undefined,
    owner_id: request.user?.id,
  });
  return reply.code(201).send({ data: version });
});

server.post(`${apiPrefix}/formulations/:id/approve`, async (request, reply) => {
  const formulation = findAccessibleFormulation(request, request.params.id);
  if (!formulation) return reply.code(404).send({ error: 'Formulation not found' });
  if (!formulation.project_id || !ownedProject(request, formulation.project_id)) {
    return reply.code(409).send({ error: 'Link this formulation version to an R&D project before approval' });
  }
  if (formulation.locked_at) return { data: formulation };
  const input = z.object({ note: z.string().trim().min(3).max(1000) }).parse(request.body);
  formulation.status = 'approved';
  formulation.locked_at = new Date().toISOString();
  formulation.locked_by = request.user?.id;
  formulation.approval_note = input.note;
  formulation.updated_at = formulation.locked_at;
  addProjectEvent(request, ownedProject(request, formulation.project_id), 'formulation_version_approved', {
    formulation_version_id: formulation.id, version: formulation.version, code: formulation.code, note: input.note,
  });
  return { data: formulation };
});

server.get(`${apiPrefix}/formulations/:id/versions`, async (request, reply) => {
  const source = findAccessibleFormulation(request, request.params.id);
  if (!source) return reply.code(404).send({ error: 'Formulation not found' });
  const rootId = source.parent_formulation_id || source.id;
  return { data: accessibleFormulations(request).filter(item => item.id === rootId || item.parent_formulation_id === rootId) };
});

server.get(`${apiPrefix}/formulations/:id/nutrition`, async (request, reply) => {
  const formulation = findAccessibleFormulation(request, request.params.id);
  if (!formulation) return reply.code(404).send({ error: 'Formulation not found' });
  return { data: {
    calories: formulation.total_calories_per_100ml,
    sugar: formulation.total_sugar_per_100ml,
  } };
});

server.get(`${apiPrefix}/formulations/:id/cost`, async (request, reply) => {
  const formulation = findAccessibleFormulation(request, request.params.id);
  if (!formulation) return reply.code(404).send({ error: 'Formulation not found' });
  const batchSize = z.coerce.number().finite().positive().max(1000000).default(1).parse(request.query.batch_size);
  return { data: {
    batch_size_liters: batchSize,
    cost_per_liter: formulation.total_cost_per_liter,
    total_cost: formulation.total_cost_per_liter * batchSize,
  } };
});

// ============================================================================
// LABORATORY RESULTS & CONSENTED LEARNING FEEDBACK
// ============================================================================

const optionalMeasurement = z.coerce.number().finite().nonnegative().optional();
const sensoryScore = z.coerce.number().finite().min(0).max(10).optional();
const laboratoryResultSchema = z.object({
  batch_code: z.string().trim().max(100).optional(),
  tested_at: z.coerce.date().default(() => new Date()),
  measurements: z.object({
    ph: z.coerce.number().finite().min(0).max(14).optional(),
    brix: optionalMeasurement,
    titratable_acidity: optionalMeasurement,
    viscosity: optionalMeasurement,
    density: optionalMeasurement,
    turbidity: optionalMeasurement,
    stability_score: z.coerce.number().finite().min(0).max(100).optional(),
  }).default({}),
  sensory: z.object({
    appearance: sensoryScore, aroma: sensoryScore, taste: sensoryScore,
    mouthfeel: sensoryScore, overall_acceptance: sensoryScore,
  }).default({}),
  notes: z.string().trim().max(4000).optional(),
  include_in_ai_learning: z.boolean().default(false),
});
const laboratoryResultUpdateSchema = laboratoryResultSchema.partial();

server.get(`${apiPrefix}/formulations/:id/laboratory-results`, async (request, reply) => {
  if (!findAccessibleFormulation(request, request.params.id)) return reply.code(404).send({ error: 'Formulation not found' });
  const data = request.store.laboratoryResults
    .filter(item => item.formulation_id === request.params.id && !item.deleted_at && isOwnedByRequest(request, item))
    .sort((a, b) => new Date(b.tested_at) - new Date(a.tested_at));
  return { data };
});

server.get(`${apiPrefix}/formulations/:id/sensory-analytics`, async (request, reply) => {
  if (!findAccessibleFormulation(request, request.params.id)) return reply.code(404).send({ error: 'Formulation not found' });
  const results = request.store.laboratoryResults
    .filter(item => item.formulation_id === request.params.id && isOwnedByRequest(request, item));
  return { data: analyzeSensoryResults(results) };
});

server.post(`${apiPrefix}/formulations/:id/laboratory-results`, async (request, reply) => {
  const formulation = findAccessibleFormulation(request, request.params.id);
  if (!formulation) return reply.code(404).send({ error: 'Formulation not found' });
  const input = laboratoryResultSchema.parse(request.body);
  const now = new Date().toISOString();
  const result = {
    id: generateId(), owner_id: request.user?.id, formulation_id: formulation.id,
    formulation_version_id: formulation.id, project_id: formulation.project_id || null,
    batch_code: input.batch_code || null, tested_at: input.tested_at.toISOString(),
    measurements: input.measurements, sensory: input.sensory, notes: input.notes || null,
    include_in_ai_learning: input.include_in_ai_learning, created_at: now,
  };
  request.store.laboratoryResults.push(result);
  if (input.include_in_ai_learning) {
    request.store.aiLearningExamples.push({
      id: generateId(), owner_id: request.user?.id, laboratory_result_id: result.id,
      formulation_id: formulation.id, formulation_version_id: formulation.id, project_id: formulation.project_id || null,
      input: { beverage_type: formulation.beverage_type, ingredients: formulation.ingredients || [] },
      outcome: { measurements: result.measurements, sensory: result.sensory },
      status: 'approved_for_local_learning', created_at: now,
    });
  }
  return reply.code(201).send({ data: result, learning: {
    included: input.include_in_ai_learning,
    message: input.include_in_ai_learning
      ? 'Saved as a local learning example for future recommendation calibration. It is not sent to an external AI provider.'
      : 'Saved for formulation quality tracking only.',
  } });
});

server.put(`${apiPrefix}/formulations/:id/laboratory-results/:resultId`, async (request, reply) => {
  if (!findAccessibleFormulation(request, request.params.id)) return reply.code(404).send({ error: 'Formulation not found' });
  const result = request.store.laboratoryResults.find(item =>
    item.id === request.params.resultId && item.formulation_id === request.params.id && !item.deleted_at && isOwnedByRequest(request, item)
  );
  if (!result) return reply.code(404).send({ error: 'Laboratory result not found' });
  const input = laboratoryResultUpdateSchema.parse(request.body);
  const updates = { updated_at: new Date().toISOString() };
  if (Object.hasOwn(input, 'batch_code')) updates.batch_code = input.batch_code || null;
  if (Object.hasOwn(input, 'tested_at')) updates.tested_at = input.tested_at.toISOString();
  if (Object.hasOwn(input, 'measurements')) updates.measurements = input.measurements;
  if (Object.hasOwn(input, 'sensory')) updates.sensory = input.sensory;
  if (Object.hasOwn(input, 'notes')) updates.notes = input.notes || null;
  if (Object.hasOwn(input, 'include_in_ai_learning')) updates.include_in_ai_learning = input.include_in_ai_learning;
  Object.assign(result, updates);
  return { data: result };
});

server.delete(`${apiPrefix}/formulations/:id/laboratory-results/:resultId`, async (request, reply) => {
  if (!findAccessibleFormulation(request, request.params.id)) return reply.code(404).send({ error: 'Formulation not found' });
  const result = request.store.laboratoryResults.find(item =>
    item.id === request.params.resultId && item.formulation_id === request.params.id && !item.deleted_at && isOwnedByRequest(request, item)
  );
  if (!result) return reply.code(404).send({ error: 'Laboratory result not found' });
  result.deleted_at = new Date().toISOString();
  result.updated_at = result.deleted_at;
  return reply.code(204).send();
});

server.post(`${apiPrefix}/formulations/:id/laboratory-results/import`, async (request, reply) => {
  const formulation = findAccessibleFormulation(request, request.params.id);
  if (!formulation) return reply.code(404).send({ error: 'Formulation not found' });
  const body = z.object({ rows: z.array(z.unknown()).min(1).max(1000) }).parse(request.body);
  const created = [];
  const errors = [];
  const now = new Date().toISOString();
  body.rows.forEach((row, index) => {
    const parsed = laboratoryResultSchema.safeParse(row);
    if (!parsed.success) {
      errors.push({ row: index + 2, message: parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ') });
      return;
    }
    const input = parsed.data;
    const result = {
      id: generateId(), owner_id: request.user?.id, formulation_id: formulation.id,
      formulation_version_id: formulation.id, project_id: formulation.project_id || null,
      batch_code: input.batch_code || null, tested_at: input.tested_at.toISOString(),
      measurements: input.measurements, sensory: input.sensory, notes: input.notes || null,
      include_in_ai_learning: input.include_in_ai_learning, import_source: 'spreadsheet', created_at: now,
    };
    request.store.laboratoryResults.push(result);
    created.push(result);
  });
  return reply.code(created.length ? 201 : 422).send({ data: created, imported: created.length, rejected: errors.length, errors });
});

server.get(`${apiPrefix}/ai/learning-feedback/summary`, async (request) => {
  const examples = request.store.aiLearningExamples.filter(item => isOwnedByRequest(request, item));
  return { data: {
    approved_examples: examples.length,
    last_added_at: examples.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]?.created_at || null,
    mode: 'local_calibration_queue',
    external_processing: false,
  } };
});

// ============================================================================
// SENSORY STUDIES, INDIVIDUAL PANEL RESPONSES & ANALYTICS
// ============================================================================

const sensoryAttributeSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,49}$/),
  label: z.string().trim().min(2).max(80),
  category: z.enum(['appearance', 'aroma', 'taste', 'mouthfeel', 'aftertaste', 'overall', 'custom']),
});
const sensorySampleSchema = z.object({
  formulation_id: z.string().trim().min(1).optional(),
  sample_code: z.string().trim().min(1).max(50),
  blind_code: z.string().trim().min(1).max(20),
  label: z.string().trim().min(2).max(100),
  batch_code: z.string().trim().max(100).optional(),
});
const sensoryStudySchema = z.object({
  project_id: z.string().trim().min(1).optional(),
  name: z.string().trim().min(3).max(150),
  objective: z.string().trim().min(10).max(2000),
  test_type: z.enum(['hedonic', 'descriptive', 'preference', 'jar', 'combined']),
  panel_type: z.enum(['trained', 'expert', 'consumer', 'internal']),
  planned_panelists: z.coerce.number().int().min(1).max(5000),
  scale_min: z.coerce.number().finite().min(0).max(8).default(0),
  scale_max: z.coerce.number().finite().min(2).max(10).default(10),
  status: z.enum(['draft', 'active', 'completed']).default('draft'),
  attributes: z.array(sensoryAttributeSchema).min(2).max(20),
  samples: z.array(sensorySampleSchema).min(1).max(12),
  protocol: z.object({
    randomize_order: z.boolean().default(true),
    serving_temperature_c: z.coerce.number().finite().min(-10).max(100).optional(),
    serving_volume_ml: z.coerce.number().finite().positive().max(2000).optional(),
    palate_cleanser: z.string().trim().max(200).optional(),
    environment: z.string().trim().max(300).optional(),
    instructions: z.string().trim().max(3000).optional(),
  }).default({ randomize_order: true }),
}).superRefine((study, context) => {
  if (study.scale_max <= study.scale_min) context.addIssue({ code: z.ZodIssueCode.custom, path: ['scale_max'], message: 'Maximum scale value must exceed the minimum' });
  const attributeKeys = study.attributes.map(attribute => attribute.key);
  if (new Set(attributeKeys).size !== attributeKeys.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['attributes'], message: 'Attribute keys must be unique' });
  const sampleCodes = study.samples.map(sample => sample.sample_code.toLowerCase());
  if (new Set(sampleCodes).size !== sampleCodes.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['samples'], message: 'Sample codes must be unique' });
  const blindCodes = study.samples.map(sample => sample.blind_code.toLowerCase());
  if (new Set(blindCodes).size !== blindCodes.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['samples'], message: 'Blind codes must be unique' });
});
const sensoryResponseSchema = z.object({
  panelist_code: z.string().trim().min(1).max(80),
  segment: z.string().trim().max(100).optional(),
  demographics: z.object({
    age_range: z.string().trim().max(40).optional(),
    gender: z.string().trim().max(40).optional(),
    consumption_frequency: z.string().trim().max(80).optional(),
  }).default({}),
  session: z.object({
    location: z.string().trim().max(120).optional(),
    duration_seconds: z.coerce.number().int().positive().max(86400).optional(),
    serving_order: z.array(z.string().trim().min(1)).max(12).optional(),
    completed_at: z.coerce.date().default(() => new Date()),
  }).default({}),
  samples: z.array(z.object({
    sample_id: z.string().trim().min(1),
    scores: z.record(z.string(), z.coerce.number().finite()),
    jar: z.record(z.string(), z.coerce.number().int().min(-2).max(2)).default({}),
    purchase_intent: z.coerce.number().int().min(1).max(5).optional(),
    preference_rank: z.coerce.number().int().min(1).max(12).optional(),
    comment: z.string().trim().max(2000).optional(),
  })).min(1).max(12),
});

function findSensoryStudy(request, id) {
  return request.store.sensoryStudies.find(study => study.id === id && isOwnedByRequest(request, study));
}

function requireSensoryPersistence(request, reply) {
  if (request.store.featureAvailability?.sensory !== false) return true;
  reply.code(503).send({
    error: 'Sensory storage is not installed. Apply the pending Supabase sensory migration before creating studies.',
    code: 'SENSORY_MIGRATION_REQUIRED',
  });
  return false;
}

function resolveSensoryProject(request, study) {
  const formulations = study.samples.filter(sample => sample.formulation_id).map(sample => findAccessibleFormulation(request, sample.formulation_id));
  if (formulations.some(item => !item)) return { error: 'One or more sample formulation versions are unavailable' };
  const projectIds = [...new Set(formulations.map(item => item.project_id).filter(Boolean))];
  if (projectIds.length > 1) return { error: 'All linked formulation versions in one sensory study must belong to the same R&D project' };
  const projectId = study.project_id || projectIds[0] || null;
  if (projectId && !ownedProject(request, projectId)) return { error: 'Linked R&D project is unavailable' };
  if (study.project_id && projectIds[0] && study.project_id !== projectIds[0]) return { error: 'The sensory project does not match its formulation versions' };
  if (projectId && formulations.some(item => item.project_id !== projectId)) return { error: 'Every linked formulation version must belong to the sensory project' };
  return { project_id: projectId };
}

server.get(`${apiPrefix}/sensory/studies`, async (request, reply) => {
  if (!requireSensoryPersistence(request, reply)) return reply;
  return { data: request.store.sensoryStudies.filter(study => isOwnedByRequest(request, study)).map(study => ({
    ...study,
    response_count: request.store.sensoryResponses.filter(response => response.study_id === study.id && isOwnedByRequest(request, response)).length,
  })).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)),
  };
});

server.post(`${apiPrefix}/sensory/studies`, async (request, reply) => {
  if (!requireSensoryPersistence(request, reply)) return reply;
  const input = sensoryStudySchema.parse(request.body);
  for (const sample of input.samples) {
    if (sample.formulation_id && !findAccessibleFormulation(request, sample.formulation_id)) {
      return reply.code(400).send({ error: `Sample formulation ${sample.formulation_id} is unavailable` });
    }
  }
  const traceability = resolveSensoryProject(request, input);
  if (traceability.error) return reply.code(400).send({ error: traceability.error });
  const now = new Date().toISOString();
  const study = {
    ...input,
    project_id: traceability.project_id,
    id: generateId(),
    owner_id: request.user?.id,
    attributes: input.attributes.map(attribute => ({ ...attribute })),
    samples: input.samples.map(sample => ({ ...sample, id: generateId() })),
    created_at: now,
    updated_at: now,
  };
  request.store.sensoryStudies.push(study);
  if (study.project_id) addProjectEvent(request, ownedProject(request, study.project_id), 'sensory_study_created', {
    sensory_study_id: study.id, formulation_version_ids: study.samples.map(sample => sample.formulation_id).filter(Boolean),
  });
  return reply.code(201).send({ data: study });
});

server.put(`${apiPrefix}/sensory/studies/:id`, async (request, reply) => {
  if (!requireSensoryPersistence(request, reply)) return reply;
  const study = findSensoryStudy(request, request.params.id);
  if (!study) return reply.code(404).send({ error: 'Sensory study not found' });
  const input = sensoryStudySchema.parse(request.body);
  const traceability = resolveSensoryProject(request, input);
  if (traceability.error) return reply.code(400).send({ error: traceability.error });
  const previousSamples = new Map(study.samples.map(sample => [sample.sample_code.toLowerCase(), sample.id]));
  Object.assign(study, input, { project_id: traceability.project_id,
    samples: input.samples.map(sample => ({ ...sample, id: previousSamples.get(sample.sample_code.toLowerCase()) || generateId() })),
    updated_at: new Date().toISOString(),
  });
  return { data: study };
});

server.get(`${apiPrefix}/sensory/studies/:id`, async (request, reply) => {
  if (!requireSensoryPersistence(request, reply)) return reply;
  const study = findSensoryStudy(request, request.params.id);
  if (!study) return reply.code(404).send({ error: 'Sensory study not found' });
  return { data: study };
});

server.put(`${apiPrefix}/sensory/studies/:id/status`, async (request, reply) => {
  if (!requireSensoryPersistence(request, reply)) return reply;
  const study = findSensoryStudy(request, request.params.id);
  if (!study) return reply.code(404).send({ error: 'Sensory study not found' });
  const input = z.object({ status: z.enum(['draft', 'active', 'completed', 'archived']) }).parse(request.body);
  study.status = input.status;
  study.updated_at = new Date().toISOString();
  return { data: study };
});

server.get(`${apiPrefix}/sensory/studies/:id/responses`, async (request, reply) => {
  if (!requireSensoryPersistence(request, reply)) return reply;
  if (!findSensoryStudy(request, request.params.id)) return reply.code(404).send({ error: 'Sensory study not found' });
  return { data: request.store.sensoryResponses.filter(response => response.study_id === request.params.id && isOwnedByRequest(request, response)).sort((a, b) => new Date(b.session.completed_at) - new Date(a.session.completed_at)) };
});

server.post(`${apiPrefix}/sensory/studies/:id/responses`, async (request, reply) => {
  if (!requireSensoryPersistence(request, reply)) return reply;
  const study = findSensoryStudy(request, request.params.id);
  if (!study) return reply.code(404).send({ error: 'Sensory study not found' });
  if (study.status === 'completed' || study.status === 'archived') return reply.code(409).send({ error: 'This study is closed to new responses' });
  const input = sensoryResponseSchema.parse(request.body);
  if (request.store.sensoryResponses.some(response => response.study_id === study.id && isOwnedByRequest(request, response) && response.panelist_code.toLowerCase() === input.panelist_code.toLowerCase())) {
    return reply.code(409).send({ error: 'This panelist code already has a response in the study' });
  }
  const sampleIds = new Set(study.samples.map(sample => sample.id));
  const attributeKeys = new Set(study.attributes.map(attribute => attribute.key));
  const submittedSampleIds = input.samples.map(sample => sample.sample_id);
  if (new Set(submittedSampleIds).size !== submittedSampleIds.length || submittedSampleIds.some(id => !sampleIds.has(id))) {
    return reply.code(400).send({ error: 'Responses contain duplicate or unknown study samples' });
  }
  if (input.session.serving_order) {
    const servingOrder = input.session.serving_order;
    if (servingOrder.length !== submittedSampleIds.length || new Set(servingOrder).size !== servingOrder.length || servingOrder.some(id => !submittedSampleIds.includes(id))) {
      return reply.code(400).send({ error: 'Serving order must contain each submitted sample exactly once' });
    }
  }
  for (const sample of input.samples) {
    const unknownAttribute = Object.keys(sample.scores).find(key => !attributeKeys.has(key));
    const outOfRange = Object.entries(sample.scores).find(([, value]) => value < study.scale_min || value > study.scale_max);
    if (unknownAttribute) return reply.code(400).send({ error: `Unknown sensory attribute: ${unknownAttribute}` });
    if (outOfRange) return reply.code(400).send({ error: `${outOfRange[0]} must be between ${study.scale_min} and ${study.scale_max}` });
  }
  const response = {
    ...input,
    id: generateId(),
    owner_id: request.user?.id,
    study_id: study.id,
    session: { ...input.session, completed_at: input.session.completed_at.toISOString() },
    created_at: new Date().toISOString(),
  };
  request.store.sensoryResponses.push(response);
  study.updated_at = response.created_at;
  return reply.code(201).send({ data: response });
});

server.post(`${apiPrefix}/sensory/studies/:id/responses/import`, async (request, reply) => {
  if (!requireSensoryPersistence(request, reply)) return reply;
  const study = findSensoryStudy(request, request.params.id);
  if (!study) return reply.code(404).send({ error: 'Sensory study not found' });
  if (['completed', 'archived'].includes(study.status)) return reply.code(409).send({ error: 'This study is closed to new responses' });
  const body = z.object({ rows: z.array(z.unknown()).min(1).max(5000) }).parse(request.body);
  const existingCodes = new Set(request.store.sensoryResponses
    .filter(response => response.study_id === study.id && isOwnedByRequest(request, response))
    .map(response => response.panelist_code.toLowerCase()));
  const created = [];
  const errors = [];
  const sampleIds = new Set(study.samples.map(sample => sample.id));
  const attributeKeys = new Set(study.attributes.map(attribute => attribute.key));
  for (const [index, row] of body.rows.entries()) {
    const parsed = sensoryResponseSchema.safeParse(row);
    if (!parsed.success) {
      errors.push({ row: index + 2, message: parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ') });
      continue;
    }
    const input = parsed.data;
    const code = input.panelist_code.toLowerCase();
    const invalidSample = input.samples.some(sample => !sampleIds.has(sample.sample_id));
    const invalidAttribute = input.samples.flatMap(sample => Object.keys(sample.scores)).find(key => !attributeKeys.has(key));
    const outOfRange = input.samples.some(sample => Object.values(sample.scores).some(value => value < study.scale_min || value > study.scale_max));
    if (existingCodes.has(code) || invalidSample || invalidAttribute || outOfRange) {
      errors.push({ row: index + 2, message: existingCodes.has(code) ? 'Duplicate panelist code' : invalidSample ? 'Unknown sample' : invalidAttribute ? `Unknown attribute: ${invalidAttribute}` : 'Score outside study scale' });
      continue;
    }
    const response = {
      ...input, id: generateId(), owner_id: request.user?.id, study_id: study.id,
      session: { ...input.session, completed_at: input.session.completed_at.toISOString() },
      import_source: 'spreadsheet', created_at: new Date().toISOString(),
    };
    request.store.sensoryResponses.push(response);
    existingCodes.add(code);
    created.push(response);
  }
  if (created.length) study.updated_at = new Date().toISOString();
  return reply.code(created.length ? 201 : 422).send({ data: created, imported: created.length, rejected: errors.length, errors });
});

server.get(`${apiPrefix}/sensory/studies/:id/analytics`, async (request, reply) => {
  if (!requireSensoryPersistence(request, reply)) return reply;
  const study = findSensoryStudy(request, request.params.id);
  if (!study) return reply.code(404).send({ error: 'Sensory study not found' });
  const responses = request.store.sensoryResponses.filter(response => response.study_id === study.id && isOwnedByRequest(request, response));
  return { data: analyzeSensoryStudy(study, responses) };
});

// ============================================================================
// COMPATIBILITY ROUTES
// ============================================================================

server.get(`${apiPrefix}/compatibility/formulations/:id`, async (request, reply) => {
  const formulation = findAccessibleFormulation(request, request.params.id);
  if (!formulation) {
    return reply.code(404).send({ error: 'Formulation not found' });
  }
  
  const startTime = Date.now();
  const risks = [];
  const warnings = [];
  let overallScore = 100;
  
  const ings = formulation.ingredients || [];
  const ingredientDetails = ings.map(i => ({
    ...i,
    details: getIngredientById(request, i.ingredient_id)
  })).filter(i => i.details);

  // ============================================
  // 1. FORMULATION VALIDATION
  // ============================================
  const totalPct = ings.reduce((sum, i) => sum + i.percentage, 0);
  if (Math.abs(totalPct - 100) > 0.1) {
    risks.push({
      type: 'formulation',
      severity: 'high',
      description: `Total percentage is ${totalPct.toFixed(2)}%, must equal 100% for a valid formulation`,
    });
    overallScore -= 15;
  }

  // ============================================
  // 2. CHEMICAL RISKS - pH Compatibility
  // ============================================
  const acidulants = ingredientDetails.filter(i => i.details.category === 'acidulant');
  const hasHighAcid = acidulants.some(i => i.details.ph_min && i.details.ph_min < 3);
  
  // Check for pH-sensitive ingredients with acids
  const phSensitiveCategories = ['colorant', 'vitamin', 'flavor'];
  const phSensitive = ingredientDetails.filter(i => phSensitiveCategories.includes(i.details.category));
  
  if (hasHighAcid && phSensitive.length > 0) {
    const affected = phSensitive.map(i => i.details.name).join(', ');
    warnings.push({
      type: 'chemical',
      severity: 'medium',
      description: `High acidity (pH < 3) may affect stability of: ${affected}. Consider pH buffering.`,
    });
    overallScore -= 5;
  }

  // Check for incompatible acid combinations
  if (acidulants.length > 1) {
    const acidNames = acidulants.map(i => i.details.name).join(' + ');
    warnings.push({
      type: 'chemical',
      severity: 'low',
      description: `Multiple acidulants detected (${acidNames}). Verify pH balance and taste profile.`,
    });
    overallScore -= 3;
  }

  // Phosphoric acid + Citric acid interaction
  const hasPhosphoric = acidulants.some(i => i.details.name.toLowerCase().includes('phosphoric'));
  const hasCitric = acidulants.some(i => i.details.name.toLowerCase().includes('citric'));
  if (hasPhosphoric && hasCitric) {
    warnings.push({
      type: 'chemical',
      severity: 'medium',
      description: 'Phosphoric acid + Citric acid combination may create unexpected taste interactions.',
    });
    overallScore -= 5;
  }

  // ============================================
  // 3. PHYSICAL RISKS - Precipitation & Cloudiness
  // ============================================
  const hasCalcium = ingredientDetails.some(i => 
    i.details.name.toLowerCase().includes('calcium') || 
    i.details.category === 'mineral'
  );
  const hasCitricAcid = acidulants.some(i => i.details.name.toLowerCase().includes('citric'));
  
  if (hasCalcium && hasCitricAcid) {
    warnings.push({
      type: 'physical',
      severity: 'medium',
      description: 'Calcium + Citric acid may form calcium citrate precipitate causing cloudiness.',
    });
    overallScore -= 5;
  }

  // Gums/stabilizers with high acid
  const stabilizers = ingredientDetails.filter(i => i.details.category === 'stabilizer');
  if (stabilizers.length > 0 && hasHighAcid) {
    const stabNames = stabilizers.map(i => i.details.name).join(', ');
    warnings.push({
      type: 'physical',
      severity: 'low',
      description: `Stabilizers (${stabNames}) may lose viscosity at low pH. Test for phase separation.`,
    });
    overallScore -= 3;
  }

  // Check for potential emulsion instability
  const emulsifiers = ingredientDetails.filter(i => i.details.category === 'emulsifier');
  const juices = ingredientDetails.filter(i => i.details.category === 'juice');
  if (juices.length > 0 && emulsifiers.length === 0) {
    warnings.push({
      type: 'physical',
      severity: 'low',
      description: 'Juice concentrates without emulsifier may cause separation. Consider adding Gum Arabic or Pectin.',
    });
    overallScore -= 2;
  }

  // ============================================
  // 4. SENSORY RISKS - Flavor & Color
  // ============================================
  const sweeteners = ingredientDetails.filter(i => i.details.category === 'sweetener');
  const artificialSweeteners = sweeteners.filter(i => 
    i.details.name.toLowerCase().includes('aspartame') ||
    i.details.name.toLowerCase().includes('sucralose') ||
    i.details.name.toLowerCase().includes('stevia')
  );
  const naturalSweeteners = sweeteners.filter(i => 
    i.details.name.toLowerCase().includes('sugar') ||
    i.details.name.toLowerCase().includes('honey') ||
    i.details.name.toLowerCase().includes('fructose')
  );

  if (artificialSweeteners.length > 0 && naturalSweeteners.length > 0) {
    warnings.push({
      type: 'sensory',
      severity: 'low',
      description: 'Mixing artificial and natural sweeteners may create off-taste. Optimize ratios through sensory testing.',
    });
    overallScore -= 2;
  }

  // Multiple strong flavors
  const flavors = ingredientDetails.filter(i => i.details.category === 'flavor');
  if (flavors.length > 2) {
    const flavorNames = flavors.map(i => i.details.name).join(', ');
    warnings.push({
      type: 'sensory',
      severity: 'medium',
      description: `Multiple flavors detected (${flavorNames}). May result in confused taste profile.`,
    });
    overallScore -= 4;
  }

  // Color stability with Vitamin C
  const hasVitaminC = ingredientDetails.some(i => 
    i.details.name.toLowerCase().includes('vitamin c') ||
    i.details.name.toLowerCase().includes('ascorbic')
  );
  const colorants = ingredientDetails.filter(i => i.details.category === 'colorant');
  if (hasVitaminC && colorants.length > 0) {
    warnings.push({
      type: 'sensory',
      severity: 'medium',
      description: 'Vitamin C (Ascorbic acid) may cause color fading over time. Consider encapsulated vitamin C.',
    });
    overallScore -= 4;
  }

  // Caramel color with citrus flavors
  const hasCaramel = colorants.some(i => i.details.name.toLowerCase().includes('caramel'));
  const hasCitrusFlavor = flavors.some(i => 
    i.details.name.toLowerCase().includes('orange') ||
    i.details.name.toLowerCase().includes('lemon') ||
    i.details.name.toLowerCase().includes('citrus')
  );
  if (hasCaramel && hasCitrusFlavor) {
    warnings.push({
      type: 'sensory',
      severity: 'low',
      description: 'Caramel color with citrus flavor is unusual. Verify this is intentional (cola-citrus hybrid).',
    });
    overallScore -= 2;
  }

  // ============================================
  // 5. REGULATORY RISKS
  // ============================================
  for (const item of ingredientDetails) {
    const ing = item.details;
    const pct = item.percentage;
    
    // Check max percentage limits
    if (ing.max_percentage && pct > ing.max_percentage) {
      risks.push({
        type: 'regulatory',
        severity: 'critical',
        description: `${ing.name} at ${pct.toFixed(2)}% exceeds maximum allowed ${ing.max_percentage}% (Algerian regulation)`,
      });
      overallScore -= 15;
    }

    // Warn if close to limit
    if (ing.max_percentage && pct > ing.max_percentage * 0.8 && pct <= ing.max_percentage) {
      warnings.push({
        type: 'regulatory',
        severity: 'low',
        description: `${ing.name} at ${pct.toFixed(2)}% is close to maximum limit of ${ing.max_percentage}%`,
      });
      overallScore -= 2;
    }

    // Check for restricted ingredients
    if (ing.regulatory_status === 'restricted') {
      risks.push({
        type: 'regulatory',
        severity: 'high',
        description: `${ing.name} has restricted status. Special approval may be required.`,
      });
      overallScore -= 10;
    }
  }

  // Practical process alerts, independent of an ingredient's declared legal maximum.
  const highConcentrationCategories = { flavor: 2, colorant: 0.5, emulsifier: 1, stabilizer: 1.5, acidulant: 1.5 };
  for (const item of ingredientDetails) {
    const guide = highConcentrationCategories[item.details.category];
    if (guide && item.percentage > guide) {
      warnings.push({
        type: 'concentration', severity: item.percentage > guide * 2 ? 'high' : 'medium',
        description: `${item.details.name} at ${item.percentage.toFixed(2)}% is above the typical ${item.details.category} process guide of ${guide}%. Confirm with bench and sensory testing.`,
      });
      overallScore -= 3;
    }
  }

  // Preservative category limits (total 0.5%)
  const preservatives = ingredientDetails.filter(i => i.details.category === 'preservative');
  const totalPreservative = preservatives.reduce((sum, i) => sum + i.percentage, 0);
  if (totalPreservative > 0.5) {
    risks.push({
      type: 'regulatory',
      severity: 'high',
      description: `Total preservative content ${totalPreservative.toFixed(2)}% exceeds 0.5% limit`,
    });
    overallScore -= 10;
  }

  // Colorant category limits (total 0.1%)
  const totalColorant = colorants.reduce((sum, i) => sum + i.percentage, 0);
  if (totalColorant > 0.5) {
    warnings.push({
      type: 'regulatory',
      severity: 'medium',
      description: `Total colorant content ${totalColorant.toFixed(2)}% is high. Verify compliance with local regulations.`,
    });
    overallScore -= 5;
  }

  // Caffeine limits for non-energy drinks
  const caffeine = ingredientDetails.filter(i => i.details.category === 'stimulant');
  const totalCaffeine = caffeine.reduce((sum, i) => sum + i.percentage, 0);
  if (totalCaffeine > 0.032) {
    risks.push({
      type: 'regulatory',
      severity: 'high',
      description: `Caffeine content ${totalCaffeine.toFixed(3)}% exceeds 0.032% (320mg/L) limit for regular beverages`,
    });
    overallScore -= 10;
  }

  // ============================================
  // 6. CHEMICAL STABILITY - Preservatives
  // ============================================
  const hasPreservative = preservatives.length > 0;
  const hasAcidulant = acidulants.length > 0;
  
  if (hasPreservative && !hasAcidulant) {
    warnings.push({
      type: 'chemical',
      severity: 'medium',
      description: 'Preservatives (Sodium Benzoate, Potassium Sorbate) require acidic pH (< 4.5) for effectiveness. Add acidulant.',
    });
    overallScore -= 5;
  }

  // Sodium Benzoate + Vitamin C = Benzene risk
  const hasSodiumBenzoate = preservatives.some(i => i.details.name.toLowerCase().includes('benzoate'));
  if (hasSodiumBenzoate && hasVitaminC) {
    risks.push({
      type: 'chemical',
      severity: 'high',
      description: 'Sodium Benzoate + Vitamin C can form benzene under heat/light. Use Potassium Sorbate instead or remove Vitamin C.',
    });
    overallScore -= 12;
  }

  // ============================================
  // FINAL SCORE
  // ============================================
  const evaluationTime = Date.now() - startTime;
  
  return {
    data: {
      overall_score: Math.max(0, Math.min(100, overallScore)),
      risks: risks.sort((a, b) => {
        const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        return severityOrder[a.severity] - severityOrder[b.severity];
      }),
      warnings: warnings.sort((a, b) => {
        const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        return severityOrder[a.severity] - severityOrder[b.severity];
      }),
      evaluation_time_ms: evaluationTime,
      checks_performed: {
        formulation_validation: true,
        chemical_compatibility: true,
        physical_stability: true,
        sensory_analysis: true,
        regulatory_compliance: true,
      },
    },
  };
});

function evaluateIngredientPair(first, second) {
  const names = [first.name, second.name].map(name => name.toLowerCase());
  const categoriesInPair = new Set([first.category, second.category]);
  const benzeneRisk = names.some(name => name.includes('benzoate')) &&
    names.some(name => name.includes('vitamin c') || name.includes('ascorbic'));
  const precipitationRisk = names.some(name => name.includes('calcium')) &&
    names.some(name => name.includes('citric'));
  const acidColorRisk = categoriesInPair.has('acidulant') && categoriesInPair.has('colorant');
  const risk = benzeneRisk || precipitationRisk || acidColorRisk;
  const severity = benzeneRisk ? 'high' : risk ? 'medium' : 'none';
  return {
    ingredient_a_id: first.id,
    ingredient_b_id: second.id,
    compatibility_score: benzeneRisk ? 35 : risk ? 65 : 95,
    chemical_risk: benzeneRisk || acidColorRisk,
    physical_risk: precipitationRisk,
    sensory_risk: false,
    regulatory_risk: benzeneRisk,
    risk_severity: severity,
    risk_description: benzeneRisk
      ? 'Sodium benzoate and vitamin C can form benzene under heat or light.'
      : precipitationRisk
      ? 'Calcium and citric acid may form a visible precipitate.'
      : acidColorRisk
      ? 'Acidity may reduce color stability.'
      : 'No known compatibility issue in the mock rule set.',
  };
}

server.get(`${apiPrefix}/compatibility/ingredients/:ingredientAId/:ingredientBId`, async (request, reply) => {
  const first = getIngredientById(request, request.params.ingredientAId);
  const second = getIngredientById(request, request.params.ingredientBId);
  if (!first || !second) return reply.code(404).send({ error: 'Ingredient not found' });
  if (first.id === second.id) return reply.code(400).send({ error: 'Choose two different ingredients' });
  return { data: evaluateIngredientPair(first, second) };
});

server.post(`${apiPrefix}/compatibility/batch-compute`, async (request, reply) => {
  const input = z.object({ ingredient_ids: z.array(z.string().min(1)).min(2).max(100).optional() }).parse(request.body || {});
  const selected = input.ingredient_ids
    ? input.ingredient_ids.map(id => getIngredientById(request, id))
    : request.store.ingredients.filter(item => item.is_active);
  if (selected.some(item => !item)) return reply.code(404).send({ error: 'One or more ingredients were not found' });

  const results = [];
  for (let firstIndex = 0; firstIndex < selected.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < selected.length; secondIndex += 1) {
      results.push(evaluateIngredientPair(selected[firstIndex], selected[secondIndex]));
    }
  }
  return reply.code(201).send({ data: results, count: results.length });
});

// ============================================================================
// AI ROUTES
// ============================================================================

function percentageDifference(value, baseline) {
  if (baseline === 0) return value === 0 ? 0 : 100;
  return ((value - baseline) / baseline) * 100;
}

function assessVariantIngredients(request, variantIngredients) {
  const ingredientDetails = variantIngredients.map(item => getIngredientById(request, item.ingredient_id));
  const pairResults = [];
  for (let firstIndex = 0; firstIndex < ingredientDetails.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < ingredientDetails.length; secondIndex += 1) {
      pairResults.push(evaluateIngredientPair(ingredientDetails[firstIndex], ingredientDetails[secondIndex]));
    }
  }

  const riskyPairs = pairResults.filter(result => result.risk_severity !== 'none');
  const warnings = [...new Set(riskyPairs.map(result => result.risk_description))];
  const nonApprovedIngredients = ingredientDetails.filter(item => item.regulatory_status !== 'approved');
  warnings.push(...nonApprovedIngredients.map(item => `${item.name} has ${item.regulatory_status} regulatory status.`));

  return {
    compatibility_score: pairResults.length
      ? Math.min(...pairResults.map(result => result.compatibility_score))
      : 100,
    warnings: [...new Set(warnings)],
    regulatory: {
      passes_local_checks: nonApprovedIngredients.length === 0,
      is_halal_compliant: ingredientDetails.every(item => item.halal_certified),
      is_kosher_compliant: ingredientDetails.every(item => item.kosher_certified),
      is_vegan_compliant: ingredientDetails.every(item => item.vegan),
      note: 'Local ingredient-limit screening only; laboratory and legal review are still required.',
    },
  };
}

function generateVariantIngredients(request, sourceIngredients, generationType, constraints = {}) {
  const sourceIds = new Set(sourceIngredients.map(item => item.ingredient_id));
  const replacementIds = new Set();
  const details = sourceIngredients.map(item => {
    const sourceIngredient = getIngredientById(request, item.ingredient_id);
    let ingredient = sourceIngredient;
    if (generationType === 'alternative' && sourceIngredient?.category !== 'base') {
      const alternatives = request.store.ingredients.filter(candidate =>
        candidate.is_active &&
        candidate.category === sourceIngredient.category &&
        !sourceIds.has(candidate.id) &&
        !replacementIds.has(candidate.id) &&
        candidate.regulatory_status !== 'prohibited'
      );
      if (alternatives.length > 0) {
        ingredient = alternatives[Math.floor(Math.random() * alternatives.length)];
        replacementIds.add(ingredient.id);
      }
    }
    return { source: item, ingredient };
  });
  const balanceIndex = details.findIndex(item => item.ingredient?.category === 'base');
  const effectiveBalanceIndex = balanceIndex >= 0 ? balanceIndex : 0;
  const sugarBearingCount = Math.max(1, details.filter(item => item.ingredient?.sugar_g > 0).length);
  const calorieBearingCount = Math.max(1, details.filter(item => item.ingredient?.calories_per_100g > 0).length);

  const generated = details.map(({ source, ingredient }, index) => {
    if (index === effectiveBalanceIndex) {
      return { ingredient_id: ingredient.id, ingredient_name: ingredient.name, percentage: 0 };
    }

    let factor;
    if (generationType === 'optimization') {
      const pricePressure = Math.min((ingredient.base_price_per_kg || 0) / 3000, 0.08);
      factor = 0.9 + Math.random() * 0.1 - pricePressure;
    } else if (generationType === 'alternative') {
      factor = 0.7 + Math.random() * 0.6;
    } else {
      factor = 0.8 + Math.random() * 0.4;
    }

    let changedPercentage = Math.max(0.0001, source.percentage * factor);
    if (generationType === 'constraint_based') {
      if (constraints.target_sugar !== undefined && ingredient.sugar_g > 0) {
        changedPercentage = Math.max(0.0001, (constraints.target_sugar / sugarBearingCount / ingredient.sugar_g) * 100);
      } else if (constraints.target_calories !== undefined && ingredient.calories_per_100g > 0) {
        changedPercentage = Math.max(0.0001, (constraints.target_calories / calorieBearingCount / ingredient.calories_per_100g) * 100);
      } else if (constraints.target_cost_per_liter !== undefined && constraints.source_cost_per_liter > 0) {
        const costRatio = Math.max(0.5, Math.min(1.5, constraints.target_cost_per_liter / constraints.source_cost_per_liter));
        changedPercentage = source.percentage * costRatio;
      }
    }
    const percentage = ingredient.max_percentage
      ? Math.min(changedPercentage, ingredient.max_percentage)
      : changedPercentage;
    return { ingredient_id: ingredient.id, ingredient_name: ingredient.name, percentage };
  });

  const nonBalanceTotal = generated.reduce(
    (sum, item, index) => index === effectiveBalanceIndex ? sum : sum + item.percentage,
    0,
  );
  if (nonBalanceTotal >= 100) {
    throw new Error('Unable to generate a safe variant because non-base ingredients total 100% or more');
  }
  generated[effectiveBalanceIndex].percentage = 100 - nonBalanceTotal;
  return generated;
}

server.post(`${apiPrefix}/ai/formulations/:id/generate`, async (request, reply) => {
  const { id } = request.params;
  const { count, generation_type, target_calories, target_sugar, target_cost_per_liter } = z.object({
    count: z.coerce.number().int().min(1).max(10).default(5),
    generation_type: z.enum(['optimization', 'alternative', 'constraint', 'constraint_based'])
      .transform(value => value === 'constraint' ? 'constraint_based' : value)
      .default('optimization'),
    target_calories: z.coerce.number().finite().nonnegative().optional(),
    target_sugar: z.coerce.number().finite().nonnegative().optional(),
    target_cost_per_liter: z.coerce.number().finite().nonnegative().optional(),
  }).parse(request.body || {});
  
  const source = findAccessibleFormulation(request, id);
  if (!source) {
    return reply.code(404).send({ error: 'Source formulation not found' });
  }
  
  const variants = [];
  const sourceIngredients = source.ingredients || [];
  const sourceTotals = processFormulationIngredients(request, sourceIngredients);
  const consentedOutcomes = request.store.aiLearningExamples.filter(item =>
    item.formulation_id === source.id && isOwnedByRequest(request, item)
  );
  const sourceResultIds = new Set(consentedOutcomes.map(item => item.laboratory_result_id));
  const sourceLabResults = request.store.laboratoryResults.filter(item => sourceResultIds.has(item.id));
  const acceptedScores = sourceLabResults
    .map(item => item.sensory?.overall_acceptance)
    .filter(Number.isFinite);
  const stabilityScores = sourceLabResults
    .map(item => item.measurements?.stability_score)
    .filter(Number.isFinite);
  // Use only consented, measured outcomes to calibrate local confidence. This
  // keeps generated amounts governed by the same safety/limit checks.
  const measuredQuality = acceptedScores.length || stabilityScores.length
    ? ((acceptedScores.reduce((sum, score) => sum + score, 0) / Math.max(1, acceptedScores.length)) * 10 * 0.6) +
      ((stabilityScores.reduce((sum, score) => sum + score, 0) / Math.max(1, stabilityScores.length)) * 0.4)
    : null;

  for (let i = 0; i < count; i++) {
    const variantIngredients = generateVariantIngredients(request, sourceIngredients, generation_type, {
      target_calories,
      target_sugar,
      target_cost_per_liter,
      source_cost_per_liter: sourceTotals.total_cost_per_liter,
    });
    const totals = processFormulationIngredients(request, variantIngredients);
    const assessment = assessVariantIngredients(request, totals.ingredients);
    const localConfidence = Math.max(0, Math.min(
      assessment.compatibility_score,
      assessment.regulatory.passes_local_checks ? 88 : 50,
      measuredQuality === null ? 100 : measuredQuality,
    ));
    const variant = {
      id: generateId(),
      owner_id: request.user?.id,
      source_formulation_id: id,
      source_formulation_name: source.name,
      generation_type,
      variant_ingredients: totals.ingredients,
      confidence_score: localConfidence,
      explanation: generation_type === 'optimization' 
        ? `Locally generated cost-oriented variant ${i + 1}; calculated values and ingredient limits have been checked.${measuredQuality === null ? '' : ' Confidence is calibrated against consented laboratory outcomes.'}`
        : generation_type === 'alternative'
        ? `Locally generated alternative ${i + 1} with a broader change in ingredient proportions.`
        : `Locally generated constraint-oriented variant ${i + 1}; no explicit targets were supplied.`,
      cost_difference_percent: percentageDifference(totals.total_cost_per_liter, sourceTotals.total_cost_per_liter),
      calorie_difference_percent: percentageDifference(totals.total_calories_per_100ml, sourceTotals.total_calories_per_100ml),
      sugar_difference_percent: percentageDifference(totals.total_sugar_per_100ml, sourceTotals.total_sugar_per_100ml),
      calculated_values: {
        cost_per_liter: totals.total_cost_per_liter,
        calories_per_100ml: totals.total_calories_per_100ml,
        sugar_per_100ml: totals.total_sugar_per_100ml,
      },
      compatibility_score: assessment.compatibility_score,
      regulatory: assessment.regulatory,
      warnings: assessment.warnings,
      recommended: false,
      status: 'generated',
      created_at: new Date().toISOString(),
    };
    variants.push(variant);
  }

  const aiDecision = await prepareExternalAI(request, 'variant_review');
  let ai = {
    ...aiDecision.configuration,
    used: false,
    reason: aiDecision.reason,
    quota_code: aiDecision.quota_code,
    ...aiDecision.governance,
  };
  if (aiDecision.allowed) {
    try {
      ai = await reviewFormulationVariants({
        sourceFormulation: source,
        variants,
        generationType: generation_type,
        constraints: { target_calories, target_sugar, target_cost_per_liter },
        privacy: aiDecision.preferences,
      });
      await finishExternalAI(request, aiDecision, 'succeeded', ai.usage);
      if (ai.used) {
        const reviewsById = new Map(ai.reviews.map(review => [review.id, review]));
        for (const variant of variants) {
          const review = reviewsById.get(variant.id);
          variant.confidence_score = review.confidence_score;
          variant.explanation = review.explanation;
          variant.warnings = [...new Set([...variant.warnings, ...review.warnings])];
          variant.recommended = review.recommended;
        }
      }
      ai = { ...ai, ...aiDecision.governance };
    } catch (error) {
      await finishExternalAI(request, aiDecision, 'failed');
      request.log.warn({ err: error }, 'Gemini variant review failed; using validated local results');
      ai = { ...getAIConfiguration(), used: false, reason: describeGeminiFailure(error), ...aiDecision.governance };
    }
  }

  variants.forEach(variant => request.store.aiVariants.push(variant));
  const { reviews: _reviews, usage: _usage, ...publicAI } = ai;
  return reply.code(201).send({ data: variants, count: variants.length, ai: publicAI, learning: {
    consented_outcomes_used: sourceLabResults.length,
    calibration_applied: measuredQuality !== null,
  } });
});

server.get(`${apiPrefix}/ai/formulations/:id/variants`, async (request, reply) => {
  if (!findAccessibleFormulation(request, request.params.id)) {
    return reply.code(404).send({ error: 'Source formulation not found' });
  }
  const { limit, offset } = paginationSchema.extend({ limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(request.query);
  const filtered = request.store.aiVariants.filter(item => isOwnedByRequest(request, item) &&
    item.source_formulation_id === request.params.id && (!request.query.status || item.status === request.query.status)
  );
  return {
    data: filtered.slice(offset, offset + limit),
    pagination: { total: filtered.length, limit, offset, has_more: offset + limit < filtered.length },
  };
});

// Accept AI variant and create formulation
server.post(`${apiPrefix}/ai/variants/:variantId/accept`, async (request, reply) => {
  const { variantId } = request.params;
  const { variant_data } = z.object({
    variant_data: z.object({
      source_name: z.string().trim().min(1).max(255).optional(),
      beverage_type: z.string().trim().min(1).max(100).optional(),
      explanation: z.string().trim().max(5000).optional(),
      ingredients: z.array(formulationIngredientSchema).optional(),
    }),
  }).parse(request.body);

  const storedVariant = request.store.aiVariants.find(item => item.id === variantId && isOwnedByRequest(request, item));
  if (!storedVariant) return reply.code(404).send({ error: 'AI variant not found' });
  if (storedVariant.status === 'accepted') return reply.code(409).send({ error: 'AI variant was already accepted' });
  
  const totals = processFormulationIngredients(request, storedVariant.variant_ingredients);
  
  const newFormulation = addFormulation(request, {
    owner_id: request.user?.id,
    code: `AI-${Date.now()}`,
    name: `${variant_data.source_name || 'AI Variant'} (AI Generated)`,
    description: variant_data.explanation || 'Created from AI recommendation',
    beverage_type: variant_data.beverage_type || 'soft_drink',
    version: 1,
    is_latest_version: true,
    status: 'draft',
    ...totals,
  });

  storedVariant.status = 'accepted';
  storedVariant.accepted_formulation_id = newFormulation.id;
  
  return reply.code(201).send({ 
    data: newFormulation,
    message: 'AI variant accepted and formulation created successfully'
  });
});

// ============================================================================
// TARGET GENERATION ROUTES
// ============================================================================

server.get(`${apiPrefix}/target-generation/runs`, async (request) => {
  const { limit, offset } = paginationSchema.parse(request.query);
  const filtered = request.store.targetGenerationRuns
    .filter(item => isOwnedByRequest(request, item))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return {
    data: filtered.slice(offset, offset + limit),
    pagination: { total: filtered.length, limit, offset, has_more: offset + limit < filtered.length },
  };
});

server.get(`${apiPrefix}/target-generation/runs/:id`, async (request, reply) => {
  const run = request.store.targetGenerationRuns.find(item => item.id === request.params.id && isOwnedByRequest(request, item));
  if (!run) return reply.code(404).send({ error: 'Generation run not found' });
  return { data: run };
});

const formulationObjectiveSchema = z.enum(['cost', 'sugar', 'calories', 'ingredient_count', 'reference_deviation']);
const targetGenerationSchema = z.object({
  project_id: z.string().trim().min(1).optional(),
  reference_formulation_id: z.string().trim().min(1).optional(),
  target_calories: z.coerce.number().finite().nonnegative().optional(),
  target_sugar: z.coerce.number().finite().nonnegative().optional(),
  target_cost_per_liter: z.coerce.number().finite().nonnegative().optional(),
  max_calories_per_100ml: z.coerce.number().finite().nonnegative().optional(),
  max_sugar_g_per_100ml: z.coerce.number().finite().nonnegative().optional(),
  max_cost_per_liter: z.coerce.number().finite().nonnegative().optional(),
  minimum_juice_percent: z.coerce.number().finite().min(0).max(99).optional(),
  maximum_preservative_percent: z.coerce.number().finite().min(0).max(10).optional(),
  maximum_caffeine_percent: z.coerce.number().finite().min(0).max(10).optional(),
  maximum_sodium_mg_per_100ml: z.coerce.number().finite().nonnegative().optional(),
  target_ph_min: z.coerce.number().finite().min(0).max(14).optional(),
  target_ph_max: z.coerce.number().finite().min(0).max(14).optional(),
  required_ingredient_ids: z.array(z.string().trim().min(1)).max(30).default([]),
  forbidden_ingredient_ids: z.array(z.string().trim().min(1)).max(30).default([]),
  ingredient_bounds: z.array(z.object({
    ingredient_id: z.string().trim().min(1),
    min_percentage: z.coerce.number().finite().min(0).max(100).optional(),
    max_percentage: z.coerce.number().finite().min(0).max(100).optional(),
  })).max(40).default([]),
  objectives: z.array(formulationObjectiveSchema).min(1).max(5).default(['cost', 'sugar', 'calories']),
  beverage_type: z.string().trim().min(1).max(100).optional(),
  count: z.coerce.number().int().min(1).max(10).default(3),
  min_ingredients: z.coerce.number().int().min(1).max(40).default(5),
  max_ingredients: z.coerce.number().int().min(1).max(40).default(10),
}).superRefine((input, context) => {
  if (input.min_ingredients > input.max_ingredients) context.addIssue({ code: z.ZodIssueCode.custom, path: ['min_ingredients'], message: 'min_ingredients cannot exceed max_ingredients' });
  if (input.target_ph_min !== undefined && input.target_ph_max !== undefined && input.target_ph_min > input.target_ph_max) context.addIssue({ code: z.ZodIssueCode.custom, path: ['target_ph_max'], message: 'Maximum target pH must be greater than or equal to minimum target pH' });
  for (const [index, bound] of input.ingredient_bounds.entries()) if (bound.min_percentage !== undefined && bound.max_percentage !== undefined && bound.min_percentage > bound.max_percentage) context.addIssue({ code: z.ZodIssueCode.custom, path: ['ingredient_bounds', index], message: 'Minimum percentage cannot exceed maximum percentage' });
});

server.post(`${apiPrefix}/target-generation/generate`, async (request, reply) => {
  const input = targetGenerationSchema.parse(request.body || {});
  let project = null;
  if (input.project_id) {
    project = ownedProject(request, input.project_id);
    if (!project) return reply.code(400).send({ error: 'Linked R&D project is unavailable' });
    if (project.brief_status !== 'validated') return reply.code(409).send({ error: 'Validate the structured R&D brief before generating linked candidates' });
  }
  let reference = null;
  if (input.reference_formulation_id) {
    reference = findAccessibleFormulation(request, input.reference_formulation_id);
    if (!reference) return reply.code(400).send({ error: 'Reference formulation is unavailable' });
    if (project && reference.project_id !== project.id) return reply.code(400).send({ error: 'Reference formulation must belong to the selected project' });
  }
  const activeIngredients = request.store.ingredients.filter(item => item.is_active && item.regulatory_status === 'approved');
  const result = generateFormulationCandidates(input, activeIngredients, reference?.ingredients || []);
  const aiDecision = await prepareExternalAI(request, 'target_review');
  let ai = { ...aiDecision.configuration, used: false, reason: aiDecision.reason, quota_code: aiDecision.quota_code, ...aiDecision.governance };
  if (result.candidates.length && aiDecision.allowed) {
    try {
      const reviewResult = await reviewFormulationCandidates({ candidates: result.candidates, constraints: input, privacy: aiDecision.preferences });
      await finishExternalAI(request, aiDecision, 'succeeded', reviewResult.usage);
      ai = { provider: reviewResult.provider, model: reviewResult.model, configured: reviewResult.configured, used: reviewResult.used, schema_version: reviewResult.schema_version, scope: 'narrative_review_only', ...aiDecision.governance };
      if (reviewResult.used) {
        const reviews = new Map(reviewResult.reviews.map(review => [review.id, review]));
        for (const candidate of result.candidates) {
          const review = reviews.get(candidate.id);
          if (!review) continue;
          candidate.ai_explanation = review.explanation;
          candidate.ai_warnings = review.warnings;
          candidate.ai_review = { compatibility: review.compatibility, sensory: review.sensory, stability: review.stability, advisory_only: true };
        }
      }
    } catch (error) {
      await finishExternalAI(request, aiDecision, 'failed');
      request.log.warn({ err: error }, 'Gemini review failed; returning deterministic candidates');
      ai = { ...getAIConfiguration(), used: false, reason: describeGeminiFailure(error), scope: 'narrative_review_only', ...aiDecision.governance };
    }
  }
  const generationRun = { id: generateId(), owner_id: request.user?.id, constraints: input, candidates: result.candidates, feasibility: result.feasibility, reproducibility: result.reproducibility, ai: { ...ai, feasibility: result.feasibility, reproducibility: result.reproducibility }, created_at: new Date().toISOString() };
  request.store.targetGenerationRuns.push(generationRun);
  const payload = { candidates: result.candidates, formulations: [], feasibility: result.feasibility, reproducibility: result.reproducibility, ai, run_id: generationRun.id };
  if (!result.feasibility.feasible || result.feasibility.feasible_candidate_count === 0) return reply.code(422).send({ error: 'No feasible candidate satisfies the hard constraints', code: 'FORMULATION_CONSTRAINTS_INFEASIBLE', data: payload });
  return reply.code(201).send({ data: payload, message: `Generated ${result.candidates.length} reproducible candidates with engine ${FORMULATION_ENGINE_VERSION}` });
});

/* Historical target generator retained temporarily for audit comparison only.
   It is deliberately not registered as an HTTP route and cannot execute.
server.post(`${apiPrefix}/target-generation/generate-legacy`, async (request, reply) => {
  const targetInput = z.object({
    target_calories: z.coerce.number().finite().nonnegative().optional(),
    target_sugar: z.coerce.number().finite().nonnegative().optional(),
    target_cost_per_liter: z.coerce.number().finite().nonnegative().optional(),
    beverage_type: z.string().trim().min(1).max(100).optional(),
    count: z.coerce.number().int().min(1).max(10).default(3),
    min_ingredients: z.coerce.number().int().min(1).max(40).default(5),
    max_ingredients: z.coerce.number().int().min(1).max(40).default(10),
  }).refine(input => input.min_ingredients <= input.max_ingredients, {
    path: ['min_ingredients'],
    message: 'min_ingredients cannot exceed max_ingredients',
  }).parse(request.body || {});
  const {
    target_calories, target_sugar, target_cost_per_liter, beverage_type, count,
    min_ingredients, max_ingredients,
  } = targetInput;

  const activeIngredients = request.store.ingredients.filter(item => item.is_active && item.regulatory_status === 'approved');
  if (min_ingredients > activeIngredients.length) {
    return reply.code(400).send({ error: `Only ${activeIngredients.length} active, locally approved ingredients are available` });
  }
  
  // Generate candidates with detailed scoring
  const candidates = [];
  
  for (let i = 0; i < count; i++) {
    const selectedIngredients = [];
    
    // Always include water (base)
    const bases = activeIngredients.filter(ing => ing.category === 'base')
      .sort((a, b) => a.base_price_per_kg - b.base_price_per_kg);
    const water = bases[i % Math.max(bases.length, 1)];
    if (water) {
      selectedIngredients.push({ 
        ingredient_id: water.id, 
        ingredient_name: water.name,
        category: water.category,
        percentage: 0,
      });
    }
    
    // Add sweetener based on target sugar
    const sweeteners = activeIngredients.filter(ing => ing.category === 'sweetener');
    if (sweeteners.length > 0) {
      const zeroSugarSweeteners = sweeteners.filter(item => item.sugar_g === 0);
      const sugarSweeteners = sweeteners.filter(item => item.sugar_g > 0);
      const sweetenerPool = target_sugar === 0 && zeroSugarSweeteners.length > 0
        ? zeroSugarSweeteners
        : target_sugar > 0 && sugarSweeteners.length > 0
        ? sugarSweeteners
        : sweeteners;
      const orderedSweeteners = [...sweetenerPool].sort((a, b) =>
        target_cost_per_liter === undefined ? a.name.localeCompare(b.name) : a.base_price_per_kg - b.base_price_per_kg
      );
      const sweetener = orderedSweeteners[i % orderedSweeteners.length];
      const effectiveSugarTarget = target_sugar ?? (target_calories !== undefined ? target_calories / 3.87 : undefined);
      const sweetenerPct = target_sugar === 0
        ? Math.min(sweetener.max_percentage || 0.05, 0.05)
        : effectiveSugarTarget !== undefined
        ? (effectiveSugarTarget / Math.max(sweetener.sugar_g, 1)) * 100
        : 8 + i;
      selectedIngredients.push({ 
        ingredient_id: sweetener.id, 
        ingredient_name: sweetener.name,
        category: sweetener.category,
        percentage: Math.min(sweetener.max_percentage || 15, 15, Math.max(0.01, sweetenerPct))
      });
    }
    
    // Add acidulant
    const acidulants = activeIngredients.filter(ing => ing.category === 'acidulant');
    if (acidulants.length > 0) {
      const acidulant = acidulants[i % acidulants.length];
      selectedIngredients.push({ 
        ingredient_id: acidulant.id, 
        ingredient_name: acidulant.name,
        category: acidulant.category,
        percentage: Math.min(acidulant.max_percentage || 0.3, 0.25 + (i % 3) * 0.05),
      });
    }
    
    // Add flavor
    const flavors = activeIngredients.filter(ing => ing.category === 'flavor');
    if (flavors.length > 0) {
      const flavor = flavors[i % flavors.length];
      selectedIngredients.push({ 
        ingredient_id: flavor.id, 
        ingredient_name: flavor.name,
        category: flavor.category,
        percentage: Math.min(flavor.max_percentage || 0.25, 0.15 + (i % 3) * 0.05),
      });
    }
    
    // Add preservative
    const preservatives = activeIngredients.filter(ing => ing.category === 'preservative');
    if (preservatives.length > 0) {
      const preservative = preservatives[i % preservatives.length];
      selectedIngredients.push({ 
        ingredient_id: preservative.id, 
        ingredient_name: preservative.name,
        category: preservative.category,
        percentage: Math.min(preservative.max_percentage || 0.04, 0.04),
      });
    }
    
    // Optionally add colorant
    if (i % 2 === 1) {
      const colorants = activeIngredients.filter(ing => ing.category === 'colorant');
      if (colorants.length > 0) {
        const colorant = colorants[i % colorants.length];
        selectedIngredients.push({ 
          ingredient_id: colorant.id, 
          ingredient_name: colorant.name,
          category: colorant.category,
          percentage: Math.min(colorant.max_percentage || 0.02, 0.02),
        });
      }
    }
    
    // Honor requested ingredient-count bounds using low-dose, active ingredients.
    const desiredCount = Math.min(max_ingredients, min_ingredients + (i % (max_ingredients - min_ingredients + 1)));
    const alreadySelected = new Set(selectedIngredients.map(item => item.ingredient_id));
    const additions = activeIngredients
      .filter(item => !alreadySelected.has(item.id) && item.category !== 'base')
      .sort((a, b) => {
        if (target_cost_per_liter !== undefined) return a.base_price_per_kg - b.base_price_per_kg;
        return a.name.localeCompare(b.name);
      });
    while (selectedIngredients.length < desiredCount && additions.length > 0) {
      const ingredient = additions.shift();
      selectedIngredients.push({
        ingredient_id: ingredient.id,
        ingredient_name: ingredient.name,
        category: ingredient.category,
        percentage: Math.min(ingredient.max_percentage || 0.05, 0.05),
      });
    }
    if (selectedIngredients.length > max_ingredients) selectedIngredients.splice(max_ingredients);

    // Water is the balance ingredient; never inflate limited additives through normalization.
    const balanceIngredient = selectedIngredients[0];
    const nonWaterTotal = selectedIngredients.slice(1).reduce((sum, item) => sum + item.percentage, 0);
    if (nonWaterTotal >= 100) {
      return reply.code(400).send({ error: 'The requested targets cannot produce a safe 100% formulation' });
    }
    balanceIngredient.percentage = 100 - nonWaterTotal;
    
    // Calculate actual values
    let actualCalories = 0;
    let actualSugar = 0;
    let actualCost = 0;
    
    for (const item of selectedIngredients) {
      const ing = getIngredientById(request, item.ingredient_id);
      if (ing) {
        actualCalories += (item.percentage / 100) * (ing.calories_per_100g || 0);
        actualSugar += (item.percentage / 100) * (ing.sugar_g || 0);
        actualCost += (item.percentage / 100) * (ing.base_price_per_kg || 0);
      }
    }
    
    const localAssessment = assessVariantIngredients(request, selectedIngredients);
    const hasAcidulant = selectedIngredients.some(item => item.category === 'acidulant');
    const hasFlavor = selectedIngredients.some(item => item.category === 'flavor');
    const hasPreservative = selectedIngredients.some(item => item.category === 'preservative');
    const sweetnessScore = target_sugar !== undefined
      ? target_sugar === 0 ? (actualSugar < 0.01 ? 100 : 0) : Math.max(0, 100 - Math.abs(actualSugar - target_sugar) / target_sugar * 100)
      : 80;
    const stabilityBase = Math.max(40, localAssessment.compatibility_score - (hasAcidulant ? 0 : 10));

    // These deterministic values are local screening heuristics, not laboratory predictions.
    const scores = {
      // Target matching scores
      calorie_match: target_calories !== undefined
        ? target_calories === 0 ? (actualCalories < 0.01 ? 100 : 0) : Math.max(0, 100 - Math.abs(actualCalories - target_calories) / target_calories * 100)
        : 100,
      sugar_match: target_sugar !== undefined
        ? target_sugar === 0 ? (actualSugar < 0.01 ? 100 : 0) : Math.max(0, 100 - Math.abs(actualSugar - target_sugar) / target_sugar * 100)
        : 100,
      cost_match: target_cost_per_liter !== undefined
        ? target_cost_per_liter === 0 ? (actualCost < 0.01 ? 100 : 0) : Math.max(0, 100 - Math.abs(actualCost - target_cost_per_liter) / target_cost_per_liter * 100)
        : 100,
      
      // Compatibility score
      compatibility: localAssessment.compatibility_score,
      
      // Sensory evaluation
      sensory: {
        taste_balance: Math.round((sweetnessScore + (hasAcidulant ? 85 : 60) + (hasFlavor ? 85 : 55)) / 3),
        sweetness_level: Math.round(sweetnessScore),
        acidity_balance: hasAcidulant ? 85 : 55,
        flavor_intensity: hasFlavor ? 85 : 55,
      },
      
      // Regulatory compliance
      regulatory: {
        halal_compliant: localAssessment.regulatory.is_halal_compliant,
        kosher_compliant: localAssessment.regulatory.is_kosher_compliant,
        vegan_compliant: localAssessment.regulatory.is_vegan_compliant,
        max_limits_ok: localAssessment.regulatory.passes_local_checks,
        preservative_ok: !hasPreservative || hasAcidulant,
      },
      
      // Stability prediction
      stability: {
        shelf_life_months: hasPreservative && hasAcidulant ? 9 : 3,
        ph_stability: stabilityBase,
        color_stability: Math.max(40, stabilityBase - (selectedIngredients.some(item => item.category === 'colorant') ? 5 : 0)),
      },
      basis: 'deterministic local screening heuristic; laboratory validation required',
    };
    
    // Calculate overall score
    const sensoryAvg = (scores.sensory.taste_balance + scores.sensory.sweetness_level + 
                        scores.sensory.acidity_balance + scores.sensory.flavor_intensity) / 4;
    const targetMatchAvg = (scores.calorie_match + scores.sugar_match + scores.cost_match) / 3;
    
    const overallScore = (
      targetMatchAvg * 0.4 +      // 40% weight on target matching
      scores.compatibility * 0.25 + // 25% weight on compatibility
      sensoryAvg * 0.25 +          // 25% weight on sensory
      ((scores.stability.ph_stability + scores.stability.color_stability) / 2) * 0.1  // 10% on stability
    );
    
    candidates.push({
      id: generateId(),
      ingredients: selectedIngredients,
      calculated_values: {
        calories_per_100ml: actualCalories,
        sugar_per_100ml: actualSugar,
        cost_per_liter: actualCost,
      },
      scores: scores,
      overall_score: overallScore,
      beverage_type: beverage_type || 'soft_drink',
      local_warnings: localAssessment.warnings,
    });
  }

  const aiDecision = await prepareExternalAI(request, 'target_review');
  let ai = {
    ...aiDecision.configuration,
    used: false,
    reason: aiDecision.reason,
    quota_code: aiDecision.quota_code,
    ...aiDecision.governance,
  };
  if (aiDecision.allowed) {
    try {
      const reviewResult = await reviewFormulationCandidates({
        candidates,
        constraints: { target_calories, target_sugar, target_cost_per_liter, beverage_type },
        privacy: aiDecision.preferences,
      });
      await finishExternalAI(request, aiDecision, 'succeeded', reviewResult.usage);
      ai = {
        provider: reviewResult.provider,
        model: reviewResult.model,
        configured: reviewResult.configured,
        used: reviewResult.used,
        schema_version: reviewResult.schema_version,
        ...aiDecision.governance,
      };

      if (reviewResult.used) {
        const reviewsById = new Map(reviewResult.reviews.map(review => [review.id, review]));
        for (const candidate of candidates) {
          const review = reviewsById.get(candidate.id);
          candidate.scores.compatibility = review.compatibility;
          candidate.scores.sensory = review.sensory;
          candidate.scores.stability = review.stability;
          candidate.ai_explanation = review.explanation;
          candidate.ai_warnings = review.warnings;

          const sensoryAverage = Object.values(review.sensory).reduce((sum, value) => sum + value, 0) / 4;
          const targetMatchAverage = (
            candidate.scores.calorie_match + candidate.scores.sugar_match + candidate.scores.cost_match
          ) / 3;
          candidate.overall_score = (
            targetMatchAverage * 0.4 +
            review.compatibility * 0.25 +
            sensoryAverage * 0.25 +
            ((review.stability.ph_stability + review.stability.color_stability) / 2) * 0.1
          );
        }
      }
    } catch (error) {
      await finishExternalAI(request, aiDecision, 'failed');
      request.log.warn({ err: error }, 'Gemini review failed; returning validated local candidates');
      ai = { ...getAIConfiguration(), used: false, reason: describeGeminiFailure(error), ...aiDecision.governance };
    }
  }
  
  // Sort by overall score
  candidates.sort((a, b) => b.overall_score - a.overall_score);

  const generationRun = {
    id: generateId(),
    owner_id: request.user?.id,
    constraints: targetInput,
    candidates,
    ai,
    created_at: new Date().toISOString(),
  };
  request.store.targetGenerationRuns.push(generationRun);
  
  return reply.code(201).send({
    data: { candidates, formulations: [], ai, run_id: generationRun.id },
    message: `Generated ${candidates.length} candidates`,
  });
});
*/

// Save target-generated candidate as formulation
server.post(`${apiPrefix}/target-generation/save`, async (request, reply) => {
  const input = z.object({
    run_id: z.string().trim().min(1).optional(),
    candidate_id: z.string().trim().min(1).optional(),
    project_id: z.string().trim().min(1).optional(),
    candidate: z.object({
      ingredients: z.array(formulationIngredientSchema).min(1).max(40),
      overall_score: z.coerce.number().finite().min(0).max(100).optional(),
      beverage_type: z.string().trim().min(1).max(100).optional(),
    }).passthrough().optional(),
    name: z.string().trim().min(1).max(255).optional(),
  }).superRefine((value, context) => {
    if (!(value.candidate || (value.run_id && value.candidate_id))) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Provide a candidate or an owned generation run and candidate identifier' });
  }).parse(request.body);

  const run = input.run_id ? request.store.targetGenerationRuns.find(item => item.id === input.run_id && isOwnedByRequest(request, item)) : null;
  if (input.run_id && !run) return reply.code(404).send({ error: 'Generation run not found' });
  const candidate = run ? run.candidates.find(item => item.id === input.candidate_id) : input.candidate;
  if (!candidate) return reply.code(404).send({ error: 'Candidate not found in generation run' });
  if (candidate.feasible === false) return reply.code(409).send({ error: 'An infeasible candidate cannot be saved as a formulation' });
  const projectId = input.project_id || run?.constraints?.project_id || null;
  if (projectId) {
    const project = ownedProject(request, projectId);
    if (!project) return reply.code(400).send({ error: 'Linked R&D project is unavailable' });
    if (project.brief_status !== 'validated') return reply.code(409).send({ error: 'Validate the structured R&D brief before saving a linked formulation' });
  }
  
  const totals = processFormulationIngredients(request, candidate.ingredients);
  
  const newFormulation = addFormulation(request, {
    owner_id: request.user?.id,
    code: `TGT-${Date.now()}`,
    name: input.name || `Constraint candidate ${new Date().toLocaleDateString()}`,
    description: `Feasible candidate generated under explicit hard constraints; laboratory validation required.`,
    beverage_type: candidate.beverage_type || 'soft_drink',
    project_id: projectId,
    generation_run_id: run?.id || null,
    generation_candidate_id: candidate.id || null,
    generation_engine_version: run?.reproducibility?.engine_version || null,
    generation_input_signature: run?.reproducibility?.input_signature || null,
    generation_constraint_results: candidate.constraint_results || [],
    validation_status: candidate.validation_status || 'candidate_for_laboratory_validation',
    version: 1,
    is_latest_version: true,
    status: 'draft',
    ...totals,
  });

  if (projectId) {
    const project = ownedProject(request, projectId);
    addProjectEvent(request, project, 'generated_candidate_saved', { formulation_version_id: newFormulation.id, generation_run_id: run?.id || null, candidate_id: candidate.id || null });
  }
  
  return reply.code(201).send({ 
    data: newFormulation,
    message: 'Formulation created successfully from target generation'
  });
});

// ============================================================================
// REGULATORY ROUTES
// ============================================================================

server.post(`${apiPrefix}/regulatory/formulations/:id/check`, async (request, reply) => {
  const formulation = findAccessibleFormulation(request, request.params.id);
  if (!formulation) {
    return reply.code(404).send({ error: 'Formulation not found' });
  }
  
  // Check compliance
  let isHalal = true;
  let isKosher = true;
  let isVegan = true;
  const violations = [];
  const warnings = [];
  
  for (const fi of (formulation.ingredients || [])) {
    const ing = getIngredientById(request, fi.ingredient_id);
    if (ing) {
      if (!ing.halal_certified) isHalal = false;
      if (!ing.kosher_certified) isKosher = false;
      if (!ing.vegan) isVegan = false;
      if (ing.max_percentage && fi.percentage > ing.max_percentage) {
        violations.push({
          type: 'regulatory',
          ingredient: ing.name,
          message: `Exceeds max allowed percentage (${ing.max_percentage}%)`,
        });
      }
      if (ing.regulatory_status === 'restricted') {
        violations.push({
          type: 'regulatory',
          ingredient: ing.name,
          message: 'Ingredient has restricted status and requires jurisdiction-specific review',
        });
      }
    } else {
      violations.push({ type: 'data', message: `Ingredient ${fi.ingredient_id} was not found` });
    }
  }

  const assessment = assessVariantIngredients(request, formulation.ingredients || []);
  warnings.push(...assessment.warnings);
  
  const compliance = {
      id: generateId(),
      owner_id: request.user?.id,
      formulation_id: formulation.id,
      is_halal_compliant: isHalal,
      is_kosher_compliant: isKosher,
      is_vegan_compliant: isVegan,
      algerian_regulatory_compliant: violations.length === 0,
      violations,
      warnings,
      compliance_notes: violations.length === 0
        ? 'Passed the application’s local ingredient-data screen. This is not legal certification.'
        : 'The local screen found issues. A qualified regulatory review is required.',
      review_scope: 'Local ingredient certification flags, status, and maximum-percentage data only',
      checked_at: new Date().toISOString(),
    };
  const previousIndex = request.store.complianceRecords.findIndex(item => item.formulation_id === formulation.id);
  if (previousIndex >= 0) request.store.complianceRecords[previousIndex] = compliance;
  else request.store.complianceRecords.push(compliance);
  return reply.code(201).send({ data: compliance });
});

server.get(`${apiPrefix}/regulatory/formulations/:id/compliance`, async (request, reply) => {
  if (!findAccessibleFormulation(request, request.params.id)) {
    return reply.code(404).send({ error: 'Formulation not found' });
  }
  const compliance = request.store.complianceRecords.find(item => item.formulation_id === request.params.id && isOwnedByRequest(request, item));
  if (!compliance) return reply.code(404).send({ error: 'Compliance has not been checked' });
  return { data: compliance };
});

function labelStabilityEvidence(request, formulation, requestedShelfLifeMonths) {
  return buildLabelStabilityEvidence({
    formulationVersionId: formulation.id,
    requestedShelfLifeMonths,
    programs: request.store.rdStabilityPrograms.filter(item => isOwnedByRequest(request, item)),
    observations: request.store.rdStabilityObservations.filter(item => isOwnedByRequest(request, item)),
    evidenceStorageAvailable: request.store.featureAvailability?.stability !== false,
  });
}

server.get(`${apiPrefix}/regulatory/formulations/:id/stability-evidence`, async (request, reply) => {
  const formulation = findAccessibleFormulation(request, request.params.id);
  if (!formulation) return reply.code(404).send({ error: 'Formulation not found' });
  const query = z.object({
    requested_shelf_life_months: z.coerce.number().int().positive().max(120).default(12),
  }).parse(request.query);
  return { data: labelStabilityEvidence(request, formulation, query.requested_shelf_life_months) };
});

server.post(`${apiPrefix}/regulatory/formulations/:id/labels`, async (request, reply) => {
  const formulation = findAccessibleFormulation(request, request.params.id);
  if (!formulation) {
    return reply.code(404).send({ error: 'Formulation not found' });
  }
  const options = z.object({
    market: z.enum(['algeria', 'eu', 'uk', 'us']).default('algeria'),
    language: z.enum(['ar', 'fr', 'en']).default('fr'),
    serving_size_ml: z.coerce.number().finite().positive().max(5000).default(250),
    servings_per_container: z.coerce.number().finite().positive().max(1000).default(1),
    net_volume_ml: z.coerce.number().finite().positive().max(100000).default(250),
    manufacturer_name: z.string().trim().max(200).default(''),
    manufacturer_address: z.string().trim().max(500).default(''),
    country_of_origin: z.string().trim().max(120).default('Algeria'),
    storage_instructions: z.string().trim().max(500).default('Store in a cool, dry place away from direct sunlight.'),
    shelf_life_months: z.coerce.number().int().positive().max(120).default(12),
    lot_placeholder: z.string().trim().max(80).default('LOT: ______'),
    claims: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  }).parse(request.body || {});
  
  const labelIngredients = (language) => (formulation.ingredients || [])
    .slice()
    .sort((a, b) => b.percentage - a.percentage)
    .map(fi => {
    const ing = getIngredientById(request, fi.ingredient_id);
    const localizedName = language === 'ar' ? ing?.name_ar : language === 'fr' ? ing?.name_fr : ing?.name_en;
    return { name: localizedName || ing?.name || 'Unknown', percentage: fi.percentage };
  });

  const servingFactor = options.serving_size_ml / 100;
  const nutrition = {
    calories: Number((formulation.total_calories_per_100ml || 0).toFixed(1)),
    sugar: Number((formulation.total_sugar_per_100ml || 0).toFixed(1)),
    basis: 'per 100 ml, calculated from ingredient records',
    per_serving: {
      serving_size_ml: options.serving_size_ml,
      calories: Number(((formulation.total_calories_per_100ml || 0) * servingFactor).toFixed(1)),
      sugar_g: Number(((formulation.total_sugar_per_100ml || 0) * servingFactor).toFixed(1)),
    },
    data_gaps: ['fat', 'saturates', 'carbohydrate', 'protein', 'salt/sodium'].filter(key =>
      !(formulation[`total_${key}_per_100ml`] >= 0)
    ),
  };
  const isHalal = (formulation.ingredients || []).every(fi => getIngredientById(request, fi.ingredient_id)?.halal_certified);
  const allergenPatterns = {
    milk: /milk|whey|casein|lactose|dairy/i, gluten: /wheat|barley|rye|oat|gluten|malt/i,
    soy: /soy|soya/i, egg: /egg|albumin/i, nuts: /almond|hazelnut|walnut|cashew|pistachio|nut/i,
    sulphites: /sulphite|sulfite|sulfur dioxide/i, sesame: /sesame/i, peanut: /peanut/i,
  };
  const ingredientNames = (formulation.ingredients || []).map(fi => getIngredientById(request, fi.ingredient_id)?.name || '');
  const allergens = Object.entries(allergenPatterns).filter(([, pattern]) => ingredientNames.some(name => pattern.test(name))).map(([name]) => name);
  const stabilityEvidence = labelStabilityEvidence(request, formulation, options.shelf_life_months);
  const common = {
    market: options.market, serving_size_ml: options.serving_size_ml, servings_per_container: options.servings_per_container,
    net_volume_ml: options.net_volume_ml, manufacturer: { name: options.manufacturer_name, address: options.manufacturer_address },
    country_of_origin: options.country_of_origin, storage_instructions: options.storage_instructions,
    shelf_life_months: options.shelf_life_months, lot: options.lot_placeholder, allergens,
    claims: options.claims, status: 'draft_requires_regulatory_review', stability_evidence: stabilityEvidence,
    generated_at: new Date().toISOString(),
  };
  
  const labels = {
      ar: {
        name: formulation.name,
        ingredients: labelIngredients('ar'),
        ingredient_declaration: labelIngredients('ar').map(item => item.name).join('، '), nutrition,
        halal: isHalal,
        notice: 'مسودة للمراجعة فقط — يجب التحقق من المتطلبات القانونية قبل الاستخدام.',
        ...common,
      },
      fr: {
        name: formulation.name,
        ingredients: labelIngredients('fr'),
        ingredient_declaration: labelIngredients('fr').map(item => item.name).join(', '), nutrition,
        halal: isHalal,
        notice: 'Projet à vérifier — valider les exigences légales avant utilisation.',
        ...common,
      },
      en: {
        name: formulation.name,
        ingredients: labelIngredients('en'),
        ingredient_declaration: labelIngredients('en').map(item => item.name).join(', '), nutrition,
        halal: isHalal,
        notice: 'Draft for review — verify legal requirements before use.',
        ...common,
      },
    };
  formulation.labels = labels;
  return reply.code(201).send({ data: labels });
});

server.get(`${apiPrefix}/regulatory/formulations/:id/labels`, async (request, reply) => {
  const formulation = findAccessibleFormulation(request, request.params.id);
  if (!formulation) return reply.code(404).send({ error: 'Formulation not found' });
  if (!formulation.labels) return reply.code(404).send({ error: 'Labels have not been generated' });
  const language = request.query.language;
  if (language && !['ar', 'fr', 'en'].includes(language)) {
    return reply.code(400).send({ error: 'Language must be ar, fr, or en' });
  }
  return { data: language ? formulation.labels[language] : formulation.labels };
});

// ============================================================================
// COST ROUTES
// ============================================================================

const advancedCostSchema = z.object({
  batch_size_liters: z.coerce.number().finite().positive().max(1000000),
  package_volume_ml: z.coerce.number().finite().positive().max(10000).default(1000),
  units_per_case: z.coerce.number().int().positive().max(1000).default(12),
  process_loss_percent: z.coerce.number().finite().min(0).max(50).default(2),
  ingredient_waste_percent: z.coerce.number().finite().min(0).max(50).default(1),
  packaging_cost_per_unit: z.coerce.number().finite().nonnegative().default(0),
  secondary_packaging_per_unit: z.coerce.number().finite().nonnegative().default(0),
  labor_hours: z.coerce.number().finite().nonnegative().default(0),
  labor_rate_per_hour: z.coerce.number().finite().nonnegative().default(0),
  utilities_per_liter: z.coerce.number().finite().nonnegative().default(0),
  quality_cost_per_batch: z.coerce.number().finite().nonnegative().default(0),
  sanitation_cost_per_batch: z.coerce.number().finite().nonnegative().default(0),
  logistics_per_batch: z.coerce.number().finite().nonnegative().default(0),
  warehousing_per_batch: z.coerce.number().finite().nonnegative().default(0),
  fixed_overhead_per_batch: z.coerce.number().finite().nonnegative().default(0),
  depreciation_per_batch: z.coerce.number().finite().nonnegative().default(0),
  financing_cost_per_batch: z.coerce.number().finite().nonnegative().default(0),
  marketing_per_batch: z.coerce.number().finite().nonnegative().default(0),
  sales_commission_percent: z.coerce.number().finite().min(0).max(100).default(0),
  distributor_margin_percent: z.coerce.number().finite().min(0).max(95).default(0),
  retailer_margin_percent: z.coerce.number().finite().min(0).max(95).default(0),
  tax_percent: z.coerce.number().finite().min(0).max(100).default(0),
  target_margin_percent: z.coerce.number().finite().min(0).max(95).default(30),
  selling_price_per_unit: z.coerce.number().finite().nonnegative().optional(),
  capex: z.coerce.number().finite().nonnegative().default(0),
  working_capital: z.coerce.number().finite().nonnegative().default(0),
  planned_batches_per_year: z.coerce.number().int().positive().max(100000).default(12),
  overhead_percent: z.coerce.number().finite().min(0).max(1000).optional(),
  margin_percent: z.coerce.number().finite().min(0).max(1000).optional(),
});

function calculateAdvancedCost(formulation, input) {
  const targetMarginPercent = input.margin_percent ?? input.target_margin_percent;
  const saleableLiters = input.batch_size_liters * (1 - input.process_loss_percent / 100);
  const saleableUnits = Math.max(1, Math.floor((saleableLiters * 1000) / input.package_volume_ml));
  const ingredientCost = (formulation.total_cost_per_liter || 0) * input.batch_size_liters * (1 + input.ingredient_waste_percent / 100);
  const packagingCost = saleableUnits * (input.packaging_cost_per_unit + input.secondary_packaging_per_unit);
  const laborCost = input.labor_hours * input.labor_rate_per_hour;
  const utilitiesCost = input.utilities_per_liter * input.batch_size_liters;
  const variableProductionCost = ingredientCost + packagingCost + laborCost + utilitiesCost;
  const legacyOverhead = variableProductionCost * ((input.overhead_percent || 0) / 100);
  const batchFixedCost = input.quality_cost_per_batch + input.sanitation_cost_per_batch + input.logistics_per_batch
    + input.warehousing_per_batch + input.fixed_overhead_per_batch + input.depreciation_per_batch
    + input.financing_cost_per_batch + input.marketing_per_batch + legacyOverhead;
  const manufacturingCost = variableProductionCost + batchFixedCost;
  const costPerUnit = manufacturingCost / saleableUnits;
  const unitVolumeLiters = input.package_volume_ml / 1000;
  const costPerLiter = manufacturingCost / saleableLiters;
  const exFactoryTarget = costPerUnit / Math.max(0.05, 1 - targetMarginPercent / 100);
  const channelFactor = Math.max(0.01, (1 - input.distributor_margin_percent / 100) * (1 - input.retailer_margin_percent / 100));
  const suggestedRetailPrice = (exFactoryTarget / channelFactor) * (1 + input.tax_percent / 100);
  const sellingPrice = input.selling_price_per_unit ?? exFactoryTarget;
  const grossRevenue = sellingPrice * saleableUnits;
  const commission = grossRevenue * (input.sales_commission_percent / 100);
  const contribution = grossRevenue - manufacturingCost - commission;
  const contributionPerUnit = contribution / saleableUnits;
  const initialInvestment = input.capex + input.working_capital;
  const annualContribution = contribution * input.planned_batches_per_year;
  return {
    assumptions: { ...input, target_margin_percent: targetMarginPercent },
    production: {
      input_liters: input.batch_size_liters, saleable_liters: saleableLiters, saleable_units: saleableUnits,
      saleable_cases: saleableUnits / input.units_per_case, yield_percent: 100 - input.process_loss_percent,
    },
    breakdown: {
      ingredient_cost: ingredientCost, packaging_cost: packagingCost, labor_cost: laborCost,
      utilities_cost: utilitiesCost, quality_cost: input.quality_cost_per_batch,
      sanitation_cost: input.sanitation_cost_per_batch, logistics_cost: input.logistics_per_batch,
      warehousing_cost: input.warehousing_per_batch, fixed_overhead: input.fixed_overhead_per_batch + legacyOverhead,
      depreciation: input.depreciation_per_batch, financing_cost: input.financing_cost_per_batch,
      marketing_cost: input.marketing_per_batch, manufacturing_cost: manufacturingCost,
      sales_commission: commission, total_cost: manufacturingCost + commission,
      margin: contribution, final_price: grossRevenue, estimated_revenue: grossRevenue,
      estimated_profit: contribution, roi_percent: input.margin_percent ?? (manufacturingCost === 0 ? 0 : (contribution / manufacturingCost) * 100),
    },
    unit_economics: {
      cost_per_liter: costPerLiter, cost_per_unit: costPerUnit, cost_per_case: costPerUnit * input.units_per_case,
      target_ex_factory_price: exFactoryTarget, suggested_retail_price: suggestedRetailPrice,
      selling_price_per_unit: sellingPrice, contribution_per_unit: contributionPerUnit,
      gross_margin_percent: grossRevenue === 0 ? 0 : (contribution / grossRevenue) * 100,
    },
    investment: {
      initial_investment: initialInvestment, annual_contribution: annualContribution,
      annual_roi_percent: initialInvestment === 0 ? null : (annualContribution / initialInvestment) * 100,
      payback_months: annualContribution <= 0 || initialInvestment === 0 ? null : (initialInvestment / annualContribution) * 12,
      break_even_units: contributionPerUnit <= 0 ? null : Math.ceil(initialInvestment / contributionPerUnit),
      break_even_batches: contribution <= 0 ? null : initialInvestment / contribution,
    },
  };
}

server.post(`${apiPrefix}/cost/formulations/:id/batch-cost`, async (request, reply) => {
  const { id } = request.params;
  const input = advancedCostSchema.parse(request.body);
  
  const formulation = findAccessibleFormulation(request, id);
  if (!formulation) {
    return reply.code(404).send({ error: 'Formulation not found' });
  }
  
  const analysis = calculateAdvancedCost(formulation, input);
  const calculation = {
      id: generateId(),
      owner_id: request.user?.id,
      formulation_id: id,
      batch_size_liters: input.batch_size_liters,
      ...analysis,
      per_liter: {
        ingredient_cost: analysis.breakdown.ingredient_cost / input.batch_size_liters,
        total_cost: analysis.unit_economics.cost_per_liter,
        final_price: analysis.unit_economics.target_ex_factory_price / (input.package_volume_ml / 1000),
      },
      calculated_at: new Date().toISOString(),
    };
  request.store.batchCostCalculations.push(calculation);
  return reply.code(201).send({ data: calculation });
});

server.get(`${apiPrefix}/cost/formulations/:id/batch-costs`, async (request, reply) => {
  if (!findAccessibleFormulation(request, request.params.id)) {
    return reply.code(404).send({ error: 'Formulation not found' });
  }
  const { limit, offset } = paginationSchema.extend({ limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(request.query);
  const filtered = request.store.batchCostCalculations.filter(item => item.formulation_id === request.params.id && isOwnedByRequest(request, item));
  return {
    data: filtered.slice(offset, offset + limit),
    pagination: { total: filtered.length, limit, offset, has_more: offset + limit < filtered.length },
  };
});

server.get(`${apiPrefix}/cost/formulations/:id/compare-batch-sizes`, async (request, reply) => {
  const { id } = request.params;
  const formulation = findAccessibleFormulation(request, id);
  if (!formulation) {
    return reply.code(404).send({ error: 'Formulation not found' });
  }
  
  const sizes = request.query.sizes
    ? request.query.sizes.split(',').map(value => z.coerce.number().finite().positive().max(1000000).parse(value))
    : [1, 10, 100, 1000, 10000];
  const baseCost = formulation.total_cost_per_liter || 0;
  
  return {
    data: sizes.map(size => ({
      batch_size_liters: size,
      cost_per_liter: baseCost,
      total_cost: baseCost * size,
      final_price_per_liter: baseCost * 1.5,
      roi_percent: baseCost === 0 ? 0 : 50,
      assumption: 'Ingredient unit prices are constant because no quantity-tier supplier prices are configured.',
    })),
  };
});

server.post(`${apiPrefix}/cost/formulations/:id/roi`, async (request, reply) => {
  const formulation = findAccessibleFormulation(request, request.params.id);
  if (!formulation) return reply.code(404).send({ error: 'Formulation not found' });
  const legacy = z.object({ selling_price_per_liter: z.coerce.number().finite().nonnegative().optional() }).passthrough().parse(request.body);
  const packageVolume = Number(legacy.package_volume_ml || 1000);
  const normalized = { process_loss_percent: 0, ingredient_waste_percent: 0, ...legacy, selling_price_per_unit: legacy.selling_price_per_unit ?? ((legacy.selling_price_per_liter || 0) * packageVolume / 1000), package_volume_ml: packageVolume };
  const input = advancedCostSchema.parse(normalized);
  const analysis = calculateAdvancedCost(formulation, input);
  return { data: {
    ...analysis,
    batch_size_liters: input.batch_size_liters,
    cost_per_liter: analysis.unit_economics.cost_per_liter,
    selling_price_per_liter: legacy.selling_price_per_liter ?? (analysis.unit_economics.selling_price_per_unit / (packageVolume / 1000)),
    total_cost: analysis.breakdown.total_cost,
    total_revenue: analysis.breakdown.estimated_revenue,
    profit: analysis.breakdown.estimated_profit,
    estimated_revenue: analysis.breakdown.estimated_revenue,
    estimated_profit: analysis.breakdown.estimated_profit,
    roi_percent: analysis.breakdown.roi_percent,
    break_even_price: analysis.unit_economics.cost_per_liter,
  } };
});

server.post(`${apiPrefix}/cost/ingredients/:ingredientId/pricing`, async (request, reply) => {
  const ingredient = getIngredientById(request, request.params.ingredientId);
  if (!ingredient) return reply.code(404).send({ error: 'Ingredient not found' });
  const input = z.object({
    price_per_kg: z.coerce.number().finite().nonnegative(),
    currency: z.string().trim().length(3).default('DZD'),
    effective_date: z.coerce.date().default(() => new Date()),
  }).parse(request.body);
  const record = { id: generateId(), ingredient_id: request.params.ingredientId, created_by: request.user?.id, ...input, effective_date: input.effective_date.toISOString() };
  request.store.pricingHistory.push(record);
  let recalculated_formulations = 0;
  if (input.effective_date <= new Date()) {
    ingredient.base_price_per_kg = input.price_per_kg;
    ingredient.price_per_kg = input.price_per_kg;
    ingredient.currency = input.currency;
    ingredient.updated_at = new Date().toISOString();
    for (const formulation of request.store.formulations.filter(item =>
      (item.ingredients || []).some(formulationIngredient => formulationIngredient.ingredient_id === ingredient.id)
    )) {
      Object.assign(formulation, processFormulationIngredients(request, formulation.ingredients), { updated_at: new Date().toISOString() });
      recalculated_formulations += 1;
    }
  }
  return reply.code(201).send({ data: record, recalculated_formulations });
});

server.get(`${apiPrefix}/cost/ingredients/:ingredientId/pricing`, async (request, reply) => {
  if (!getIngredientById(request, request.params.ingredientId)) return reply.code(404).send({ error: 'Ingredient not found' });
  const { limit, offset } = paginationSchema.parse(request.query);
  const filtered = request.store.pricingHistory.filter(item => item.ingredient_id === request.params.ingredientId);
  return { data: filtered.slice(offset, offset + limit), pagination: { total: filtered.length, limit, offset, has_more: offset + limit < filtered.length } };
});

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const frontendDistribution = path.resolve(moduleDirectory, '../../frontend/dist');
const serveFrontend = process.env.SERVE_FRONTEND === 'true' || (production && process.env.SERVE_FRONTEND !== 'false');

if (serveFrontend) {
  await server.register(fastifyStatic, {
    root: frontendDistribution,
    prefix: '/',
    wildcard: false,
    index: false,
  });
  server.setNotFoundHandler((request, reply) => {
    const pathname = request.url.split('?')[0];
    if (request.method === 'GET' && !pathname.startsWith('/api/') && request.headers.accept?.includes('text/html')) {
      return reply.header('cache-control', 'no-store').sendFile('index.html');
    }
    return reply.code(404).send({ error: 'Not found' });
  });
}

export default server;

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) {
  const port = Number.parseInt(process.env.PORT || '3001', 10);
  const host = process.env.HOST || '127.0.0.1';
  try {
    await server.listen({ port, host });
    server.log.info({ host, port, version: applicationVersion, storage_mode: getStorageConfiguration().mode }, 'BeverageAI DZ started');

    let shuttingDown = false;
    const shutdown = async (signal) => {
      if (shuttingDown) return;
      shuttingDown = true;
      server.log.info({ signal }, 'Graceful shutdown started');
      const forcedExit = setTimeout(() => {
        server.log.fatal({ signal }, 'Graceful shutdown timed out');
        process.exit(1);
      }, 10000);
      forcedExit.unref();
      await server.close();
      clearTimeout(forcedExit);
      process.exit(0);
    };
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
    process.once('SIGINT', () => void shutdown('SIGINT'));
  } catch (error) {
    server.log.error(error);
    process.exit(1);
  }
}
