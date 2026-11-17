import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import NetInfo from '@react-native-community/netinfo';
import { focusManager, onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { asAppError } from './api/client';
import { PrefsProvider, usePrefs } from './prefs';
import { SessionProvider } from './session';
import { RootNavigator } from './navigation';

// React Query follows the real network state and refreshes when the app returns to the foreground.
onlineManager.setEventListener(setOnline => NetInfo.addEventListener(state => setOnline(state.isConnected !== false)));
if (Platform.OS !== 'web') focusManager.setEventListener(handleFocus => { const subscription = AppState.addEventListener('change', state => handleFocus(state === 'active')); return () => subscription.remove(); });

const queryClient = new QueryClient({
  defaultOptions: {
    // Only connection failures are retried; a server answer (404, 409…) is final and shown at once.
    queries: { staleTime: 15_000, retry: (count, error) => count < 2 && asAppError(error).uncertain, retryDelay: 1500 },
    // Actions are never repeated automatically: a lost answer is resolved by re-reading the server.
    mutations: { retry: false },
  },
});

function ThemedStatusBar() {
  const { theme } = usePrefs();
  return <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />;
}
export default function App() {
  useEffect(() => () => queryClient.clear(), []);
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <PrefsProvider>
          <ThemedStatusBar />
          <SessionProvider>
            <RootNavigator />
          </SessionProvider>
        </PrefsProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
