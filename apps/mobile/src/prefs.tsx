import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Language, Theme } from '@uzbite/shared';
import { en, ru, uz, type TextKey } from './i18n/strings';
import { asAppError } from './api/client';

/** UzBite palette (accent #f8781d). Muted/accent text colours keep readable contrast on both themes. */
export const palettes = {
  light: {
    bg: '#FFFFFF', surface: '#FFFFFF', surfaceAlt: '#F5F5F2', text: '#242521', muted: '#6B6C66', border: '#E8E8E8',
    accent: '#F8781D', accentSoft: '#FFF3EA', accentText: '#B9530A', onAccent: '#FFFFFF',
    success: '#1F8A4C', successSoft: '#E7F6EC', danger: '#C93C3C', dangerSoft: '#FDECEC', warning: '#9A5A00', warningSoft: '#FFF4E0',
  },
  dark: {
    bg: '#111310', surface: '#1B1E19', surfaceAlt: '#242820', text: '#F3F5EE', muted: '#A3A99A', border: '#31372C',
    accent: '#F8781D', accentSoft: '#3A241A', accentText: '#FF9A4D', onAccent: '#FFFFFF',
    success: '#4CC27E', successSoft: '#183324', danger: '#F07070', dangerSoft: '#3A1C1C', warning: '#E7A94A', warningSoft: '#3A2C14',
  },
};
export type Palette = typeof palettes.light;

const dictionaries: Record<Language, Record<TextKey, string>> = { ru, uz, en };
const STORAGE_KEY = 'uzbite.courier.prefs';
type Params = Record<string, string | number>;
type Prefs = {
  ready: boolean; language: Language; theme: Theme; colors: Palette;
  setLanguage: (language: Language) => void; setTheme: (theme: Theme) => void;
  t: (key: TextKey, params?: Params) => string;
  /** A message for any failure: known server codes are translated, unknown ones never show raw internals. */
  errorText: (error: unknown) => string;
};
const PrefsContext = createContext<Prefs | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ ready: boolean; language: Language; theme: Theme }>({ ready: false, language: 'ru', theme: 'light' });
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then(raw => { const saved = raw ? JSON.parse(raw) as Partial<{ language: Language; theme: Theme }> : {}; setState({ ready: true, language: saved.language ?? 'ru', theme: saved.theme ?? 'light' }); })
      .catch(() => setState(previous => ({ ...previous, ready: true })));
  }, []);
  const persist = useCallback((next: { language: Language; theme: Theme }) => { AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {}); }, []);
  const setLanguage = useCallback((language: Language) => setState(previous => { const next = { ...previous, language }; persist(next); return next; }), [persist]);
  const setTheme = useCallback((theme: Theme) => setState(previous => { const next = { ...previous, theme }; persist(next); return next; }), [persist]);
  const value = useMemo<Prefs>(() => {
    const dictionary = dictionaries[state.language];
    const t = (key: TextKey, params?: Params) => {
      let text = dictionary[key] ?? ru[key] ?? key;
      if (params) for (const [name, item] of Object.entries(params)) text = text.split(`{${name}}`).join(String(item));
      return text;
    };
    const errorText = (error: unknown) => {
      const failure = asAppError(error);
      const key = `err${failure.code}` as TextKey;
      if (key in dictionary) return dictionary[key];
      // Server messages are written in Russian; other languages get a neutral message instead.
      if (state.language === 'ru' && failure.message && failure.status && failure.status < 500) return failure.message;
      return dictionary.genericError;
    };
    return { ...state, colors: palettes[state.theme], setLanguage, setTheme, t, errorText };
  }, [state, setLanguage, setTheme]);
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}
export function usePrefs() {
  const value = useContext(PrefsContext);
  if (!value) throw new Error('usePrefs outside PrefsProvider');
  return value;
}
