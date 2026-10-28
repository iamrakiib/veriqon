'use client';

import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

type Theme = 'light' | 'dark' | 'system';
type ThemeContextValue = { preference: Theme; resolved: 'light' | 'dark'; ready: boolean; setTheme: (theme: Theme) => void };
const ThemeContext = createContext<ThemeContextValue | null>(null);
const storageKey = 'veriqon-theme';

function readPreference(): Theme {
  try {
    const value = localStorage.getItem(storageKey);
    if (value === 'light' || value === 'system') return value;
  } catch { /* Storage may be unavailable in private or restricted browsers. */ }
  return 'dark';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<Theme>('dark');
  const [resolved, setResolved] = useState<'light' | 'dark'>('dark');
  const [ready, setReady] = useState(false);
  const currentPreference = useRef<Theme>('dark');

  function apply(theme: Theme) {
    currentPreference.current = theme;
    const next = theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    setPreference(theme);
    setResolved(next);
  }

  useLayoutEffect(() => {
    apply(readPreference());
    setReady(true);
    const media = matchMedia('(prefers-color-scheme: dark)');
    const onSystemChange = () => { if (currentPreference.current === 'system') apply('system'); };
    const onStorage = (event: StorageEvent) => { if (event.key === storageKey || event.key === null) apply(readPreference()); };
    media.addEventListener('change', onSystemChange);
    window.addEventListener('storage', onStorage);
    return () => { media.removeEventListener('change', onSystemChange); window.removeEventListener('storage', onStorage); };
  }, []);

  function setTheme(theme: Theme) {
    try { localStorage.setItem(storageKey, theme); } catch { /* The selection still works for this page. */ }
    apply(theme);
  }

  return <ThemeContext.Provider value={{ preference, resolved, ready, setTheme }}>{children}</ThemeContext.Provider>;
}

function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('Theme controls require ThemeProvider');
  return value;
}

export function ThemeToggle() {
  const { resolved, ready, setTheme } = useTheme();
  const label = resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  return <button className="icon-button theme-toggle" disabled={!ready} aria-label={label} title={label} onClick={() => setTheme(resolved === 'dark' ? 'light' : 'dark')}>{resolved === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>;
}

export function ThemeSettings() {
  const { preference, ready, setTheme } = useTheme();
  return <fieldset className="theme-settings"><legend>Appearance</legend><p>Choose how Veriqon looks on this device.</p><div className="theme-options">{([{ value: 'light', label: 'Light', icon: Sun }, { value: 'dark', label: 'Dark', icon: Moon }, { value: 'system', label: 'System', icon: Monitor }] as const).map(option => <label className="theme-option" key={option.value}><input type="radio" name="appearance" value={option.value} checked={preference === option.value} disabled={!ready} onChange={() => setTheme(option.value)} /><option.icon size={18} /><span>{option.label}</span></label>)}</div></fieldset>;
}
