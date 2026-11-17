/**
 * Courier / dispatch transport contracts shared by the backend, the courier mobile app
 * and the future restaurant Windows client. Pure types and constants only: no server code.
 */
import type { Language, Money, PaymentMethod, PaymentStatus, Theme, OrderStatus } from './index.js';

export const DELIVERY_STATUSES = ['NOT_REQUESTED', 'SEARCHING', 'OFFERED', 'ASSIGNED', 'READY_FOR_PICKUP', 'PICKED_UP', 'ON_THE_WAY', 'DELIVERED', 'FAILED', 'CANCELLED'] as const;
export type DeliveryStatus = typeof DELIVERY_STATUSES[number];
/** Accepted, unfinished deliveries. A courier may hold at most one (enforced by a partial unique index). */
export const ACTIVE_DELIVERY_STATUSES = ['ASSIGNED', 'READY_FOR_PICKUP', 'PICKED_UP', 'ON_THE_WAY'] as const satisfies readonly DeliveryStatus[];
export type DeliveryMode = 'RESTAURANT_COURIER' | 'UZBITE_COURIER';
export type DeliveryOfferStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'WITHDRAWN' | 'TAKEN';
export type CashCollectionStatus = 'NOT_APPLICABLE' | 'PENDING' | 'COLLECTED' | 'SETTLED';
export type CourierRewardStatus = 'NONE' | 'ACCRUED' | 'CONFIRMED' | 'PAID';
export type CourierWorkMode = 'RESTAURANT' | 'FREELANCE';
export type CourierApprovalStatus = 'PENDING' | 'APPROVED' | 'SUSPENDED';
/** Server-computed: BUSY comes from a real accepted delivery and cannot be toggled by the client. */
export type CourierAvailability = 'AVAILABLE' | 'UNAVAILABLE' | 'BUSY';
export type DeliveryIssueType = 'CANCELLATION_REQUEST' | 'HANDOFF_CODE_UNAVAILABLE';

/** Work areas used for matching free couriers. Matching is by configured zone, never by live GPS. */
export const SERVICE_CITIES = [{ code: 'tashkent', name: { ru: 'Ташкент', uz: 'Toshkent', en: 'Tashkent' } }] as const;
export const SERVICE_ZONES = [
  { code: 'almazar', city: 'tashkent', name: { ru: 'Алмазарский район', uz: 'Olmazor tumani', en: 'Almazar district' } },
  { code: 'bektemir', city: 'tashkent', name: { ru: 'Бектемирский район', uz: 'Bektemir tumani', en: 'Bektemir district' } },
  { code: 'chilanzar', city: 'tashkent', name: { ru: 'Чиланзарский район', uz: 'Chilonzor tumani', en: 'Chilanzar district' } },
  { code: 'mirabad', city: 'tashkent', name: { ru: 'Мирабадский район', uz: 'Mirobod tumani', en: 'Mirabad district' } },
  { code: 'mirzo_ulugbek', city: 'tashkent', name: { ru: 'Мирзо-Улугбекский район', uz: 'Mirzo Ulug‘bek tumani', en: 'Mirzo Ulugbek district' } },
  { code: 'sergeli', city: 'tashkent', name: { ru: 'Сергелийский район', uz: 'Sergeli tumani', en: 'Sergeli district' } },
  { code: 'shaykhantakhur', city: 'tashkent', name: { ru: 'Шайхантахурский район', uz: 'Shayxontohur tumani', en: 'Shaykhantakhur district' } },
  { code: 'uchtepa', city: 'tashkent', name: { ru: 'Учтепинский район', uz: 'Uchtepa tumani', en: 'Uchtepa district' } },
  { code: 'yakkasaray', city: 'tashkent', name: { ru: 'Яккасарайский район', uz: 'Yakkasaroy tumani', en: 'Yakkasaray district' } },
  { code: 'yangihayot', city: 'tashkent', name: { ru: 'Янгихаётский район', uz: 'Yangihayot tumani', en: 'Yangihayot district' } },
  { code: 'yashnabad', city: 'tashkent', name: { ru: 'Яшнабадский район', uz: 'Yashnobod tumani', en: 'Yashnabad district' } },
  { code: 'yunusabad', city: 'tashkent', name: { ru: 'Юнусабадский район', uz: 'Yunusobod tumani', en: 'Yunusabad district' } },
] as const;
export type ServiceZoneCode = typeof SERVICE_ZONES[number]['code'];

export interface AuthTokens { accessToken: string; refreshToken: string; accessExpiresAt: string }

export interface CourierProfileDto {
  firstName: string;
  lastName: string;
  approvalStatus: CourierApprovalStatus;
  isTestAccount: boolean;
  workMode: CourierWorkMode | null;
  isAvailable: boolean;
  availability: CourierAvailability;
  city: string;
  serviceZone: string | null;
  onboardingStep: number;
  onboardingCompleted: boolean;
  /** What the server will currently allow; the client only mirrors it. */
  permissions: { restaurantMode: boolean; freelanceMode: boolean; reason: string | null };
}
export interface CourierAccount {
  id: string;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
  role: 'COURIER';
  settings: { language: Language; theme: Theme };
  profile: CourierProfileDto;
  activeDeliveryId: string | null;
  activeAffiliations: number;
  createdAt: string;
}
export interface CourierSession { tokens: AuthTokens; account: CourierAccount }

