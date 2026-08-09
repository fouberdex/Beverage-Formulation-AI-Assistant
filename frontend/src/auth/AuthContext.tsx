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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AppProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [recoveryMode, setRecoveryMode] = useState(false);

  useEffect(() => {
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

  async function refreshProfile() {
    if (!session) {
      setProfile(null);
      return;
    }
    const response = await accountAPI.getMe();
    setProfile(response.data.data);
  }

  useEffect(() => {
    if (!session) return;
    void refreshProfile().catch(error => console.error('Unable to load account profile:', error));
  }, [session?.access_token]);

  const value = useMemo<AuthContextValue>(() => ({
    session,
    profile,
    loading,
    recoveryMode,
    async signIn(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    async signUp(email, password, displayName) {
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
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    },
    async resetPassword(email) {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/account`,
      });
      if (error) throw error;
    },
    async updatePassword(password) {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setRecoveryMode(false);
    },
    async updateDisplayName(displayName) {
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
