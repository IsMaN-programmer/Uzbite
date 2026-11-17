import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNetInfo } from '@react-native-community/netinfo';
import { io } from 'socket.io-client';
import { DELIVERY_SOCKET_EVENTS, type DeliverySocketEvent } from '@uzbite/shared';
import { serverConfig } from './config';
import { accessToken, refreshSession } from './api/client';

/**
 * Socket.IO with the courier's Bearer token. The server puts the socket in courier:{id} and
 * user:{id}. Events are only hints: each one makes the app re-read REST, and so does every
 * (re)connection — nothing is assumed from a payload.
 */
type Connectivity = { online: boolean; realtime: boolean };
const RealtimeContext = createContext<Connectivity>({ online: true, realtime: false });

const queriesFor = (event: DeliverySocketEvent): string[][] => {
  if (event === 'notification:created') return [['notifications']];
  if (event === 'courier:profile_updated') return [['me']];
  if (event === 'courier:affiliation_updated') return [['me'], ['affiliations'], ['invitations']];
  if (event.startsWith('delivery:offer_')) return [['offers'], ['active'], ['me']];
  return [['active'], ['delivery'], ['offers'], ['history'], ['earnings'], ['me']];
};

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const net = useNetInfo();
  const [realtime, setRealtime] = useState(false);
  useEffect(() => {
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let backoff = 2000;
    const socket = io(serverConfig().socketUrl, {
      transports: ['websocket'], reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 15000, timeout: 10000,
      // Read on every attempt, so a reconnect always uses the latest access token.
      auth: callback => callback({ token: accessToken() ?? '' }),
    });
    // The server refuses an expired token and closes sockets when the token expires: refresh, then reconnect.
    const reconnectWithFreshToken = async () => {
      if (stopped) return;
      await refreshSession().catch(() => null);
      if (stopped || !accessToken()) return;
      clearTimeout(retry);
      retry = setTimeout(() => { if (!stopped && !socket.connected) socket.connect(); }, backoff);
      backoff = Math.min(backoff * 2, 30000);
    };
    socket.on('connect', () => { backoff = 2000; setRealtime(true); void queryClient.invalidateQueries(); });
    socket.on('disconnect', reason => { setRealtime(false); if (reason === 'io server disconnect') void reconnectWithFreshToken(); });
    socket.on('connect_error', error => { setRealtime(false); if (error.message === 'Unauthorized') void reconnectWithFreshToken(); });
    for (const event of DELIVERY_SOCKET_EVENTS) {
      socket.on(event, () => { for (const queryKey of queriesFor(event)) void queryClient.invalidateQueries({ queryKey }); });
    }
    return () => { stopped = true; clearTimeout(retry); socket.removeAllListeners(); socket.disconnect(); };
  }, [queryClient]);
  return <RealtimeContext.Provider value={{ online: net.isConnected !== false, realtime }}>{children}</RealtimeContext.Provider>;
}
export const useConnectivity = () => useContext(RealtimeContext);