export interface RestaurantBrief { id: string; name: string; logoUrl: string; addressText: string }

/** What any offered courier may see. Contains no customer address, name or phone. */
export interface CourierOffer {
  id: string;
  deliveryId: string;
  mode: DeliveryMode;
  status: DeliveryOfferStatus;
  reward: Money | null;
  expiresAt: string;
  createdAt: string;
  restaurant: RestaurantBrief & { zone: string | null };
  /** Great-circle distance between stored restaurant and drop-off points; not a route. */
  straightLineKm: number | null;
  order: { number: string; itemCount: number; paymentMethod: PaymentMethod | null; cashToCollect: Money | null };
}

export interface CourierDeliveryDropoff {
  addressText: string;
  entrance: string;
  floor: string;
  apartment: string;
  comment: string;
  latitude: number | null;
  longitude: number | null;
  recipientName: string;
  recipientPhone: string;
}
/** Full detail, served only to the courier currently assigned to an unfinished delivery. */
export interface CourierDelivery {
  id: string;
  orderId: string;
  number: string;
  mode: DeliveryMode | null;
  status: DeliveryStatus;
  version: number;
  reward: Money | null;
  rewardStatus: CourierRewardStatus;
  restaurant: RestaurantBrief & { phone: string | null; latitude: number | null; longitude: number | null };
  /** null once the delivery is finished: personal data is not kept on the courier's device. */
  dropoff: CourierDeliveryDropoff | null;
  order: { status: OrderStatus; items: { name: string; quantity: number }[]; total: Money; paymentMethod: PaymentMethod | null; paymentStatus: PaymentStatus | null };
  cash: { amount: Money; status: CashCollectionStatus; collectedAt: string | null };
  handoffAttemptsLeft: number;
  readyAt: string | null;
  assignedAt: string | null;
  pickedUpAt: string | null;
  startedAt: string | null;
  deliveredAt: string | null;
  closedAt: string | null;
  closeReason: string | null;
  openIssues: { id: string; type: DeliveryIssueType; createdAt: string }[];
}

export type CourierHistoryOutcome = 'DELIVERED' | 'CANCELLED' | 'FAILED' | 'IN_PROGRESS';
export interface CourierHistoryItem {
  offerId: string;
  deliveryId: string;
  number: string;
  restaurantName: string;
  mode: DeliveryMode;
  outcome: CourierHistoryOutcome;
  reward: Money | null;
  rewardStatus: CourierRewardStatus;
  acceptedAt: string;
  finishedAt: string | null;
  reason: string | null;
}
export interface CourierEarnings {
  completedCount: number;
  /** ACCRUED = начислено, CONFIRMED = подтверждено рестораном, PAID = выплата отмечена. Never "received" unless PAID. */
  totals: { accrued: Money; confirmed: Money; paid: Money };
  pending: Money;
  today: { completed: number; accrued: Money };
  withoutReward: number;
}
export interface CourierAffiliationDto { id: string; restaurant: RestaurantBrief; status: 'ACTIVE' | 'ENDED'; invitedAt: string; confirmedAt: string; endedAt: string | null }
export interface CourierInvitationDto { id: string; restaurant: RestaurantBrief; status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'REVOKED' | 'EXPIRED'; expiresAt: string; createdAt: string }

/**
 * Socket.IO events. Payloads are hints; clients re-read REST, which is the source of truth.
 * Native apps connect with `auth: { token: accessToken }` and are placed in their rooms by the
 * server: courier:{id} or restaurant:{id}, plus user:{id} for `notification:created`.
 */
export const DELIVERY_SOCKET_EVENTS = [
  'delivery:offer_created', 'delivery:offer_accepted', 'delivery:offer_rejected', 'delivery:offer_expired', 'delivery:offer_withdrawn', 'delivery:offer_taken',
  'delivery:courier_assigned', 'delivery:search_started', 'delivery:pickup_ready', 'delivery:picked_up', 'delivery:status_updated',
  'delivery:completed', 'delivery:cancelled', 'delivery:issue_updated', 'courier:profile_updated', 'courier:affiliation_updated', 'notification:created',
] as const;
export type DeliverySocketEvent = typeof DELIVERY_SOCKET_EVENTS[number];
/** Restaurant room only: new customer orders and changes of order or payment status. */
export const RESTAURANT_SOCKET_EVENTS = ['restaurant:order_created', 'restaurant:order_updated'] as const;
export type RestaurantSocketEvent = typeof RESTAURANT_SOCKET_EVENTS[number];
/**
 * Client → server requests, each answered `{ ok }` by acknowledgement. `delivery:join` is allowed
 * for the delivery's restaurant and its currently assigned courier; `order:join` for its customer.
 */
export const SOCKET_CLIENT_EVENTS = ['delivery:join', 'delivery:leave', 'order:join', 'post:join', 'post:leave'] as const;
/** Every delivery hint carries at least these fields; `version` grows with each change. */
export interface DeliverySocketHint { deliveryId: string; orderId: string; status: DeliveryStatus; version: number }
