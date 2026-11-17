import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import type { AuthTokens } from '@uzbite/shared';
import { serverConfig } from '../config';
import { storeTokens } from './tokens';

/** Normalized failure: `code` is the server's error code or NETWORK / TIMEOUT / SERVER. */
export class AppError extends Error {
  constructor(public code: string, message: string, public status?: number, public fields?: Record<string, string[]>) { super(message); }
  /** No answer from the server: the action may or may not have been applied. */
  get uncertain() { return this.code === 'NETWORK' || this.code === 'TIMEOUT'; }
}
export const asAppError = (error: unknown) => error instanceof AppError ? error : new AppError('UNKNOWN', error instanceof Error ? error.message : 'Unknown error');

let tokens: AuthTokens | null = null;
let onSessionLost: () => void = () => {};
export const accessToken = () => tokens?.accessToken ?? null;
export const refreshToken = () => tokens?.refreshToken ?? null;
export function onSessionExpired(handler: () => void) { onSessionLost = handler; }
export async function setTokens(next: AuthTokens | null) { tokens = next; await storeTokens(next); }

const APP_HEADERS = { 'X-UzBite-Client': 'app' };
const baseUrl = () => `${serverConfig().apiUrl}/api`;
function toAppError(error: unknown): AppError {
  if (!axios.isAxiosError(error)) return asAppError(error);
  const response = error.response;
  if (!response) return new AppError(error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' ? 'TIMEOUT' : 'NETWORK', error.message);
  const body = response.data as { error?: { code?: string; message?: string; fields?: Record<string, string[]> } } | undefined;
  if (body?.error?.code) return new AppError(body.error.code, body.error.message ?? '', response.status, body.error.fields);
  return new AppError(response.status >= 500 ? 'SERVER' : 'HTTP', `HTTP ${response.status}`, response.status);
}

/** Rotates the refresh token once for all callers waiting at the same time. */
let refreshing: Promise<AuthTokens | null> | null = null;
export function refreshSession(): Promise<AuthTokens | null> {
  refreshing ??= (async () => {
    const current = tokens;
    if (!current) return null;
    try {
      // No Authorization header: the access token may already be expired.
      const { data } = await axios.post<{ data: { tokens: AuthTokens } }>(`${baseUrl()}/courier/auth/refresh`, { refreshToken: current.refreshToken }, { headers: APP_HEADERS, timeout: 15000 });
      await setTokens(data.data.tokens);
      return data.data.tokens;
    } catch (error) {
      const failure = toAppError(error);
      if (failure.status === 401) { await setTokens(null); onSessionLost(); return null; }
      throw failure;
    } finally { refreshing = null; }
  })();
  return refreshing;
}

/** Ends the server session by its refresh token, even if the access token has expired. */
export async function revokeOnServer() {
  const current = tokens;
  if (!current) return;
  await axios.post(`${baseUrl()}/courier/auth/logout`, { refreshToken: current.refreshToken }, { headers: APP_HEADERS, timeout: 8000 }).catch(() => {});
}

export const api = axios.create({ timeout: 15000, headers: APP_HEADERS });
api.interceptors.request.use(config => {
  config.baseURL = baseUrl();
  if (tokens && !config.headers.has('Authorization')) config.headers.set('Authorization', `Bearer ${tokens.accessToken}`);
  return config;
});
api.interceptors.response.use(response => response, async (error: AxiosError) => {
  const config = error.config as (AxiosRequestConfig & { retried?: boolean }) | undefined;
  // A 401 is answered by the auth middleware before any handler runs, so one retry is safe.
  if (error.response?.status === 401 && config && !config.retried && tokens && !String(config.url).includes('/auth/')) {
    config.retried = true;
    const fresh = await refreshSession().catch(() => null);
    if (fresh) {
      config.headers = { ...config.headers, Authorization: `Bearer ${fresh.accessToken}` };
      return api(config);
    }
  }
  throw toAppError(error);
});

type Envelope<T> = { data: T; serverTime?: string; pagination?: { page: number; pageSize: number; total: number; hasMore: boolean }; unreadCount?: number };
export async function call<T>(method: 'get' | 'post' | 'patch', url: string, body?: unknown, params?: Record<string, unknown>) {
  const response = await api.request<Envelope<T>>({ method, url, data: body, params });
  return response.data;
}
