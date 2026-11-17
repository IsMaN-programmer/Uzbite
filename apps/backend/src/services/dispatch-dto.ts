import type { Prisma, DeliveryStatus } from '@prisma/client';
import type { CourierDelivery, CourierOffer } from '@uzbite/shared';
import { env } from '../config/env.js';
import { greatCircleKm } from '../utils/delivery.js';
import { jsonValue } from '../utils/serialize.js';

export const ACTIVE_DELIVERY: DeliveryStatus[] = ['ASSIGNED', 'READY_FOR_PICKUP', 'PICKED_UP', 'ON_THE_WAY'];
export const BEFORE_PICKUP: DeliveryStatus[] = ['ASSIGNED', 'READY_FOR_PICKUP'];
export const AFTER_PICKUP: DeliveryStatus[] = ['PICKED_UP', 'ON_THE_WAY'];
export const orderNumber = (orderId: string) => orderId.slice(-8).toUpperCase();

type JsonObject = Record<string, unknown>;
const obj = (value: Prisma.JsonValue | null | undefined): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
const str = (value: unknown) => typeof value === 'string' ? value : '';
const num = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const money = (value: Prisma.Decimal | null | undefined) => value == null ? null : value.toNumber();
const iso = (value: Date | null | undefined) => value ? value.toISOString() : null;

export const offerInclude = {
  delivery: { include: {
    restaurant: { select: { id: true, name: true, logoUrl: true, addressText: true, serviceZone: true } },
    order: { select: { id: true, total: true, items: { select: { quantity: true } }, payment: { select: { method: true } } } },
  } },
} as const satisfies Prisma.DeliveryOfferInclude;
type OfferRow = Prisma.DeliveryOfferGetPayload<{ include: typeof offerInclude }>;

/** Offer preview for any matched courier: restaurant, approximate distance and terms; no customer data. */
export function courierOfferDto(offer: OfferRow, now = new Date()): CourierOffer {
  const { delivery } = offer;
  const pickup = obj(delivery.pickupSnapshot), dropoff = obj(delivery.dropoffSnapshot);
  const from = { latitude: num(pickup.latitude), longitude: num(pickup.longitude) }, to = { latitude: num(dropoff.latitude), longitude: num(dropoff.longitude) };
  const km = from.latitude !== null && from.longitude !== null && to.latitude !== null && to.longitude !== null ? greatCircleKm({ latitude: from.latitude, longitude: from.longitude }, { latitude: to.latitude, longitude: to.longitude }) : null;
  const cash = delivery.order.payment?.method === 'CASH';
  return {
    id: offer.id, deliveryId: offer.deliveryId, mode: offer.mode,
    status: offer.status === 'PENDING' && offer.expiresAt <= now ? 'EXPIRED' : offer.status,
    reward: money(offer.reward), expiresAt: offer.expiresAt.toISOString(), createdAt: offer.createdAt.toISOString(),
    restaurant: { id: delivery.restaurant.id, name: delivery.restaurant.name, logoUrl: delivery.restaurant.logoUrl, addressText: delivery.restaurant.addressText, zone: delivery.restaurant.serviceZone },
    straightLineKm: km === null ? null : Math.round(km * 10) / 10,
    order: { number: orderNumber(delivery.order.id), itemCount: delivery.order.items.reduce((sum, item) => sum + item.quantity, 0), paymentMethod: delivery.order.payment?.method ?? null, cashToCollect: cash ? delivery.order.total.toNumber() : null },
  };
}

export const courierDeliveryInclude = {
  order: { select: { id: true, status: true, total: true, items: { select: { dishName: true, quantity: true } }, payment: { select: { method: true, status: true } } } },
  restaurant: { select: { id: true, name: true, logoUrl: true, addressText: true, phone: true } },
  issues: { where: { status: 'OPEN' as const }, select: { id: true, type: true, createdAt: true } },
} as const satisfies Prisma.DeliveryInclude;
type CourierDeliveryRow = Prisma.DeliveryGetPayload<{ include: typeof courierDeliveryInclude }>;

