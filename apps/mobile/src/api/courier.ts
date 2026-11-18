import type {
  AuthTokens, CourierAccount, CourierAffiliationDto, CourierDelivery, CourierEarnings, CourierHistoryItem, CourierInvitationDto, CourierMap, CourierOffer, CourierWorkMode, Language, Theme,
} from '@uzbite/shared';
import { call, upload } from './client';

/** Typed calls to /api/courier. The server is the only source of truth for every value. */
/** Name, passport and face photo come later, in onboarding step 1. */
export type RegisterInput = { email: string; phone: string; password: string; passwordConfirmation: string; language: Language; theme: Theme };
export type ProfileInput = { firstName?: string; lastName?: string; phone?: string; passportSeries?: string; passportNumber?: string };
/** A picked photo: a File in the browser, a local file URI on a phone. */
export type PhotoInput = { uri: string; file?: Blob; fileName?: string | null; mimeType?: string | null };
export type HistoryFilter = 'all' | 'completed' | 'cancelled' | 'restaurant' | 'freelance';
export type AppNotification = { id: string; type: string; title: string; body: string; link: string; metadata: Record<string, unknown> | null; readAt: string | null; createdAt: string };
export type CancellationResult = { outcome: 'RELEASED' | 'ISSUE_OPENED'; issueId: string | null; delivery: CourierDelivery | null };

const data = async <T>(promise: Promise<{ data: T }>) => (await promise).data;

export const courierApi = {
  register: (input: RegisterInput) => data(call<{ tokens: AuthTokens; account: CourierAccount }>('post', '/courier/auth/register', input)),
  login: (email: string, password: string) => data(call<{ tokens: AuthTokens; account: CourierAccount }>('post', '/courier/auth/login', { email, password })),
  me: () => data(call<CourierAccount>('get', '/courier/me')),
  updateProfile: (input: ProfileInput) => data(call<CourierAccount>('patch', '/courier/profile', input)),
  uploadFacePhoto: (photo: PhotoInput) => {
    const form = new FormData();
    if (photo.file) form.append('file', photo.file, photo.fileName ?? 'face.jpg');
    // React Native reads { uri, name, type } and streams the file from disk.
    else form.append('file', { uri: photo.uri, name: photo.fileName ?? 'face.jpg', type: photo.mimeType ?? 'image/jpeg' } as unknown as Blob);
    return data(upload<CourierAccount>('/courier/identity/face-photo', form));
  },
  updateSettings: (input: { language?: Language; theme?: Theme }) => data(call<{ language: Language; theme: Theme }>('patch', '/courier/settings', input)),
  setAvailability: (available: boolean) => data(call<CourierAccount>('patch', '/courier/availability', { available })),
  setWorkMode: (mode: CourierWorkMode) => data(call<CourierAccount>('patch', '/courier/work-mode', { mode })),
  setServiceArea: (city: string) => data(call<CourierAccount>('patch', '/courier/service-area', { city })),
  onboarding: (input: { step?: number; complete?: true }) => data(call<CourierAccount>('patch', '/courier/onboarding', input)),

  claimInvitation: (code: string) => data(call<CourierInvitationDto>('post', '/courier/restaurant-invitations/claim', { code })),
  invitations: () => data(call<CourierInvitationDto[]>('get', '/courier/restaurant-invitations')),
  acceptInvitation: (id: string) => data(call<CourierAffiliationDto>('post', `/courier/restaurant-invitations/${id}/accept`)),
  rejectInvitation: (id: string) => data(call<CourierInvitationDto>('post', `/courier/restaurant-invitations/${id}/reject`)),
  affiliations: () => data(call<CourierAffiliationDto[]>('get', '/courier/affiliations')),
  endAffiliation: (id: string) => data(call<CourierAffiliationDto>('post', `/courier/affiliations/${id}/end`)),

  /** Restaurants waiting for a courier now (free searches of the courier's city and personal offers). */
  map: () => data(call<CourierMap>('get', '/courier/map')),
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
