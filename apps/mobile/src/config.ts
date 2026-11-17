import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

/**
 * Server address. Production/preview builds use EXPO_PUBLIC_API_URL / EXPO_PUBLIC_SOCKET_URL (HTTPS
 * only, checked in app.config.ts). Development may talk HTTP to the computer on the same Wi-Fi: by
 * default the host that serves the JS bundle, port 8081, or an address saved on the server screen.
 */
const extra = (Constants.expoConfig?.extra ?? {}) as { variant?: string; allowCustomServer?: boolean };
export const appVariant = extra.variant ?? 'development';
export const appVersion = Constants.expoConfig?.version ?? '0.1.0';
export const allowCustomServer = Boolean(extra.allowCustomServer) && __DEV__;
const OVERRIDE_KEY = 'uzbite.courier.server';
const API_PORT = 8081;

export type ServerConfig = { apiUrl: string; socketUrl: string; source: 'saved' | 'env' | 'auto' };
let current: ServerConfig = { apiUrl: '', socketUrl: '', source: 'auto' };

export const normalizeServerUrl = (value: string) => value.trim().replace(/\/+$/, '').replace(/\/api$/, '');
export const isValidServerUrl = (value: string) => /^https?:\/\/[a-z0-9.-]+(:\d{2,5})?$/i.test(normalizeServerUrl(value));

function automaticAddress() {
  if (Platform.OS === 'web' && typeof window !== 'undefined') return `${window.location.protocol}//${window.location.hostname}:${API_PORT}`;
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return `http://${host || 'localhost'}:${API_PORT}`;
}

export async function loadServerConfig(): Promise<ServerConfig> {
  const envApi = process.env.EXPO_PUBLIC_API_URL ? normalizeServerUrl(process.env.EXPO_PUBLIC_API_URL) : '';
  const envSocket = process.env.EXPO_PUBLIC_SOCKET_URL ? normalizeServerUrl(process.env.EXPO_PUBLIC_SOCKET_URL) : envApi;
  let saved: string | null = null;
  if (allowCustomServer) { try { saved = await AsyncStorage.getItem(OVERRIDE_KEY); } catch { saved = null; } }
  if (saved && isValidServerUrl(saved)) current = { apiUrl: saved, socketUrl: saved, source: 'saved' };
  else if (envApi) current = { apiUrl: envApi, socketUrl: envSocket, source: 'env' };
  else if (appVariant === 'development') current = { apiUrl: automaticAddress(), socketUrl: automaticAddress(), source: 'auto' };
  else throw new Error('SERVER_NOT_CONFIGURED');
  return current;
}
export const serverConfig = () => current;

/** Development only: point the app at another computer, or null to go back to the default. */
export async function saveServerOverride(url: string | null) {
  if (!allowCustomServer) return;
  if (url) await AsyncStorage.setItem(OVERRIDE_KEY, normalizeServerUrl(url));
  else await AsyncStorage.removeItem(OVERRIDE_KEY);
  await loadServerConfig();
}
