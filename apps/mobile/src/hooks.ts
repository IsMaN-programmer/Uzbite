import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { courierApi } from './api/courier';
import { useConnectivity } from './realtime';

/** Without the live socket the app falls back to polling, so nothing waits forever for an event. */
const fallbackInterval = (realtime: boolean, ms: number) => (realtime ? false : ms);

export function useAccount() {
  return useQuery({ queryKey: ['me'], queryFn: courierApi.me });
}
export function useOffers(enabled = true) {
  const { realtime } = useConnectivity();
  return useQuery({ queryKey: ['offers'], queryFn: courierApi.offers, enabled, refetchInterval: fallbackInterval(realtime, 10000) });
}
export function useActiveDelivery() {
  const { realtime } = useConnectivity();
  return useQuery({ queryKey: ['active'], queryFn: courierApi.activeDelivery, refetchInterval: fallbackInterval(realtime, 15000) });
}
/** Updated by `courier:map_updated` and offer events; polled only while the live socket is down. */
export function useCourierMap() {
  const { realtime } = useConnectivity();
  return useQuery({ queryKey: ['map'], queryFn: courierApi.map, refetchInterval: fallbackInterval(realtime, 15000) });
}
export function useEarnings() {
  return useQuery({ queryKey: ['earnings'], queryFn: courierApi.earnings });
}
/** Re-renders every second; used by countdowns that run on the server's clock. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), intervalMs); return () => clearInterval(timer); }, [intervalMs]);
  return now;
}
