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
  const { data, error } = await getSupabaseAdmin().rpc('ensure_profile', {
    p_user_id: user.id,
    p_display_name: displayName,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function getUserProfile(userId) {
  const { data, error } = await getSupabaseAdmin()
    .from('profiles')
    .select('id,display_name,role,created_at,updated_at')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
}

export async function updateUserProfile(userId, displayName) {
  const { data, error } = await getSupabaseAdmin()
    .from('profiles')
    .update({ display_name: displayName, updated_at: new Date().toISOString() })
    .eq('id', userId)
    .select('id,display_name,role,created_at,updated_at')
    .single();
  if (error) throw error;
  return data;
}

export async function checkSupabaseHealth() {
  const { error } = await getSupabaseAdmin().from('ingredients').select('id', { head: true, count: 'exact' });
  if (error) throw error;
  return true;
}

export async function listAuditEvents({ ownerId, includeAll = false, limit = 100, offset = 0 }) {
  let query = getSupabaseAdmin()
    .from('audit_logs')
    .select('id,owner_id,action,entity_type,entity_id,metadata,created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (!includeAll) query = query.eq('owner_id', ownerId);
  const { data, error, count } = await query;
  if (error) throw error;
  return { data, total: count || 0 };
}

export async function listUserAccounts() {
  const [{ data: profileRows, error: profileError }, { data: authData, error: authError }] = await Promise.all([
    getSupabaseAdmin().from('profiles').select('id,display_name,role,created_at,updated_at').order('created_at'),
    getSupabaseAdmin().auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);
  if (profileError) throw profileError;
  if (authError) throw authError;
  const emailById = new Map(authData.users.map(user => [user.id, user.email || null]));
  return profileRows.map(profile => ({ ...profile, email: emailById.get(profile.id) || null }));
}

export async function updateUserRole(userId, role) {
  const { data: target, error: targetError } = await getSupabaseAdmin()
    .from('profiles').select('id,role').eq('id', userId).single();
  if (targetError) throw targetError;
  if (target.role === 'admin' && role !== 'admin') {
    const { count, error: countError } = await getSupabaseAdmin()
      .from('profiles').select('id', { head: true, count: 'exact' }).eq('role', 'admin');
    if (countError) throw countError;
    if ((count || 0) <= 1) {
      const error = new Error('The last administrator cannot be demoted');
      error.statusCode = 409;
      throw error;
    }
  }
  const { data, error } = await getSupabaseAdmin()
    .from('profiles')
    .update({ role, updated_at: new Date().toISOString() })
    .eq('id', userId)
    .select('id,display_name,role,created_at,updated_at')
    .single();
  if (error) throw error;
  return data;
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
