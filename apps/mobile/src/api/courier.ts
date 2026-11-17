import type {
  AuthTokens, CourierAccount, CourierAffiliationDto, CourierDelivery, CourierEarnings, CourierHistoryItem, CourierInvitationDto, CourierOffer, CourierWorkMode, Language, Theme,
} from '@uzbite/shared';
import { call } from './client';

/** Typed calls to /api/courier. The server is the only source of truth for every value. */
export type RegisterInput = { firstName: string; lastName: string; email: string; phone: string; password: string; passwordConfirmation: string; language: Language; theme: Theme };
export type HistoryFilter = 'all' | 'completed' | 'cancelled' | 'restaurant' | 'freelance';
export type AppNotification = { id: string; type: string; title: string; body: string; link: string; metadata: Record<string, unknown> | null; readAt: string | null; createdAt: string };
export type CancellationResult = { outcome: 'RELEASED' | 'ISSUE_OPENED'; issueId: string | null; delivery: CourierDelivery | null };

const data = async <T>(promise: Promise<{ data: T }>) => (await promise).data;

export const courierApi = {
  register: (input: RegisterInput) => data(call<{ tokens: AuthTokens; account: CourierAccount }>('post', '/courier/auth/register', input)),
  login: (email: string, password: string) => data(call<{ tokens: AuthTokens; account: CourierAccount }>('post', '/courier/auth/login', { email, password })),
  me: () => data(call<CourierAccount>('get', '/courier/me')),
  updateProfile: (input: { firstName?: string; lastName?: string; phone?: string }) => data(call<CourierAccount>('patch', '/courier/profile', input)),
  updateSettings: (input: { language?: Language; theme?: Theme }) => data(call<{ language: Language; theme: Theme }>('patch', '/courier/settings', input)),
  setAvailability: (available: boolean) => data(call<CourierAccount>('patch', '/courier/availability', { available })),
  setWorkMode: (mode: CourierWorkMode) => data(call<CourierAccount>('patch', '/courier/work-mode', { mode })),
  setServiceArea: (city: string, zone: string) => data(call<CourierAccount>('patch', '/courier/service-area', { city, zone })),
  onboarding: (input: { step?: number; complete?: true }) => data(call<CourierAccount>('patch', '/courier/onboarding', input)),

  claimInvitation: (code: string) => data(call<CourierInvitationDto>('post', '/courier/restaurant-invitations/claim', { code })),
  invitations: () => data(call<CourierInvitationDto[]>('get', '/courier/restaurant-invitations')),
  acceptInvitation: (id: string) => data(call<CourierAffiliationDto>('post', `/courier/restaurant-invitations/${id}/accept`)),
  rejectInvitation: (id: string) => data(call<CourierInvitationDto>('post', `/courier/restaurant-invitations/${id}/reject`)),
  affiliations: () => data(call<CourierAffiliationDto[]>('get', '/courier/affiliations')),
  endAffiliation: (id: string) => data(call<CourierAffiliationDto>('post', `/courier/affiliations/${id}/end`)),

  /** Offers come with the server clock so deadlines are measured in server time. */
  offers: async () => { const reply = await call<CourierOffer[]>('get', '/courier/delivery-offers'); return { items: reply.data, serverTime: reply.serverTime ?? new Date().toISOString(), receivedAt: Date.now() }; },
  offer: async (id: string) => { const reply = await call<CourierOffer>('get', `/courier/delivery-offers/${id}`); return { offer: reply.data, serverTime: reply.serverTime ?? new Date().toISOString() }; },
  acceptOffer: (id: string) => data(call<CourierDelivery>('post', `/courier/delivery-offers/${id}/accept`)),
  rejectOffer: (id: string, reason?: string) => data(call<CourierOffer>('post', `/courier/delivery-offers/${id}/reject`, reason ? { reason } : {})),

  activeDelivery: () => data(call<CourierDelivery | null>('get', '/courier/deliveries/active')),
  delivery: (id: string) => data(call<CourierDelivery>('get', `/courier/deliveries/${id}`)),
  pickup: (id: string) => data(call<CourierDelivery>('post', `/courier/deliveries/${id}/pickup`)),
  start: (id: string) => data(call<CourierDelivery>('post', `/courier/deliveries/${id}/start`)),
  cashCollected: (id: string) => data(call<CourierDelivery>('post', `/courier/deliveries/${id}/cash-collected`)),
  complete: (id: string, code: string) => data(call<CourierDelivery>('post', `/courier/deliveries/${id}/complete`, { code })),
  requestCancellation: (id: string, reason: string) => data(call<CancellationResult>('post', `/courier/deliveries/${id}/request-cancellation`, { reason })),
  handoffProblem: (id: string, reason: string) => data(call<{ issueId: string; delivery: CourierDelivery }>('post', `/courier/deliveries/${id}/handoff-problem`, { reason })),

  history: async (filter: HistoryFilter, page: number) => { const reply = await call<CourierHistoryItem[]>('get', '/courier/history', undefined, { filter, page, pageSize: 20 }); return { items: reply.data, hasMore: reply.pagination?.hasMore ?? false, page }; },
  earnings: () => data(call<CourierEarnings>('get', '/courier/earnings')),
  notifications: async (page: number) => { const reply = await call<AppNotification[]>('get', '/courier/notifications', undefined, { page, pageSize: 20 }); return { items: reply.data, hasMore: reply.pagination?.hasMore ?? false, unread: reply.unreadCount ?? 0, page }; },
  readNotifications: (ids?: string[]) => data(call<{ read: number }>('patch', '/courier/notifications/read', ids ? { ids } : {})),
};
