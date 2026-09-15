import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
type ThemeContextValue = { preference: ThemePreference; resolved: 'light' | 'dark'; setPreference: (value: ThemePreference) => void };
const STORAGE_KEY = 'beverageai-theme';
const ThemeContext = createContext<ThemeContextValue | null>(null);

export function resolveTheme(preference: ThemePreference, systemDark: boolean): 'light' | 'dark' { return preference === 'system' ? (systemDark ? 'dark' : 'light') : preference; }
function storedPreference(): ThemePreference { const value = localStorage.getItem(STORAGE_KEY); return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'; }

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(storedPreference);
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  const resolved = resolveTheme(preference, systemDark);
  useEffect(() => { const media = matchMedia('(prefers-color-scheme: dark)'); const update = () => setSystemDark(media.matches); media.addEventListener('change', update); return () => media.removeEventListener('change', update); }, []);
  useEffect(() => { document.documentElement.dataset.theme = resolved; document.documentElement.style.colorScheme = resolved; }, [resolved]);
  const value = useMemo(() => ({ preference, resolved, setPreference: (next: ThemePreference) => { localStorage.setItem(STORAGE_KEY, next); setPreferenceState(next); } }), [preference, resolved]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() { const context = useContext(ThemeContext); if (!context) throw new Error('useTheme must be used within ThemeProvider'); return context; }
