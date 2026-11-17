import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { AuthTokens } from '@uzbite/shared';

/**
 * Tokens live only in the device keystore (expo-secure-store). The web build exists solely as a
 * development preview: there the tokens stay in sessionStorage of the tab (or memory) and are gone
 * when it closes.
 */
const KEY = 'uzbite.courier.tokens';
let memory: string | null = null;
const webStore = () => (__DEV__ && typeof sessionStorage !== 'undefined' ? sessionStorage : null);

async function read(): Promise<string | null> {
  if (Platform.OS !== 'web') return SecureStore.getItemAsync(KEY);
  return webStore()?.getItem(KEY) ?? memory;
}
async function write(value: string | null) {
  if (Platform.OS !== 'web') {
    if (value) await SecureStore.setItemAsync(KEY, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
    else await SecureStore.deleteItemAsync(KEY);
    return;
  }
  memory = value;
  const store = webStore();
  if (store) { if (value) store.setItem(KEY, value); else store.removeItem(KEY); }
}

export async function loadTokens(): Promise<AuthTokens | null> {
  try {
    const raw = await read();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthTokens>;
    return typeof parsed.accessToken === 'string' && typeof parsed.refreshToken === 'string' ? parsed as AuthTokens : null;
  } catch { return null; }
}
export async function storeTokens(tokens: AuthTokens | null) {
  await write(tokens ? JSON.stringify(tokens) : null);
}
