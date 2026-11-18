import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Linking } from 'react-native';
import * as Location from 'expo-location';
import { useQueryClient } from '@tanstack/react-query';
import { courierApi } from './api/courier';

/**
 * While the app is open, a verified courier's position goes to the server (at most every 20 s,
 * or after moving 50 m). The server keeps only the last point and matches orders within 5 km.
 * Foreground only: no background tracking.
 */
export type LocationStatus = 'off' | 'asking' | 'granted' | 'denied' | 'unavailable';
type LocationState = { status: LocationStatus; retry: () => void };
const LocationContext = createContext<LocationState>({ status: 'off', retry: () => {} });
const MIN_INTERVAL_MS = 20_000;

export function LocationProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<LocationStatus>('off');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) { setStatus('off'); return; }
    let stopped = false, last = 0;
    let watch: Location.LocationSubscription | null = null;
    const send = (coords: { latitude: number; longitude: number }) => {
      const now = Date.now();
      if (now - last < MIN_INTERVAL_MS) return;
      last = now;
      courierApi.setLocation(coords.latitude, coords.longitude)
        .then(() => queryClient.invalidateQueries({ queryKey: ['nearby'] }))
        .catch(() => { last = 0; });
    };
    const start = async () => {
      setStatus('asking');
      const permission = await Location.requestForegroundPermissionsAsync();
      if (stopped) return;
      if (!permission.granted) { setStatus('denied'); return; }
      setStatus('granted');
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null);
      if (current && !stopped) send(current.coords);
      const subscription = await Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, timeInterval: MIN_INTERVAL_MS, distanceInterval: 50 }, position => send(position.coords));
      if (stopped) subscription.remove(); else watch = subscription;
    };
    start().catch(() => { if (!stopped) setStatus('unavailable'); });
    return () => { stopped = true; watch?.remove(); };
  }, [enabled, attempt, queryClient]);
  // After a refusal the system may not ask again: then the phone settings are the only way back.
  const retry = useCallback(() => {
    if (status === 'denied') void Linking.openSettings().catch(() => {});
    setAttempt(value => value + 1);
  }, [status]);
  return <LocationContext.Provider value={{ status, retry }}>{children}</LocationContext.Provider>;
}
export const useCourierLocation = () => useContext(LocationContext);
