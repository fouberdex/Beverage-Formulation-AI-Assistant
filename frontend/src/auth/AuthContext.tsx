import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../services/supabase';
import { accountAPI } from '../services/api';

export type AppProfile = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: 'admin' | 'formulator' | 'viewer';
};

type AuthContextValue = {
  session: Session | null;
  profile: AppProfile | null;
  loading: boolean;
  recoveryMode: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  updateDisplayName: (displayName: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const e2eMode = import.meta.env.MODE === 'e2e';

function e2eIdentity() {
  const role = (window.localStorage.getItem('e2e-role') || 'viewer') as AppProfile['role'];
  const user = { id: `e2e-${role}`, email: `${role}@example.test`, user_metadata: {} };
  return {
    session: { access_token: 'e2e-token', refresh_token: 'e2e-refresh', expires_in: 3600, token_type: 'bearer', user } as Session,
    profile: { id: user.id, email: user.email, display_name: `E2E ${role}`, role } as AppProfile,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const identity = e2eMode ? e2eIdentity() : null;
  const [session, setSession] = useState<Session | null>(identity?.session ?? null);
  const [profile, setProfile] = useState<AppProfile | null>(identity?.profile ?? null);
  const [loading, setLoading] = useState(!e2eMode);
  const [recoveryMode, setRecoveryMode] = useState(false);

  useEffect(() => {
    if (e2eMode) return;
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) console.error('Unable to restore Supabase session:', error.message);
      setSession(data.session);
      setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true);
      if (event === 'SIGNED_OUT') setProfile(null);
      setLoading(false);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const expireSession = () => {
      if (e2eMode) { setSession(null); setProfile(null); return; }
      void supabase.auth.signOut({ scope: 'local' });
    };
    window.addEventListener('beverageai:unauthorized', expireSession);
    return () => window.removeEventListener('beverageai:unauthorized', expireSession);
  }, []);

  async function refreshProfile() {
    if (!session) {
      setProfile(null);
      return;
    }
    const response = await accountAPI.getMe();
    setProfile(response.data.data);
  }

  useEffect(() => {
    if (e2eMode) return;
    if (!session) { setProfile(null); return; }
    setLoading(true);
    void refreshProfile()
      .catch(error => console.error('Unable to load account profile:', error))
      .finally(() => setLoading(false));
  }, [session?.access_token]);

  const value = useMemo<AuthContextValue>(() => ({
    session,
    profile,
    loading,
    recoveryMode,
    async signIn(email, password) {
      if (e2eMode) { const next = e2eIdentity(); setSession(next.session); setProfile(next.profile); return; }
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    async signUp(email, password, displayName) {
      if (e2eMode) { const next = e2eIdentity(); setSession(next.session); setProfile(next.profile); return true; }
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: displayName },
          emailRedirectTo: window.location.origin,
        },
      });
      if (error) throw error;
      return Boolean(data.session);
    },
    async signOut() {
      if (e2eMode) { setSession(null); setProfile(null); return; }
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    },
    async resetPassword(email) {
      if (e2eMode) return;
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/account`,
      });
      if (error) throw error;
    },
    async updatePassword(password) {
      if (e2eMode) { setRecoveryMode(false); return; }
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setRecoveryMode(false);
    },
    async updateDisplayName(displayName) {
      if (e2eMode) { setProfile(current => current ? { ...current, display_name: displayName } : current); return; }
      const response = await accountAPI.updateProfile(displayName);
      setProfile(current => current ? { ...current, ...response.data.data } : response.data.data);
      const { error } = await supabase.auth.updateUser({ data: { display_name: displayName } });
      if (error) throw error;
    },
    refreshProfile,
  }), [session, profile, loading, recoveryMode]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