/** Assigned courier's view. Customer address/phone are included only while the delivery is unfinished. */
export function courierDeliveryDto(delivery: CourierDeliveryRow, courierId: string): CourierDelivery {
  const pickup = obj(delivery.pickupSnapshot), dropoff = obj(delivery.dropoffSnapshot);
  const showCustomer = delivery.courierId === courierId && ACTIVE_DELIVERY.includes(delivery.status);
  return {
    id: delivery.id, orderId: delivery.orderId, number: orderNumber(delivery.orderId), mode: delivery.mode, status: delivery.status, version: delivery.version,
    reward: money(delivery.reward), rewardStatus: delivery.rewardStatus,
    restaurant: { id: delivery.restaurant.id, name: str(pickup.name) || delivery.restaurant.name, logoUrl: delivery.restaurant.logoUrl, addressText: str(pickup.addressText) || delivery.restaurant.addressText, phone: str(pickup.phone) || delivery.restaurant.phone, latitude: num(pickup.latitude), longitude: num(pickup.longitude) },
    dropoff: showCustomer ? {
      addressText: str(dropoff.addressText), entrance: str(dropoff.entrance), floor: str(dropoff.floor), apartment: str(dropoff.apartment), comment: str(dropoff.comment),
      latitude: num(dropoff.latitude), longitude: num(dropoff.longitude), recipientName: str(dropoff.recipientName), recipientPhone: str(dropoff.recipientPhone),
    } : null,
    order: { status: delivery.order.status, items: delivery.order.items.map(item => ({ name: item.dishName, quantity: item.quantity })), total: delivery.order.total.toNumber(), paymentMethod: delivery.order.payment?.method ?? null, paymentStatus: delivery.order.payment?.status ?? null },
    cash: { amount: delivery.cashAmount.toNumber(), status: delivery.cashStatus, collectedAt: iso(delivery.cashCollectedAt) },
    handoffAttemptsLeft: Math.max(0, env.DELIVERY_HANDOFF_MAX_ATTEMPTS - delivery.handoffAttempts),
    readyAt: iso(delivery.readyAt), assignedAt: iso(delivery.assignedAt), pickedUpAt: iso(delivery.pickedUpAt), startedAt: iso(delivery.startedAt), deliveredAt: iso(delivery.deliveredAt),
    closedAt: iso(delivery.closedAt), closeReason: delivery.closeReason,
    openIssues: showCustomer ? delivery.issues.map(issue => ({ id: issue.id, type: issue.type, createdAt: issue.createdAt.toISOString() })) : [],
  };
}

export const restaurantDeliveryInclude = {
  courier: { select: { userId: true, firstName: true, lastName: true, user: { select: { phone: true, avatarUrl: true } } } },
  offers: { orderBy: { createdAt: 'desc' as const }, take: 30, include: { courier: { select: { firstName: true, lastName: true } } } },
  issues: { orderBy: { createdAt: 'desc' as const } },
  events: { orderBy: { createdAt: 'asc' as const }, take: 100 },
} as const satisfies Prisma.DeliveryInclude;
type RestaurantDeliveryRow = Prisma.DeliveryGetPayload<{ include: typeof restaurantDeliveryInclude }>;

/** Restaurant view: courier contact for coordination, offers and audit trail. Never the handoff code. */
export function restaurantDeliveryDto(delivery: RestaurantDeliveryRow) {
  const { handoffCode: _secret, handoffAttempts: _attempts, courier, offers, ...rest } = delivery;
  return jsonValue({
    ...rest,
    courier: courier ? { id: courier.userId, name: `${courier.firstName} ${courier.lastName}`.trim(), phone: courier.user.phone, avatarUrl: courier.user.avatarUrl } : null,
    offers: offers.map(({ courier: offered, ...offer }) => ({ ...offer, courierName: `${offered.firstName} ${offered.lastName}`.trim() })),
  });
}
