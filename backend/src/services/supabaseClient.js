import { createClient } from '@supabase/supabase-js';

let adminClient;

export function isSupabaseConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
}

export function getSupabaseAdmin() {
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required for Supabase mode');
  }
  if (!adminClient) {
    adminClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { 'X-Client-Info': 'beverageai-backend/1.0' } },
    });
  }
  return adminClient;
}

export async function verifySupabaseAccessToken(accessToken) {
  const { data, error } = await getSupabaseAdmin().auth.getUser(accessToken);
  if (error || !data.user) return null;
  return data.user;
}

export async function ensureUserProfile(user) {
  const displayName = user.user_metadata?.display_name || user.user_metadata?.full_name || null;
  const { error } = await getSupabaseAdmin().from('profiles').upsert({
    id: user.id,
    display_name: displayName,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' });
  if (error) throw error;
}

export async function recordAuditEvent({ ownerId, action, entityType, entityId, metadata }) {
  const { error } = await getSupabaseAdmin().from('audit_logs').insert({
    owner_id: ownerId || null,
    action,
    entity_type: entityType,
    entity_id: entityId || null,
    metadata: metadata || {},
  });
  if (error) throw error;
}
