import { getStorageConfiguration } from '../data/persistentStore.js';
import { getSupabaseAdmin } from './supabaseClient.js';

const DEFAULT_DAILY_LIMIT = 25;
const DEFAULT_MONTHLY_LIMIT = 250;
const localPreferences = new Map();
const localUsage = [];
const ownerLocks = new Map();

export class AIQuotaError extends Error {
  constructor(code) {
    super(code === 'AI_DAILY_QUOTA_EXCEEDED'
      ? 'Daily external AI quota reached'
      : code === 'AI_MONTHLY_QUOTA_EXCEEDED'
        ? 'Monthly external AI quota reached'
        : 'External AI quota could not be reserved');
    this.name = 'AIQuotaError';
    this.code = code;
  }
}

function positiveLimit(name, fallback) {
  const value = Number.parseInt(process.env[name] || `${fallback}`, 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function getAIQuotaConfiguration() {
  return {
    daily_limit: positiveLimit('AI_DAILY_REQUEST_LIMIT', DEFAULT_DAILY_LIMIT),
    monthly_limit: positiveLimit('AI_MONTHLY_REQUEST_LIMIT', DEFAULT_MONTHLY_LIMIT),
  };
}

function defaultPreferences() {
  return { external_processing_enabled: false, include_formulation_name: false };
}

function periodBoundaries(now = new Date()) {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const dayReset = new Date(dayStart); dayReset.setUTCDate(dayReset.getUTCDate() + 1);
  const monthReset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { dayStart, monthStart, dayReset, monthReset };
}

function ownerKey(ownerId) {
  return ownerId || 'local-development';
}

export async function getAIPreferences(ownerId) {
  const key = ownerKey(ownerId);
  if (getStorageConfiguration().mode !== 'supabase') {
    return { ...defaultPreferences(), ...(localPreferences.get(key) || {}) };
  }
  const client = getSupabaseAdmin();
  const { data, error } = await client.from('ai_preferences')
    .select('external_processing_enabled,include_formulation_name,updated_at')
    .eq('owner_id', ownerId).maybeSingle();
  if (error) throw error;
  if (data) return data;
  const { data: created, error: createError } = await client.from('ai_preferences')
    .upsert({ owner_id: ownerId, ...defaultPreferences() }, { onConflict: 'owner_id' })
    .select('external_processing_enabled,include_formulation_name,updated_at').single();
  if (createError) throw createError;
  return created;
}

export async function updateAIPreferences(ownerId, preferences) {
  const key = ownerKey(ownerId);
  const value = { ...defaultPreferences(), ...preferences, updated_at: new Date().toISOString() };
  if (getStorageConfiguration().mode !== 'supabase') {
    localPreferences.set(key, value);
    return value;
  }
  const { data, error } = await getSupabaseAdmin().from('ai_preferences')
    .upsert({ owner_id: ownerId, ...value }, { onConflict: 'owner_id' })
    .select('external_processing_enabled,include_formulation_name,updated_at').single();
  if (error) throw error;
  return data;
}

export async function getAIQuotaStatus(ownerId, now = new Date()) {
  const limits = getAIQuotaConfiguration();
  const { dayStart, monthStart, dayReset, monthReset } = periodBoundaries(now);
  let dailyUsed;
  let monthlyUsed;
  if (getStorageConfiguration().mode !== 'supabase') {
    const owned = localUsage.filter(event => event.owner_id === ownerKey(ownerId));
    dailyUsed = owned.filter(event => event.created_at >= dayStart).length;
    monthlyUsed = owned.filter(event => event.created_at >= monthStart).length;
  } else {
    const client = getSupabaseAdmin();
    const [daily, monthly] = await Promise.all([
      client.from('ai_usage_events').select('id', { head: true, count: 'exact' })
        .eq('owner_id', ownerId).gte('created_at', dayStart.toISOString()),
      client.from('ai_usage_events').select('id', { head: true, count: 'exact' })
        .eq('owner_id', ownerId).gte('created_at', monthStart.toISOString()),
    ]);
    if (daily.error) throw daily.error;
    if (monthly.error) throw monthly.error;
    dailyUsed = daily.count || 0;
    monthlyUsed = monthly.count || 0;
  }
  return {
    ...limits,
    daily_used: dailyUsed,
    daily_remaining: Math.max(0, limits.daily_limit - dailyUsed),
    daily_resets_at: dayReset.toISOString(),
    monthly_used: monthlyUsed,
    monthly_remaining: Math.max(0, limits.monthly_limit - monthlyUsed),
    monthly_resets_at: monthReset.toISOString(),
  };
}

async function withOwnerLock(ownerId, operation) {
  const previous = ownerLocks.get(ownerId) || Promise.resolve();
  let release;
  const current = new Promise(resolve => { release = resolve; });
  const queued = previous.then(() => current);
  ownerLocks.set(ownerId, queued);
  await previous;
  try { return await operation(); } finally { release(); if (ownerLocks.get(ownerId) === queued) ownerLocks.delete(ownerId); }
}

function quotaCode(error) {
  const message = error?.message || error?.details || '';
  if (message.includes('AI_DAILY_QUOTA_EXCEEDED')) return 'AI_DAILY_QUOTA_EXCEEDED';
  if (message.includes('AI_MONTHLY_QUOTA_EXCEEDED')) return 'AI_MONTHLY_QUOTA_EXCEEDED';
  if (message.includes('AI_REQUEST_ALREADY_RESERVED')) return 'AI_REQUEST_ALREADY_RESERVED';
  return null;
}

export async function reserveAIQuota({ ownerId, requestId, operation, provider, model }) {
  const limits = getAIQuotaConfiguration();
  const key = ownerKey(ownerId);
  if (getStorageConfiguration().mode !== 'supabase') {
    return withOwnerLock(key, async () => {
      const status = await getAIQuotaStatus(ownerId);
      if (status.daily_remaining < 1) throw new AIQuotaError('AI_DAILY_QUOTA_EXCEEDED');
      if (status.monthly_remaining < 1) throw new AIQuotaError('AI_MONTHLY_QUOTA_EXCEEDED');
      if (localUsage.some(event => event.owner_id === key && event.request_id === requestId)) {
        throw new AIQuotaError('AI_REQUEST_ALREADY_RESERVED');
      }
      const event = {
        id: localUsage.length + 1, owner_id: key, request_id: requestId,
        operation, provider, model, outcome: 'reserved', created_at: new Date(),
      };
      localUsage.push(event);
      return { event_id: event.id, daily_used: status.daily_used + 1, monthly_used: status.monthly_used + 1 };
    });
  }
  const { data, error } = await getSupabaseAdmin().rpc('reserve_ai_quota', {
    p_owner_id: ownerId,
    p_request_id: requestId,
    p_operation: operation,
    p_provider: provider,
    p_model: model,
    p_daily_limit: limits.daily_limit,
    p_monthly_limit: limits.monthly_limit,
  });
  if (error) {
    const code = quotaCode(error);
    if (code) throw new AIQuotaError(code);
    throw error;
  }
  return Array.isArray(data) ? data[0] : data;
}

export async function completeAIUsage({ ownerId, eventId, outcome, usage = {} }) {
  if (!eventId) return;
  if (getStorageConfiguration().mode !== 'supabase') {
    const event = localUsage.find(item => item.id === eventId && item.owner_id === ownerKey(ownerId));
    if (event) Object.assign(event, { outcome, ...usage, completed_at: new Date() });
    return;
  }
  const { error } = await getSupabaseAdmin().rpc('complete_ai_usage', {
    p_owner_id: ownerId,
    p_event_id: eventId,
    p_outcome: outcome,
    p_prompt_tokens: usage.prompt_tokens ?? null,
    p_candidate_tokens: usage.candidate_tokens ?? null,
    p_total_tokens: usage.total_tokens ?? null,
  });
  if (error) throw error;
}

export function resetAIGovernanceForTests() {
  localPreferences.clear();
  localUsage.splice(0, localUsage.length);
  ownerLocks.clear();
}
