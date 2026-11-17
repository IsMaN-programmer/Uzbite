import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CourierAccount } from '@uzbite/shared';
import { loadServerConfig } from './config';
import { asAppError, onSessionExpired, revokeOnServer, setTokens } from './api/client';
import { loadTokens } from './api/tokens';
import { courierApi, type RegisterInput } from './api/courier';
import { usePrefs } from './prefs';

/** starting → signedOut | signedIn, or unreachable when the server cannot be asked at start-up. */
type Status = 'starting' | 'unreachable' | 'signedOut' | 'signedIn';
type Session = {
  status: Status; startupError: unknown; expired: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  register: (input: Omit<RegisterInput, 'language' | 'theme'>) => Promise<void>;
  signOut: () => Promise<void>;
  restart: () => void; dismissExpired: () => void;
};
const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { language, theme, ready } = usePrefs();
  const [status, setStatus] = useState<Status>('starting');
  const [startupError, setStartupError] = useState<unknown>(null);
  const [expired, setExpired] = useState(false);

  const enter = useCallback(async (account: CourierAccount) => {
    queryClient.setQueryData(['me'], account);
    setExpired(false);
    setStatus('signedIn');
  }, [queryClient]);

  const start = useCallback(async () => {
    setStatus('starting'); setStartupError(null);
    try { await loadServerConfig(); } catch (error) { setStartupError(error); setStatus('unreachable'); return; }
    const saved = await loadTokens();
    if (!saved) { setStatus('signedOut'); return; }
    await setTokens(saved);
    try { await enter(await courierApi.me()); }
    catch (error) {
      const failure = asAppError(error);
      if (failure.status === 401 || failure.status === 403) { await setTokens(null); setStatus('signedOut'); }
      else { setStartupError(error); setStatus('unreachable'); }
    }
  }, [enter]);

  useEffect(() => { if (ready) void start(); }, [ready, start]);
  useEffect(() => onSessionExpired(() => { queryClient.clear(); setExpired(true); setStatus('signedOut'); }), [queryClient]);

  const value = useMemo<Session>(() => ({
    status, startupError, expired,
    signIn: async (email, password) => {
      const result = await courierApi.login(email.trim(), password);
      await setTokens(result.tokens);
      await enter(result.account);
    },
    register: async input => {
      const result = await courierApi.register({ ...input, language, theme });
      await setTokens(result.tokens);
      await enter(result.account);
    },
    signOut: async () => {
      await revokeOnServer();
      await setTokens(null);
      queryClient.clear();
      setStatus('signedOut');
    },
    restart: () => { void start(); },
    dismissExpired: () => setExpired(false),
  }), [status, startupError, expired, enter, language, theme, queryClient, start]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession outside SessionProvider');
  return value;
}
