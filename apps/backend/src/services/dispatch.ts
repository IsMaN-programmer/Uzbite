import { randomInt, timingSafeEqual } from 'node:crypto';
import { Prisma, type CourierApprovalStatus, type CourierProfile, type CourierWorkMode, type Delivery, type DeliveryMode, type DeliveryOffer, type DeliveryStatus, type OrderStatus } from '@prisma/client';
import { db } from '../config/database.js';
import { env } from '../config/env.js';
import { ApiError, assert } from '../utils/errors.js';
import { applyOrderState } from './order-status.js';
import { Outbox } from './outbox.js';
import { dispatchNoticeText } from './notifications.js';
import { ACTIVE_DELIVERY, AFTER_PICKUP, BEFORE_PICKUP, courierDeliveryDto, courierDeliveryInclude, courierOfferDto, offerInclude, orderNumber, restaurantDeliveryDto, restaurantDeliveryInclude, restaurantOrderDto, restaurantOrderInclude } from './dispatch-dto.js';

/**
 * Delivery dispatch core shared by the courier app API and the restaurant API.
 *
 * Rules every function follows:
 * - PostgreSQL is the source of truth. Socket events and notifications are queued in an Outbox
 *   and emitted only after the transaction commits.
 * - Row locks are always taken in the order Order → Delivery → CourierProfile (ids sorted), at
 *   READ COMMITTED, and every state change is a conditional update re-checked under the lock.
 * - Server time decides every deadline. Nothing is assigned, picked up or delivered by a timer.
 */
type Tx = Prisma.TransactionClient;
export type DispatchActor = { id: string | null; role: 'COURIER' | 'RESTAURANT' | 'SYSTEM' };
const SYSTEM: DispatchActor = { id: null, role: 'SYSTEM' };
const OPEN_FOR_OFFERS: DeliveryStatus[] = ['SEARCHING', 'OFFERED'];
const DISPATCHABLE_ORDER: OrderStatus[] = ['ACCEPTED', 'PREPARING'];
const nextVersion = { increment: 1 } as const;

// ---------------------------------------------------------------------------------------------
// Transactions and locking
// ---------------------------------------------------------------------------------------------

/** Returned (not thrown) when a transaction must commit its audit trail and still report an error. */
class CommittedFailure { constructor(readonly error: ApiError) {} }
/** The set of rows to lock changed between the unlocked read and the lock: start over. */
class RetryTransaction extends Error {}
function isRetryable(error: unknown) {
  if (error instanceof RetryTransaction) return true;
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === 'P2034') return true;
  const code = (error.meta as { code?: unknown } | undefined)?.code;
  return error.code === 'P2010' && (code === '40P01' || code === '40001');
}
async function dispatchTx<T>(work: (tx: Tx, out: Outbox) => Promise<T | CommittedFailure>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    const out = new Outbox();
    let result: T | CommittedFailure;
    try {
      result = await db.$transaction(tx => work(tx, out), { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10_000, timeout: 20_000 });
    } catch (error) {
      if (attempt < 4 && isRetryable(error)) continue;
      if (error instanceof RetryTransaction) throw new ApiError(409, 'RETRY', 'Данные изменились. Повторите действие');
      throw error;
    }
    await out.flush();
    if (result instanceof CommittedFailure) throw result.error;
    return result;
  }
}
const sortedIds = (ids: (string | null | undefined)[]) => [...new Set(ids.filter((id): id is string => Boolean(id)))].sort();
/** Locks rows in the canonical order. Call at most once per kind and before any later kind. */
async function lockRows(tx: Tx, rows: { orders?: (string | null | undefined)[]; deliveries?: (string | null | undefined)[]; couriers?: (string | null | undefined)[] }) {
  const orders = sortedIds(rows.orders ?? []), deliveries = sortedIds(rows.deliveries ?? []), couriers = sortedIds(rows.couriers ?? []);
  if (orders.length) await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ANY(${orders}::text[]) ORDER BY "id" FOR UPDATE`;
  if (deliveries.length) await tx.$queryRaw`SELECT "id" FROM "Delivery" WHERE "id" = ANY(${deliveries}::text[]) ORDER BY "id" FOR UPDATE`;
  if (couriers.length) await tx.$queryRaw`SELECT "userId" FROM "CourierProfile" WHERE "userId" = ANY(${couriers}::text[]) ORDER BY "userId" FOR UPDATE`;
}

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

const handoffCode = () => String(randomInt(0, 10_000)).padStart(4, '0');
const jsonObject = (value: Prisma.JsonValue | null | undefined): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
function reasonText(value: string | null | undefined, required: boolean) {
  const reason = (value ?? '').trim();
  if (required) assert(reason.length >= 3 && reason.length <= 500, 400, 'REASON_REQUIRED', 'Укажите причину (от 3 до 500 символов)');
  else assert(reason.length <= 500, 400, 'REASON_TOO_LONG', 'Причина не должна быть длиннее 500 символов');
  return reason || null;
}
function moneyInput(value: number | null | undefined) {
  if (value === null || value === undefined) return null;
  assert(Number.isFinite(value) && value >= 0 && value <= 100_000_000, 400, 'INVALID_REWARD', 'Некорректная сумма вознаграждения');
  return new Prisma.Decimal(value.toFixed(2));
}
function codeMatches(input: string, expected: string) {
  const a = Buffer.from(input), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
async function audit(tx: Tx, deliveryId: string, type: string, actor: DispatchActor, change: { from?: DeliveryStatus | null; to?: DeliveryStatus | null; offerId?: string | null; reason?: string | null } = {}) {
  await tx.deliveryEvent.create({ data: { deliveryId, type, fromStatus: change.from ?? null, toStatus: change.to ?? null, actorId: actor.id, actorRole: actor.role, offerId: change.offerId ?? null, reason: change.reason ?? null } });
}
type DeliveryRef = Pick<Delivery, 'id' | 'orderId' | 'restaurantId' | 'courierId' | 'status' | 'version'>;
/** Delivery hint for the restaurant, the delivery room and the assigned (or former) courier. */
function signal(out: Outbox, event: string, delivery: DeliveryRef, extra: Record<string, unknown> = {}, alsoCourierId?: string | null) {
  const rooms = [`restaurant:${delivery.restaurantId}`, `delivery:${delivery.id}`];
  for (const courierId of new Set([delivery.courierId, alsoCourierId])) if (courierId) rooms.push(`courier:${courierId}`);
  out.emit(rooms, event, { deliveryId: delivery.id, orderId: delivery.orderId, status: delivery.status, version: delivery.version, ...extra });
}
function queueOrderUpdate(out: Outbox, result: { order: { id: string }; notifications: { id: string }[] }) {
  out.customerOrder(result.order.id);
  for (const notice of result.notifications) out.customerNotification(notice.id);
}
type NoticeContext = { deliveryId: string; orderId: string; restaurantName: string };
function noticeData(event: string, context: NoticeContext, extra: Record<string, string> = {}) {
  return { event, deliveryId: context.deliveryId, orderId: context.orderId, orderNumber: orderNumber(context.orderId), restaurantName: context.restaurantName, ...extra };
}
async function notifyCourier(tx: Tx, out: Outbox, courierId: string, event: string, context: NoticeContext, extra: Record<string, string> = {}) {
  const metadata = noticeData(event, context, extra);
  const text = dispatchNoticeText('COURIER_DELIVERY', metadata)!;
  const notice = await tx.notification.create({ data: { userId: courierId, type: 'COURIER_DELIVERY', title: text.title, body: text.body, link: `/deliveries/${context.deliveryId}`, metadata } });
  out.accountNotification(notice.id);
}
async function notifyRestaurant(tx: Tx, out: Outbox, restaurantId: string, event: string, context: NoticeContext, extra: Record<string, string> = {}) {
  const staff = await tx.restaurantStaff.findMany({ where: { restaurantId }, select: { userId: true } });
  if (!staff.length) return;
  const metadata = noticeData(event, context, extra);
  const text = dispatchNoticeText('RESTAURANT_DELIVERY', metadata)!;
  const created = await tx.notification.createManyAndReturn({ data: staff.map(({ userId }) => ({ userId, type: 'RESTAURANT_DELIVERY', title: text.title, body: text.body, link: `/orders/${context.orderId}`, metadata })), select: { id: true } });
  for (const notice of created) out.accountNotification(notice.id);
}
async function notifyCustomerAssigned(tx: Tx, out: Outbox, order: { id: string; userId: string; restaurantName: string }) {
  const metadata = { event: 'COURIER_ASSIGNED', orderId: order.id, restaurantName: order.restaurantName };
  const text = dispatchNoticeText('DELIVERY_STATUS', metadata)!;
  const notice = await tx.notification.create({ data: { userId: order.userId, type: 'DELIVERY_STATUS', title: text.title, body: text.body, link: '/orders', metadata } });
  out.customerNotification(notice.id).customerOrder(order.id);
}
const courierName = (profile: { firstName: string; lastName: string } | null) => profile ? `${profile.firstName} ${profile.lastName}`.trim() : '';

// ---------------------------------------------------------------------------------------------
// Courier eligibility
// ---------------------------------------------------------------------------------------------

/** What the server currently allows. SUSPENDED blocks every mode. */
export function courierPermissions(profile: Pick<CourierProfile, 'approvalStatus'>, activeAffiliations: number) {
  if (profile.approvalStatus === 'SUSPENDED') return { restaurantMode: false, freelanceMode: false, reason: 'SUSPENDED' as string | null };
  const restaurantMode = activeAffiliations > 0, freelanceMode = profile.approvalStatus === 'APPROVED';
  return { restaurantMode, freelanceMode, reason: restaurantMode || freelanceMode ? null : 'NO_AFFILIATION_OR_APPROVAL' as string | null };
}
/** BUSY comes from a real accepted delivery; the client can never set it. */
export function courierAvailability(profile: Pick<CourierProfile, 'isAvailable'>, activeDeliveryId: string | null) {
  return activeDeliveryId ? 'BUSY' as const : profile.isAvailable ? 'AVAILABLE' as const : 'UNAVAILABLE' as const;
}
type CourierState = CourierProfile & { affiliatedRestaurantIds: string[]; activeDeliveryId: string | null };
async function readCourier(tx: Tx, courierId: string): Promise<CourierState | null> {
  const profile = await tx.courierProfile.findUnique({ where: { userId: courierId }, include: { affiliations: { where: { status: 'ACTIVE' }, select: { restaurantId: true } } } });
  if (!profile) return null;
  const active = await tx.delivery.findFirst({ where: { courierId, status: { in: ACTIVE_DELIVERY } }, select: { id: true } });
  const { affiliations, ...rest } = profile;
  return { ...rest, affiliatedRestaurantIds: affiliations.map(item => item.restaurantId), activeDeliveryId: active?.id ?? null };
}
/** Why this courier may not take work of `mode` from this restaurant right now, or null. */
function eligibilityError(courier: CourierState | null, mode: DeliveryMode, restaurant: { id: string; city: string; serviceZone: string | null }): ApiError | null {
  if (!courier) return new ApiError(404, 'COURIER_NOT_FOUND', 'Курьер не найден');
  if (courier.approvalStatus === 'SUSPENDED') return new ApiError(403, 'COURIER_SUSPENDED', 'Аккаунт курьера заблокирован');
  if (!courier.onboardingCompletedAt) return new ApiError(409, 'ONBOARDING_INCOMPLETE', 'Курьер не завершил регистрацию');
  if (mode === 'RESTAURANT_COURIER') {
    if (courier.workMode !== 'RESTAURANT') return new ApiError(409, 'WRONG_WORK_MODE', 'Курьер работает не в режиме «Свой ресторан»');
    if (!courier.affiliatedRestaurantIds.includes(restaurant.id)) return new ApiError(403, 'NOT_AFFILIATED', 'Курьер не привязан к этому ресторану');
  } else {
    if (courier.approvalStatus !== 'APPROVED') return new ApiError(403, 'NOT_APPROVED', 'Курьер не допущен к свободным доставкам UzBite');
    if (courier.workMode !== 'FREELANCE') return new ApiError(409, 'WRONG_WORK_MODE', 'Курьер работает не в режиме «Свободные доставки»');
    if (courier.city !== restaurant.city || (restaurant.serviceZone && courier.serviceZone !== restaurant.serviceZone)) return new ApiError(409, 'OUT_OF_AREA', 'Заказ находится вне рабочей зоны курьера');
  }
  if (!courier.isAvailable) return new ApiError(409, 'COURIER_UNAVAILABLE', 'Курьер сейчас недоступен');
  if (courier.activeDeliveryId) return new ApiError(409, 'COURIER_BUSY', 'У курьера уже есть активная доставка');
  return null;
}
/** Free couriers matched by configured city/zone (never GPS) who have not already handled this search. */
async function freeCandidates(tx: Tx, restaurant: { city: string; serviceZone: string | null }, deliveryId: string, among?: string[]) {
  const rows = await tx.courierProfile.findMany({
    where: {
      ...(among ? { userId: { in: among } } : {}),
      approvalStatus: 'APPROVED', workMode: 'FREELANCE', isAvailable: true, onboardingCompletedAt: { not: null },
      city: restaurant.city, ...(restaurant.serviceZone ? { serviceZone: restaurant.serviceZone } : {}),
      deliveries: { none: { status: { in: ACTIVE_DELIVERY } } },
      // A courier who already dropped this delivery is not offered it again.
      offers: { none: { deliveryId, OR: [{ status: 'PENDING' }, { status: 'ACCEPTED', releasedAt: { not: null } }] } },
    },
    select: { userId: true }, orderBy: { userId: 'asc' }, take: 200,
  });
  return rows.map(row => row.userId);
}

// ---------------------------------------------------------------------------------------------
// Offers lifecycle helpers (callers hold the needed locks)
// ---------------------------------------------------------------------------------------------

type OpenOffer = Pick<DeliveryOffer, 'id' | 'deliveryId' | 'courierId' | 'mode'>;

/** A personal-offer delivery with no open offer left goes back to the restaurant to choose again. */
async function returnIfNoPendingOffers(tx: Tx, out: Outbox, deliveryId: string, actor: DispatchActor, restaurantEvent: string | null, extra: Record<string, string> = {}) {
  const delivery = await tx.delivery.findUniqueOrThrow({ where: { id: deliveryId }, include: { order: { select: { restaurantName: true } } } });
  if (delivery.status !== 'OFFERED' || await tx.deliveryOffer.count({ where: { deliveryId, status: 'PENDING' } })) return;
  const updated = await tx.delivery.update({ where: { id: deliveryId }, data: { status: 'NOT_REQUESTED', mode: null, reward: null, version: nextVersion } });
  await audit(tx, deliveryId, 'RETURNED_TO_RESTAURANT', actor, { from: delivery.status, to: updated.status });
  if (restaurantEvent) await notifyRestaurant(tx, out, delivery.restaurantId, restaurantEvent, { deliveryId, orderId: delivery.orderId, restaurantName: delivery.order.restaurantName }, extra);
  signal(out, 'delivery:status_updated', updated);
}
/**
 * Closes open offers (their deliveries must be locked). Unless the caller resets the delivery itself,
 * a personal-offer delivery left without open offers goes back to the restaurant.
 */
async function closeOffers(tx: Tx, out: Outbox, offers: OpenOffer[], status: 'WITHDRAWN' | 'EXPIRED', reason: string, actor: DispatchActor, returnToRestaurant = true) {
  if (!offers.length) return;
  const at = new Date();
  await tx.deliveryOffer.updateMany({ where: { id: { in: offers.map(offer => offer.id) }, status: 'PENDING' }, data: status === 'WITHDRAWN' ? { status, releasedAt: at, releaseReason: reason } : { status } });
  for (const offer of offers) {
    await audit(tx, offer.deliveryId, status === 'WITHDRAWN' ? 'OFFER_WITHDRAWN' : 'OFFER_EXPIRED', actor, { offerId: offer.id, reason });
    out.courier(offer.courierId, status === 'WITHDRAWN' ? 'delivery:offer_withdrawn' : 'delivery:offer_expired', { offerId: offer.id, deliveryId: offer.deliveryId, reason });
  }
  if (!returnToRestaurant) return;
  for (const deliveryId of new Set(offers.filter(offer => offer.mode === 'RESTAURANT_COURIER').map(offer => offer.deliveryId))) {
    await returnIfNoPendingOffers(tx, out, deliveryId, actor, status === 'WITHDRAWN' ? 'OFFER_WITHDRAWN' : 'OFFER_EXPIRED');
  }
}
/** Pending offers of a courier, read before locking so their orders/deliveries can be locked first. */
async function pendingOffersOf(client: Tx, courierId: string, where: Prisma.DeliveryOfferWhereInput = {}) {
  return client.deliveryOffer.findMany({ where: { ...where, courierId, status: 'PENDING' }, select: { id: true, deliveryId: true, delivery: { select: { orderId: true } } } });
}
/** Under the lock, new pending offers for deliveries we did not lock force a clean retry. */
async function pendingOffersUnchanged(tx: Tx, courierId: string, before: { id: string }[], where: Prisma.DeliveryOfferWhereInput = {}) {
  const known = new Set(before.map(offer => offer.id));
  const now = await tx.deliveryOffer.findMany({ where: { ...where, courierId, status: 'PENDING' }, select: { id: true } });
  if (now.some(offer => !known.has(offer.id))) throw new RetryTransaction();
}
/** Releases the assigned courier before pickup; the delivery returns to the restaurant (readiness is kept). */
async function releaseCourier(tx: Tx, out: Outbox, delivery: Delivery, reason: string, actor: DispatchActor) {
  const courierId = delivery.courierId!;
  await tx.deliveryOffer.updateMany({ where: { deliveryId: delivery.id, courierId, status: 'ACCEPTED', releasedAt: null }, data: { releasedAt: new Date(), releaseReason: reason } });
  const updated = await tx.delivery.update({ where: { id: delivery.id }, data: { status: 'NOT_REQUESTED', courierId: null, mode: null, reward: null, assignedAt: null, version: nextVersion } });
  await audit(tx, delivery.id, 'COURIER_RELEASED', actor, { from: delivery.status, to: updated.status, reason });
  out.customerOrder(delivery.orderId);
  signal(out, 'delivery:cancelled', updated, { reason }, courierId);
  out.leave(courierId, `delivery:${delivery.id}`);
  return updated;
}
type LockedDelivery = Prisma.DeliveryGetPayload<{ include: { order: { include: { payment: true } } } }>;
/** Marks the delivery and order delivered, accrues the reward and closes leftover issues. */
async function finalizeDelivered(tx: Tx, out: Outbox, delivery: LockedDelivery, via: 'HANDOFF_CODE' | 'RESTAURANT_CONFIRMATION', actor: DispatchActor) {
  const at = new Date();
  const updated = await tx.delivery.update({ where: { id: delivery.id }, data: { status: 'DELIVERED', deliveredAt: at, closedAt: at, completedVia: via, rewardStatus: delivery.reward?.gt(0) ? 'ACCRUED' : 'NONE', version: nextVersion } });
  queueOrderUpdate(out, await applyOrderState(tx, delivery.orderId, 'DELIVERED'));
  await tx.deliveryIssue.updateMany({ where: { deliveryId: delivery.id, status: 'OPEN' }, data: { status: 'RESOLVED', resolution: 'SUPERSEDED_BY_DELIVERY', resolvedAt: at } });
  await audit(tx, delivery.id, 'DELIVERED', actor, { from: delivery.status, to: updated.status, reason: via });
  await notifyRestaurant(tx, out, delivery.restaurantId, 'DELIVERED', { deliveryId: delivery.id, orderId: delivery.orderId, restaurantName: delivery.order.restaurantName });
  signal(out, 'delivery:completed', updated, { completedVia: via });
  return updated;
}

// ---------------------------------------------------------------------------------------------
// DTO readers
// ---------------------------------------------------------------------------------------------

async function restaurantDelivery(client: Tx, deliveryId: string) {
  return restaurantDeliveryDto(await client.delivery.findUniqueOrThrow({ where: { id: deliveryId }, include: restaurantDeliveryInclude }));
}
async function courierDelivery(client: Tx, deliveryId: string, courierId: string) {
  return courierDeliveryDto(await client.delivery.findUniqueOrThrow({ where: { id: deliveryId }, include: courierDeliveryInclude }), courierId);
}
/** Open offers for the courier; expired ones are hidden even before the sweeper closes them. */
export async function listCourierOffers(courierId: string) {
  const at = new Date();
  const offers = await db.deliveryOffer.findMany({ where: { courierId, status: 'PENDING', expiresAt: { gt: at }, delivery: { status: { in: OPEN_FOR_OFFERS } } }, include: offerInclude, orderBy: { expiresAt: 'asc' } });
  return { serverTime: at.toISOString(), items: offers.map(offer => courierOfferDto(offer, at)) };
}
export async function getCourierOffer(courierId: string, offerId: string) {
  const offer = await db.deliveryOffer.findFirst({ where: { id: offerId, courierId }, include: offerInclude });
  assert(offer, 404, 'NOT_FOUND', 'Предложение не найдено');
  return courierOfferDto(offer);
}
export async function getCourierDelivery(courierId: string, deliveryId: string) {
  const delivery = await db.delivery.findFirst({ where: { id: deliveryId, courierId }, include: courierDeliveryInclude });
  assert(delivery, 404, 'NOT_FOUND', 'Доставка не найдена');
  return courierDeliveryDto(delivery, courierId);
}
export async function getActiveCourierDelivery(courierId: string) {
  const delivery = await db.delivery.findFirst({ where: { courierId, status: { in: ACTIVE_DELIVERY } }, include: courierDeliveryInclude });
  return delivery ? courierDeliveryDto(delivery, courierId) : null;
}
export async function getRestaurantDelivery(restaurantId: string, orderId: string) {
  const delivery = await db.delivery.findFirst({ where: { orderId, restaurantId }, include: restaurantDeliveryInclude });
  return delivery ? restaurantDeliveryDto(delivery) : null;
}

// ---------------------------------------------------------------------------------------------
// Restaurant: requesting a courier
// ---------------------------------------------------------------------------------------------

async function assertRestaurantOrder(restaurantId: string, orderId: string) {
  assert(await db.order.findFirst({ where: { id: orderId, restaurantId }, select: { id: true } }), 404, 'NOT_FOUND', 'Заказ не найден');
}
type LockedOrder = Prisma.OrderGetPayload<{ include: { restaurant: true; payment: true } }>;
async function lockedOrder(tx: Tx, orderId: string): Promise<LockedOrder> {
  await lockRows(tx, { orders: [orderId] });
  return tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { restaurant: true, payment: true } });
}
/** The order must be locked. Creates the delivery on the first courier request, with snapshots. */
async function ensureDelivery(tx: Tx, order: LockedOrder, actor: DispatchActor) {
  const existing = await tx.delivery.findUnique({ where: { orderId: order.id }, select: { id: true } });
  if (existing) {
    await lockRows(tx, { deliveries: [existing.id] });
    return tx.delivery.findUniqueOrThrow({ where: { id: existing.id } });
  }
  const address = jsonObject(order.addressSnapshot);
  const cash = order.payment?.method === 'CASH';
  const delivery = await tx.delivery.create({ data: {
    orderId: order.id, restaurantId: order.restaurantId,
    pickupSnapshot: { name: order.restaurant.name, addressText: order.restaurant.addressText, latitude: order.restaurant.latitude, longitude: order.restaurant.longitude, phone: order.restaurant.phone },
    dropoffSnapshot: {
      addressText: address.addressText ?? '', label: address.label ?? '', entrance: address.entrance ?? '', floor: address.floor ?? '', apartment: address.apartment ?? '', comment: address.comment ?? '',
      latitude: address.latitude ?? null, longitude: address.longitude ?? null, recipientName: order.recipientName, recipientPhone: order.recipientPhone,
    } as Prisma.InputJsonValue,
    handoffCode: handoffCode(), cashAmount: cash ? order.total : 0, cashStatus: cash ? 'PENDING' : 'NOT_APPLICABLE',
  } });
  await audit(tx, delivery.id, 'CREATED', actor, { to: delivery.status });
  return delivery;
}
function requireDispatchable(order: LockedOrder, delivery: Delivery) {
  assert(DISPATCHABLE_ORDER.includes(order.status), 409, 'ORDER_NOT_DISPATCHABLE', 'Курьера можно вызвать только для принятого и не завершённого заказа');
  assert(delivery.status === 'NOT_REQUESTED', 409, 'DISPATCH_IN_PROGRESS', 'Сначала отмените текущий поиск или назначение курьера');
}

/** Personal offer to one of the restaurant's own couriers. */
export async function offerToOwnCourier(restaurantId: string, orderId: string, input: { courierId: string; reward?: number | null }, actor: DispatchActor) {
  await assertRestaurantOrder(restaurantId, orderId);
  const reward = moneyInput(input.reward);
  return dispatchTx(async (tx, out) => {
    const order = await lockedOrder(tx, orderId);
    const delivery = await ensureDelivery(tx, order, actor);
    requireDispatchable(order, delivery);
    await lockRows(tx, { couriers: [input.courierId] });
    const problem = eligibilityError(await readCourier(tx, input.courierId), 'RESTAURANT_COURIER', order.restaurant);
    if (problem) throw problem;
    const expiresAt = new Date(Date.now() + env.DELIVERY_OFFER_TTL_SECONDS * 1000);
    const offer = await tx.deliveryOffer.create({ data: { deliveryId: delivery.id, courierId: input.courierId, mode: 'RESTAURANT_COURIER', reward, expiresAt } });
    const updated = await tx.delivery.update({ where: { id: delivery.id }, data: { status: 'OFFERED', mode: 'RESTAURANT_COURIER', version: nextVersion } });
    await audit(tx, delivery.id, 'OFFER_CREATED', actor, { from: delivery.status, to: updated.status, offerId: offer.id });
    await notifyCourier(tx, out, input.courierId, 'OFFER_CREATED', { deliveryId: delivery.id, orderId, restaurantName: order.restaurantName }, { offerId: offer.id });
    out.courier(input.courierId, 'delivery:offer_created', { offerId: offer.id, deliveryId: delivery.id, expiresAt: expiresAt.toISOString() });
    signal(out, 'delivery:status_updated', updated);
    return restaurantDelivery(tx, delivery.id);
  });
}

/** Free UzBite search: offers to every matching available courier; offers live as long as the search. */
export async function startFreeSearch(restaurantId: string, orderId: string, input: { reward?: number | null }, actor: DispatchActor) {
  await assertRestaurantOrder(restaurantId, orderId);
  const requestedReward = moneyInput(input.reward);
  return dispatchTx(async (tx, out) => {
    const order = await lockedOrder(tx, orderId);
    const delivery = await ensureDelivery(tx, order, actor);
    requireDispatchable(order, delivery);
    // Without an explicit amount the courier is offered the delivery fee the customer paid.
    const reward = requestedReward ?? order.deliveryFee;
    const startedAt = new Date(), expiresAt = new Date(startedAt.getTime() + env.DELIVERY_SEARCH_TTL_SECONDS * 1000);
    const candidates = await freeCandidates(tx, order.restaurant, delivery.id);
    await lockRows(tx, { couriers: candidates });
    const matched = candidates.length ? await freeCandidates(tx, order.restaurant, delivery.id, candidates) : [];
    const updated = await tx.delivery.update({ where: { id: delivery.id }, data: { status: 'SEARCHING', mode: 'UZBITE_COURIER', reward, searchStartedAt: startedAt, searchExpiresAt: expiresAt, version: nextVersion } });
    const offers = matched.length ? await tx.deliveryOffer.createManyAndReturn({ data: matched.map(courierId => ({ deliveryId: delivery.id, courierId, mode: 'UZBITE_COURIER' as const, reward, expiresAt })), select: { id: true, courierId: true } }) : [];
    await audit(tx, delivery.id, 'SEARCH_STARTED', actor, { from: delivery.status, to: updated.status, reason: `matched=${offers.length}` });
    for (const offer of offers) {
      await notifyCourier(tx, out, offer.courierId, 'OFFER_CREATED', { deliveryId: delivery.id, orderId, restaurantName: order.restaurantName }, { offerId: offer.id });
      out.courier(offer.courierId, 'delivery:offer_created', { offerId: offer.id, deliveryId: delivery.id, expiresAt: expiresAt.toISOString() });
    }
    signal(out, 'delivery:search_started', updated, { matchedCouriers: offers.length, searchExpiresAt: expiresAt.toISOString() });
    return restaurantDelivery(tx, delivery.id);
  });
}

/** A free courier who becomes available (or changes zone) during open searches receives their offers too. */
export async function matchCourierToOpenSearches(courierId: string) {
  const courier = await db.courierProfile.findUnique({ where: { userId: courierId } });
  if (!courier || courier.workMode !== 'FREELANCE' || !courier.isAvailable || courier.approvalStatus !== 'APPROVED' || !courier.onboardingCompletedAt) return 0;
  const searches = await db.delivery.findMany({
    where: { status: 'SEARCHING', searchExpiresAt: { gt: new Date() }, restaurant: { city: courier.city, OR: [{ serviceZone: null }, { serviceZone: courier.serviceZone }] } },
    select: { id: true, orderId: true }, orderBy: { searchStartedAt: 'asc' }, take: 20,
  });
  if (!searches.length) return 0;
  return dispatchTx(async (tx, out) => {
    await lockRows(tx, { orders: searches.map(item => item.orderId), deliveries: searches.map(item => item.id), couriers: [courierId] });
    const state = await readCourier(tx, courierId);
    let created = 0;
    for (const search of searches) {
      const delivery = await tx.delivery.findUniqueOrThrow({ where: { id: search.id }, include: { restaurant: { select: { id: true, city: true, serviceZone: true } }, order: { select: { restaurantName: true } }, offers: { where: { courierId }, select: { createdAt: true, status: true, releasedAt: true } } } });
      const at = new Date();
      if (delivery.status !== 'SEARCHING' || !delivery.searchExpiresAt || delivery.searchExpiresAt <= at) continue;
      // One offer per courier per search; a courier who dropped this delivery is not offered it again.
      if (delivery.offers.some(offer => (delivery.searchStartedAt && offer.createdAt >= delivery.searchStartedAt) || (offer.status === 'ACCEPTED' && offer.releasedAt))) continue;
      if (eligibilityError(state, 'UZBITE_COURIER', delivery.restaurant)) continue;
      const offer = await tx.deliveryOffer.create({ data: { deliveryId: delivery.id, courierId, mode: 'UZBITE_COURIER', reward: delivery.reward, expiresAt: delivery.searchExpiresAt } });
      await audit(tx, delivery.id, 'OFFER_CREATED', SYSTEM, { offerId: offer.id, reason: 'COURIER_BECAME_AVAILABLE' });
      await notifyCourier(tx, out, courierId, 'OFFER_CREATED', { deliveryId: delivery.id, orderId: delivery.orderId, restaurantName: delivery.order.restaurantName }, { offerId: offer.id });
      out.courier(courierId, 'delivery:offer_created', { offerId: offer.id, deliveryId: delivery.id, expiresAt: delivery.searchExpiresAt.toISOString() });
      created += 1;
    }
    return created;
  });
}

// ---------------------------------------------------------------------------------------------
// Courier: responding to offers
// ---------------------------------------------------------------------------------------------

function closedOfferError(status: string) {
  if (status === 'TAKEN') return new ApiError(409, 'OFFER_TAKEN', 'Этот заказ уже принят другим курьером');
  if (status === 'EXPIRED') return new ApiError(409, 'OFFER_EXPIRED', 'Время предложения истекло');
  if (status === 'REJECTED') return new ApiError(409, 'OFFER_REJECTED', 'Вы уже отклонили это предложение');
  return new ApiError(409, 'OFFER_WITHDRAWN', 'Предложение больше не действует');
}

/**
 * Atomic acceptance. Under the locks every condition is re-checked; the conditional update and the
 * one-active-delivery index guarantee that exactly one courier wins. Repeating the request after a
 * success returns the same assignment.
 */
export async function acceptOffer(courierId: string, offerId: string) {
  const actor: DispatchActor = { id: courierId, role: 'COURIER' };
  const target = await db.deliveryOffer.findFirst({ where: { id: offerId, courierId }, select: { deliveryId: true, delivery: { select: { orderId: true } } } });
  assert(target, 404, 'NOT_FOUND', 'Предложение не найдено');
  const pending = await pendingOffersOf(db, courierId);
  return dispatchTx(async (tx, out) => {
    await lockRows(tx, { orders: [target.delivery.orderId, ...pending.map(item => item.delivery.orderId)], deliveries: [target.deliveryId, ...pending.map(item => item.deliveryId)], couriers: [courierId] });
    await pendingOffersUnchanged(tx, courierId, pending);
    const offer = await tx.deliveryOffer.findUniqueOrThrow({ where: { id: offerId } });
    const delivery = await tx.delivery.findUniqueOrThrow({ where: { id: offer.deliveryId }, include: { order: true, restaurant: { select: { id: true, city: true, serviceZone: true } } } });
    if (offer.status === 'ACCEPTED' && !offer.releasedAt && delivery.courierId === courierId) return courierDelivery(tx, delivery.id, courierId);
    if (offer.status === 'TAKEN' || (delivery.courierId && delivery.courierId !== courierId)) throw closedOfferError('TAKEN');
    if (offer.status !== 'PENDING') throw closedOfferError(offer.status);
    if (offer.expiresAt <= new Date()) {
      await closeOffers(tx, out, [offer], 'EXPIRED', 'DEADLINE_PASSED', SYSTEM);
      return new CommittedFailure(closedOfferError('EXPIRED'));
    }
    if (!OPEN_FOR_OFFERS.includes(delivery.status) || !DISPATCHABLE_ORDER.includes(delivery.order.status)) {
      await closeOffers(tx, out, [offer], 'WITHDRAWN', 'DELIVERY_UNAVAILABLE', SYSTEM);
      return new CommittedFailure(new ApiError(409, 'OFFER_WITHDRAWN', 'Заказ больше недоступен'));
    }
    const courier = await readCourier(tx, courierId);
    const problem = eligibilityError(courier, offer.mode, delivery.restaurant);
    if (problem) throw problem;
    const at = new Date();
    let claimed: Prisma.BatchPayload;
    try {
      claimed = await tx.delivery.updateMany({
        where: { id: delivery.id, status: { in: OPEN_FOR_OFFERS }, courierId: null },
        data: { courierId, status: delivery.readyAt ? 'READY_FOR_PICKUP' : 'ASSIGNED', mode: offer.mode, reward: offer.reward, assignedAt: at, version: nextVersion },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ApiError(409, 'COURIER_BUSY', 'У вас уже есть активная доставка');
      throw error;
    }
    if (claimed.count !== 1) throw closedOfferError('TAKEN');
    await tx.deliveryOffer.update({ where: { id: offer.id }, data: { status: 'ACCEPTED', respondedAt: at } });
    const losers = await tx.deliveryOffer.findMany({ where: { deliveryId: delivery.id, status: 'PENDING' }, select: { id: true, courierId: true } });
    if (losers.length) await tx.deliveryOffer.updateMany({ where: { id: { in: losers.map(item => item.id) }, status: 'PENDING' }, data: { status: 'TAKEN' } });
    // One active delivery per courier: their other open offers are withdrawn.
    const others = await tx.deliveryOffer.findMany({ where: { courierId, status: 'PENDING', deliveryId: { not: delivery.id } } });
    await closeOffers(tx, out, others, 'WITHDRAWN', 'COURIER_BUSY', actor);
    const assigned = await tx.delivery.findUniqueOrThrow({ where: { id: delivery.id } });
    await audit(tx, delivery.id, 'COURIER_ASSIGNED', actor, { from: delivery.status, to: assigned.status, offerId: offer.id });
    const context = { deliveryId: delivery.id, orderId: delivery.orderId, restaurantName: delivery.order.restaurantName };
    await notifyRestaurant(tx, out, delivery.restaurantId, 'COURIER_ASSIGNED', context, { courierName: courierName(courier) });
    await notifyCustomerAssigned(tx, out, delivery.order);
    for (const loser of losers) out.courier(loser.courierId, 'delivery:offer_taken', { offerId: loser.id, deliveryId: delivery.id });
    out.courier(courierId, 'delivery:offer_accepted', { offerId: offer.id, deliveryId: delivery.id });
    signal(out, 'delivery:courier_assigned', assigned);
    return courierDelivery(tx, delivery.id, courierId);
  });
}

export async function rejectOffer(courierId: string, offerId: string, reason?: string | null) {
  const actor: DispatchActor = { id: courierId, role: 'COURIER' };
  const note = reasonText(reason, false);
  const target = await db.deliveryOffer.findFirst({ where: { id: offerId, courierId }, select: { deliveryId: true, delivery: { select: { orderId: true } } } });
  assert(target, 404, 'NOT_FOUND', 'Предложение не найдено');
  return dispatchTx(async (tx, out) => {
    await lockRows(tx, { orders: [target.delivery.orderId], deliveries: [target.deliveryId] });
    const offer = await tx.deliveryOffer.findUniqueOrThrow({ where: { id: offerId }, include: { delivery: { select: { restaurantId: true } } } });
    const read = async () => courierOfferDto(await tx.deliveryOffer.findUniqueOrThrow({ where: { id: offerId }, include: offerInclude }));
    if (offer.status === 'REJECTED') return read();
    if (offer.status !== 'PENDING') throw closedOfferError(offer.status);
    if (offer.expiresAt <= new Date()) {
      await closeOffers(tx, out, [offer], 'EXPIRED', 'DEADLINE_PASSED', SYSTEM);
      return read();
    }
    await tx.deliveryOffer.update({ where: { id: offerId }, data: { status: 'REJECTED', respondedAt: new Date(), rejectReason: note } });
    await audit(tx, offer.deliveryId, 'OFFER_REJECTED', actor, { offerId, reason: note });
    if (offer.mode === 'RESTAURANT_COURIER') {
      const profile = await tx.courierProfile.findUnique({ where: { userId: courierId }, select: { firstName: true, lastName: true } });
      await returnIfNoPendingOffers(tx, out, offer.deliveryId, actor, 'OFFER_REJECTED', { courierName: courierName(profile) });
    } else {
      out.restaurant(offer.delivery.restaurantId, 'delivery:offer_rejected', { offerId, deliveryId: offer.deliveryId });
    }
    return read();
  });
}

// ---------------------------------------------------------------------------------------------
// Pickup and handoff
// ---------------------------------------------------------------------------------------------

/** Restaurant marks the food ready. Allowed before a courier is assigned; readiness is kept in readyAt. */
export async function markReadyForPickup(restaurantId: string, orderId: string, actor: DispatchActor) {
  await assertRestaurantOrder(restaurantId, orderId);
  return dispatchTx(async (tx, out) => {
    const order = await lockedOrder(tx, orderId);
    assert(DISPATCHABLE_ORDER.includes(order.status), 409, 'ORDER_NOT_PREPARING', 'Готовым можно отметить только принятый заказ');
    if (order.status === 'ACCEPTED') queueOrderUpdate(out, await applyOrderState(tx, orderId, 'PREPARING'));
    const delivery = await ensureDelivery(tx, order, actor);
    if (delivery.readyAt) return restaurantDelivery(tx, delivery.id);
    assert(['NOT_REQUESTED', 'SEARCHING', 'OFFERED', 'ASSIGNED'].includes(delivery.status), 409, 'INVALID_DELIVERY_STATE', 'Действие недоступно для текущего статуса доставки');
    const updated = await tx.delivery.update({ where: { id: delivery.id }, data: { readyAt: new Date(), ...(delivery.status === 'ASSIGNED' ? { status: 'READY_FOR_PICKUP' } : {}), version: nextVersion } });
    await audit(tx, delivery.id, 'READY_FOR_PICKUP', actor, { from: delivery.status, to: updated.status });
    if (updated.courierId) await notifyCourier(tx, out, updated.courierId, 'READY_FOR_PICKUP', { deliveryId: delivery.id, orderId, restaurantName: order.restaurantName });
    signal(out, 'delivery:pickup_ready', updated);
    return restaurantDelivery(tx, delivery.id);
  });
}

/** Loads a delivery assigned to the courier under the canonical locks. */
async function courierTarget(courierId: string, deliveryId: string) {
  const target = await db.delivery.findFirst({ where: { id: deliveryId, courierId }, select: { orderId: true } });
  assert(target, 404, 'NOT_FOUND', 'Доставка не найдена');
  return target.orderId;
}
async function lockedCourierDelivery(tx: Tx, courierId: string, deliveryId: string, orderId: string): Promise<LockedDelivery> {
  await lockRows(tx, { orders: [orderId], deliveries: [deliveryId] });
  const delivery = await tx.delivery.findUniqueOrThrow({ where: { id: deliveryId }, include: { order: { include: { payment: true } } } });
  assert(delivery.courierId === courierId, 409, 'NOT_ASSIGNED', 'Эта доставка больше не назначена вам');
  return delivery;
}
const invalidState = () => new ApiError(409, 'INVALID_DELIVERY_STATE', 'Действие недоступно для текущего статуса доставки');

/** Courier confirms receiving the food; only after the restaurant marked it ready. */
export async function confirmPickup(courierId: string, deliveryId: string) {
  const actor: DispatchActor = { id: courierId, role: 'COURIER' };
  const orderId = await courierTarget(courierId, deliveryId);
  return dispatchTx(async (tx, out) => {
    const delivery = await lockedCourierDelivery(tx, courierId, deliveryId, orderId);
    if (AFTER_PICKUP.includes(delivery.status) || delivery.status === 'DELIVERED') return courierDelivery(tx, deliveryId, courierId);
    if (delivery.status === 'ASSIGNED') throw new ApiError(409, 'NOT_READY', 'Ресторан ещё не отметил заказ готовым к выдаче');
    if (delivery.status !== 'READY_FOR_PICKUP') throw invalidState();
    assert(delivery.order.status === 'PREPARING', 409, 'ORDER_NOT_READY', 'Заказ ещё не готов к выдаче');
    const updated = await tx.delivery.update({ where: { id: deliveryId }, data: { status: 'PICKED_UP', pickedUpAt: new Date(), version: nextVersion } });
    await audit(tx, deliveryId, 'PICKED_UP', actor, { from: delivery.status, to: updated.status });
    out.customerOrder(orderId);
    signal(out, 'delivery:picked_up', updated);
    return courierDelivery(tx, deliveryId, courierId);
  });
}

/** Courier leaves the restaurant: the customer's order becomes DELIVERING. Card orders must be PAID. */
export async function startDelivery(courierId: string, deliveryId: string) {
  const actor: DispatchActor = { id: courierId, role: 'COURIER' };
  const orderId = await courierTarget(courierId, deliveryId);
  return dispatchTx(async (tx, out) => {
    const delivery = await lockedCourierDelivery(tx, courierId, deliveryId, orderId);
    if (delivery.status === 'ON_THE_WAY' || delivery.status === 'DELIVERED') return courierDelivery(tx, deliveryId, courierId);
    if (delivery.status !== 'PICKED_UP') throw new ApiError(409, 'NOT_PICKED_UP', 'Сначала подтвердите получение заказа в ресторане');
    if (delivery.order.payment?.method === 'CARD') assert(delivery.order.payment.status === 'PAID', 409, 'PAYMENT_REQUIRED', 'Оплата картой ещё не подтверждена рестораном');
    queueOrderUpdate(out, await applyOrderState(tx, orderId, 'DELIVERING'));
    const updated = await tx.delivery.update({ where: { id: deliveryId }, data: { status: 'ON_THE_WAY', startedAt: new Date(), version: nextVersion } });
    await audit(tx, deliveryId, 'DELIVERY_STARTED', actor, { from: delivery.status, to: updated.status });
    signal(out, 'delivery:status_updated', updated);
    return courierDelivery(tx, deliveryId, courierId);
  });
}

export async function confirmCashCollected(courierId: string, deliveryId: string) {
  const actor: DispatchActor = { id: courierId, role: 'COURIER' };
  const orderId = await courierTarget(courierId, deliveryId);
  return dispatchTx(async (tx, out) => {
    const delivery = await lockedCourierDelivery(tx, courierId, deliveryId, orderId);
    assert(delivery.cashStatus !== 'NOT_APPLICABLE', 409, 'CASH_NOT_APPLICABLE', 'Этот заказ оплачен не наличными');
    if (delivery.cashStatus !== 'PENDING') return courierDelivery(tx, deliveryId, courierId);
    assert(delivery.status === 'ON_THE_WAY', 409, 'NOT_ON_THE_WAY', 'Наличные принимаются при передаче заказа покупателю');
    const updated = await tx.delivery.update({ where: { id: deliveryId }, data: { cashStatus: 'COLLECTED', cashCollectedAt: new Date(), cashCollectedById: courierId, version: nextVersion } });
    await audit(tx, deliveryId, 'CASH_COLLECTED', actor, { reason: delivery.cashAmount.toFixed(2) });
    signal(out, 'delivery:status_updated', updated);
    return courierDelivery(tx, deliveryId, courierId);
  });
}

/** Completion by the customer's 4-digit code. Wrong attempts are persisted even though the call fails. */
export async function completeDelivery(courierId: string, deliveryId: string, code: string) {
  const actor: DispatchActor = { id: courierId, role: 'COURIER' };
  assert(/^\d{4}$/.test(code), 400, 'HANDOFF_CODE_FORMAT', 'Код подтверждения состоит из 4 цифр');
  const orderId = await courierTarget(courierId, deliveryId);
  const result = await dispatchTx(async (tx, out) => {
    const delivery = await lockedCourierDelivery(tx, courierId, deliveryId, orderId);
    if (delivery.status === 'DELIVERED') return courierDelivery(tx, deliveryId, courierId);
    if (delivery.status !== 'ON_THE_WAY') throw new ApiError(409, 'NOT_ON_THE_WAY', 'Сначала начните доставку');
    assert(delivery.cashStatus !== 'PENDING', 409, 'CASH_NOT_CONFIRMED', 'Сначала подтвердите получение наличных');
    const locked = new ApiError(409, 'HANDOFF_LOCKED', 'Попытки ввода кода исчерпаны. Сообщите о проблеме с кодом — передачу подтвердит ресторан');
    if (delivery.handoffAttempts >= env.DELIVERY_HANDOFF_MAX_ATTEMPTS) throw locked;
    if (!codeMatches(code, delivery.handoffCode)) {
      const updated = await tx.delivery.update({ where: { id: deliveryId }, data: { handoffAttempts: { increment: 1 }, version: nextVersion } });
      await audit(tx, deliveryId, 'HANDOFF_CODE_REJECTED', actor, { reason: `attempt=${updated.handoffAttempts}` });
      const left = env.DELIVERY_HANDOFF_MAX_ATTEMPTS - updated.handoffAttempts;
      signal(out, 'delivery:status_updated', updated);
      return new CommittedFailure(left > 0 ? new ApiError(400, 'HANDOFF_CODE_INVALID', `Неверный код. Осталось попыток: ${left}`) : locked);
    }
    await finalizeDelivered(tx, out, delivery, 'HANDOFF_CODE', actor);
    return courierDelivery(tx, deliveryId, courierId);
  });
  await matchCourierToOpenSearches(courierId).catch(() => 0);
  return result;
}

// ---------------------------------------------------------------------------------------------
// Cancellation and issues
// ---------------------------------------------------------------------------------------------

async function openIssue(tx: Tx, out: Outbox, delivery: LockedDelivery, type: 'CANCELLATION_REQUEST' | 'HANDOFF_CODE_UNAVAILABLE', reason: string, actor: DispatchActor) {
  const existing = await tx.deliveryIssue.findFirst({ where: { deliveryId: delivery.id, type, status: 'OPEN' } });
  if (existing) return existing;
  const issue = await tx.deliveryIssue.create({ data: { deliveryId: delivery.id, courierId: delivery.courierId!, type, reason } });
  const updated = await tx.delivery.update({ where: { id: delivery.id }, data: { version: nextVersion } });
  await audit(tx, delivery.id, 'ISSUE_OPENED', actor, { reason: `${type}: ${reason}` });
  await notifyRestaurant(tx, out, delivery.restaurantId, 'ISSUE_OPENED', { deliveryId: delivery.id, orderId: delivery.orderId, restaurantName: delivery.order.restaurantName }, { issueId: issue.id, issueType: type });
  signal(out, 'delivery:issue_updated', updated, { issueId: issue.id, issueType: type, issueStatus: 'OPEN' });
  return issue;
}

/**
 * Before pickup the courier is released at once (with a reason) and the delivery returns to the
 * restaurant. After pickup the courier can only open a CANCELLATION_REQUEST for the restaurant.
 */
export async function requestCourierCancellation(courierId: string, deliveryId: string, reason: string) {
  const actor: DispatchActor = { id: courierId, role: 'COURIER' };
  const text = reasonText(reason, true)!;
  const orderId = await courierTarget(courierId, deliveryId);
  const result = await dispatchTx(async (tx, out) => {
    const delivery = await lockedCourierDelivery(tx, courierId, deliveryId, orderId);
    if (BEFORE_PICKUP.includes(delivery.status)) {
      await releaseCourier(tx, out, delivery, text, actor);
      const profile = await tx.courierProfile.findUnique({ where: { userId: courierId }, select: { firstName: true, lastName: true } });
      await notifyRestaurant(tx, out, delivery.restaurantId, 'COURIER_RELEASED', { deliveryId, orderId, restaurantName: delivery.order.restaurantName }, { courierName: courierName(profile) });
      return { outcome: 'RELEASED' as const, issueId: null, delivery: null };
    }
    if (!AFTER_PICKUP.includes(delivery.status)) throw invalidState();
    const issue = await openIssue(tx, out, delivery, 'CANCELLATION_REQUEST', text, actor);
    return { outcome: 'ISSUE_OPENED' as const, issueId: issue.id, delivery: await courierDelivery(tx, deliveryId, courierId) };
  });
  if (result.outcome === 'RELEASED') await matchCourierToOpenSearches(courierId).catch(() => 0);
  return result;
}

/** Customer cannot give the code: the restaurant confirms the handoff instead, with an audit trail. */
export async function reportHandoffProblem(courierId: string, deliveryId: string, reason: string) {
  const actor: DispatchActor = { id: courierId, role: 'COURIER' };
  const text = reasonText(reason, true)!;
  const orderId = await courierTarget(courierId, deliveryId);
  return dispatchTx(async (tx, out) => {
    const delivery = await lockedCourierDelivery(tx, courierId, deliveryId, orderId);
    if (delivery.status !== 'ON_THE_WAY') throw new ApiError(409, 'NOT_ON_THE_WAY', 'Проблему с кодом можно сообщить только во время доставки');
    const issue = await openIssue(tx, out, delivery, 'HANDOFF_CODE_UNAVAILABLE', text, actor);
    return { issueId: issue.id, delivery: await courierDelivery(tx, deliveryId, courierId) };
  });
}

/** Restaurant cancels the search or the assignment. After pickup only the issue procedure applies. */
export async function cancelDispatch(restaurantId: string, orderId: string, reason: string | null | undefined, actor: DispatchActor) {
  await assertRestaurantOrder(restaurantId, orderId);
  return dispatchTx(async (tx, out) => {
    await lockRows(tx, { orders: [orderId] });
    const existing = await tx.delivery.findUnique({ where: { orderId }, select: { id: true } });
    assert(existing, 409, 'NOTHING_TO_CANCEL', 'Курьер для этого заказа не запрашивался');
    await lockRows(tx, { deliveries: [existing.id] });
    const delivery = await tx.delivery.findUniqueOrThrow({ where: { id: existing.id }, include: { order: { include: { payment: true } } } });
    if (delivery.status === 'NOT_REQUESTED') return restaurantDelivery(tx, delivery.id);
    if (AFTER_PICKUP.includes(delivery.status)) throw new ApiError(409, 'USE_ISSUE_PROCEDURE', 'Курьер уже забрал заказ. Отмена возможна только через обращение курьера');
    if (OPEN_FOR_OFFERS.includes(delivery.status)) {
      const note = reasonText(reason, false);
      const offers = await tx.deliveryOffer.findMany({ where: { deliveryId: delivery.id, status: 'PENDING' } });
      await closeOffers(tx, out, offers, 'WITHDRAWN', 'RESTAURANT_CANCELLED', actor, false);
      const updated = await tx.delivery.update({ where: { id: delivery.id }, data: { status: 'NOT_REQUESTED', mode: null, reward: null, version: nextVersion } });
      await audit(tx, delivery.id, 'SEARCH_CANCELLED', actor, { from: delivery.status, to: updated.status, reason: note });
      signal(out, 'delivery:status_updated', updated);
      return restaurantDelivery(tx, delivery.id);
    }
    if (BEFORE_PICKUP.includes(delivery.status)) {
      const note = reasonText(reason, true)!;
      const courierId = delivery.courierId!;
      await releaseCourier(tx, out, delivery, note, actor);
      await notifyCourier(tx, out, courierId, 'RELEASED_BY_RESTAURANT', { deliveryId: delivery.id, orderId, restaurantName: delivery.order.restaurantName });
      return restaurantDelivery(tx, delivery.id);
    }
    throw new ApiError(409, 'DELIVERY_CLOSED', 'Доставка уже завершена');
  });
}

const ISSUE_RESOLUTIONS = { HANDOFF_CODE_UNAVAILABLE: ['CONFIRM_DELIVERED', 'REJECT'], CANCELLATION_REQUEST: ['APPROVE', 'REJECT'] } as const;
export type IssueResolution = 'CONFIRM_DELIVERED' | 'APPROVE' | 'REJECT';

/**
 * Restaurant decision on a courier issue, recorded with the deciding staff account.
 * HANDOFF_CODE_UNAVAILABLE: CONFIRM_DELIVERED completes the delivery without the code.
 * CANCELLATION_REQUEST: APPROVE fails the delivery and cancels the order (the food left the restaurant).
 */
export async function resolveIssue(restaurantId: string, issueId: string, input: { resolution: IssueResolution; note?: string | null }, actor: DispatchActor) {
  const note = reasonText(input.note, false);
  const target = await db.deliveryIssue.findFirst({ where: { id: issueId, delivery: { restaurantId } }, select: { deliveryId: true, delivery: { select: { orderId: true } } } });
  assert(target, 404, 'NOT_FOUND', 'Обращение не найдено');
  return dispatchTx(async (tx, out) => {
    await lockRows(tx, { orders: [target.delivery.orderId], deliveries: [target.deliveryId] });
    const issue = await tx.deliveryIssue.findUniqueOrThrow({ where: { id: issueId } });
    if (issue.status === 'RESOLVED') {
      assert(issue.resolution === input.resolution, 409, 'ISSUE_CLOSED', 'Обращение уже рассмотрено');
      return restaurantDelivery(tx, issue.deliveryId);
    }
    assert((ISSUE_RESOLUTIONS[issue.type] as readonly string[]).includes(input.resolution), 400, 'INVALID_RESOLUTION', 'Это решение не подходит для типа обращения');
    const delivery = await tx.delivery.findUniqueOrThrow({ where: { id: issue.deliveryId }, include: { order: { include: { payment: true } } } });
    const at = new Date();
    const context = { deliveryId: delivery.id, orderId: delivery.orderId, restaurantName: delivery.order.restaurantName };
    await tx.deliveryIssue.update({ where: { id: issueId }, data: { status: 'RESOLVED', resolution: input.resolution, resolutionNote: note, resolvedById: actor.id, resolvedAt: at } });
    await audit(tx, delivery.id, 'ISSUE_RESOLVED', actor, { reason: [`${issue.type}:${input.resolution}`, note].filter(Boolean).join(' — ') });
    if (input.resolution === 'CONFIRM_DELIVERED') {
      if (delivery.status !== 'ON_THE_WAY') throw new ApiError(409, 'NOT_ON_THE_WAY', 'Подтвердить передачу можно только во время доставки');
      assert(delivery.cashStatus !== 'PENDING', 409, 'CASH_NOT_CONFIRMED', 'Курьер ещё не подтвердил получение наличных');
      await finalizeDelivered(tx, out, delivery, 'RESTAURANT_CONFIRMATION', actor);
    } else if (input.resolution === 'APPROVE') {
      if (!AFTER_PICKUP.includes(delivery.status)) throw invalidState();
      await tx.deliveryOffer.updateMany({ where: { deliveryId: delivery.id, courierId: delivery.courierId!, status: 'ACCEPTED', releasedAt: null }, data: { releasedAt: at, releaseReason: 'CANCELLATION_APPROVED' } });
      const failed = await tx.delivery.update({ where: { id: delivery.id }, data: { status: 'FAILED', closedAt: at, closeReason: issue.reason, version: nextVersion } });
      await tx.deliveryIssue.updateMany({ where: { deliveryId: delivery.id, status: 'OPEN' }, data: { status: 'RESOLVED', resolution: 'SUPERSEDED_BY_CANCELLATION', resolvedAt: at } });
      queueOrderUpdate(out, await applyOrderState(tx, delivery.orderId, 'CANCELLED'));
      await audit(tx, delivery.id, 'DELIVERY_FAILED', actor, { from: delivery.status, to: failed.status, reason: issue.reason });
      signal(out, 'delivery:cancelled', failed);
      out.leave(delivery.courierId!, `delivery:${delivery.id}`);
    }
    await notifyCourier(tx, out, issue.courierId, 'ISSUE_RESOLVED', context, { issueId, issueType: issue.type, resolution: input.resolution });
    const current = input.resolution === 'REJECT' ? await tx.delivery.update({ where: { id: delivery.id }, data: { version: nextVersion } }) : await tx.delivery.findUniqueOrThrow({ where: { id: delivery.id } });
    signal(out, 'delivery:issue_updated', current, { issueId, issueType: issue.type, issueStatus: 'RESOLVED', resolution: input.resolution }, issue.courierId);
    return restaurantDelivery(tx, delivery.id);
  });
}

// ---------------------------------------------------------------------------------------------
// Money after delivery
// ---------------------------------------------------------------------------------------------

async function restaurantDeliveryTarget(restaurantId: string, deliveryId: string) {
  const target = await db.delivery.findFirst({ where: { id: deliveryId, restaurantId }, select: { orderId: true } });
  assert(target, 404, 'NOT_FOUND', 'Доставка не найдена');
  return target.orderId;
}

/** Courier handed the collected cash to the restaurant: cash SETTLED and the order payment PAID. */
export async function settleCash(restaurantId: string, deliveryId: string, actor: DispatchActor) {
  const orderId = await restaurantDeliveryTarget(restaurantId, deliveryId);
  return dispatchTx(async (tx, out) => {
    await lockRows(tx, { orders: [orderId], deliveries: [deliveryId] });
    const delivery = await tx.delivery.findUniqueOrThrow({ where: { id: deliveryId }, include: { order: { select: { restaurantName: true } } } });
    if (delivery.cashStatus === 'SETTLED') return restaurantDelivery(tx, deliveryId);
    assert(delivery.status === 'DELIVERED' && delivery.cashStatus === 'COLLECTED', 409, 'CASH_NOT_COLLECTED', 'Расчёт возможен после доставки и получения наличных курьером');
    const updated = await tx.delivery.update({ where: { id: deliveryId }, data: { cashStatus: 'SETTLED', cashSettledAt: new Date(), version: nextVersion } });
    queueOrderUpdate(out, await applyOrderState(tx, orderId, 'DELIVERED', 'PAID'));
    await audit(tx, deliveryId, 'CASH_SETTLED', actor, { reason: delivery.cashAmount.toFixed(2) });
    if (delivery.courierId) await notifyCourier(tx, out, delivery.courierId, 'CASH_SETTLED', { deliveryId, orderId, restaurantName: delivery.order.restaurantName });
    signal(out, 'delivery:status_updated', updated);
    return restaurantDelivery(tx, deliveryId);
  });
}

/** ACCRUED → CONFIRMED → PAID. "Paid" only records the restaurant's statement; UzBite moves no money. */
export async function advanceReward(restaurantId: string, deliveryId: string, to: 'CONFIRMED' | 'PAID', actor: DispatchActor) {
  const orderId = await restaurantDeliveryTarget(restaurantId, deliveryId);
  return dispatchTx(async (tx, out) => {
    await lockRows(tx, { orders: [orderId], deliveries: [deliveryId] });
    const delivery = await tx.delivery.findUniqueOrThrow({ where: { id: deliveryId }, include: { order: { select: { restaurantName: true } } } });
    if (delivery.rewardStatus === to || (to === 'CONFIRMED' && delivery.rewardStatus === 'PAID')) return restaurantDelivery(tx, deliveryId);
    const from = to === 'CONFIRMED' ? 'ACCRUED' : 'CONFIRMED';
    assert(delivery.status === 'DELIVERED' && delivery.rewardStatus === from, 409, 'INVALID_REWARD_TRANSITION', to === 'CONFIRMED' ? 'Подтвердить можно только начисленное вознаграждение' : 'Сначала подтвердите вознаграждение');
    const at = new Date();
    const updated = await tx.delivery.update({ where: { id: deliveryId }, data: to === 'CONFIRMED' ? { rewardStatus: to, rewardConfirmedAt: at, version: nextVersion } : { rewardStatus: to, rewardPaidAt: at, version: nextVersion } });
    await audit(tx, deliveryId, to === 'CONFIRMED' ? 'REWARD_CONFIRMED' : 'REWARD_PAID', actor, { reason: delivery.reward?.toFixed(2) ?? null });
    if (delivery.courierId) await notifyCourier(tx, out, delivery.courierId, to === 'CONFIRMED' ? 'REWARD_CONFIRMED' : 'REWARD_PAID', { deliveryId, orderId, restaurantName: delivery.order.restaurantName });
    signal(out, 'delivery:status_updated', updated);
    return restaurantDelivery(tx, deliveryId);
  });
}

// ---------------------------------------------------------------------------------------------
// Courier state: availability, work mode, area, affiliations, approval
// ---------------------------------------------------------------------------------------------

/** Why the courier cannot go online in the current mode, or null. The mode itself is only a preference. */
function readinessError(courier: Pick<CourierState, 'approvalStatus' | 'onboardingCompletedAt' | 'workMode' | 'serviceZone' | 'affiliatedRestaurantIds'>): ApiError | null {
  if (courier.approvalStatus === 'SUSPENDED') return new ApiError(403, 'COURIER_SUSPENDED', 'Аккаунт курьера заблокирован');
  if (!courier.onboardingCompletedAt) return new ApiError(409, 'ONBOARDING_INCOMPLETE', 'Сначала завершите регистрацию');
  if (!courier.workMode) return new ApiError(409, 'WORK_MODE_REQUIRED', 'Выберите режим работы');
  const permissions = courierPermissions(courier, courier.affiliatedRestaurantIds.length);
  if (courier.workMode === 'RESTAURANT') return permissions.restaurantMode ? null : new ApiError(403, 'MODE_NOT_ALLOWED', 'Режим «Свой ресторан» доступен после привязки к ресторану по коду приглашения');
  if (!permissions.freelanceMode) return new ApiError(403, 'MODE_NOT_ALLOWED', 'Свободные доставки доступны после допуска UzBite');
  return courier.serviceZone ? null : new ApiError(409, 'SERVICE_AREA_REQUIRED', 'Укажите город и район работы');
}

type Withdrawal = { reason: string; where?: Prisma.DeliveryOfferWhereInput };
/**
 * Applies a change to a courier under the canonical locks. Open offers matching `withdraw` (their
 * orders and deliveries are locked first) are withdrawn in the same transaction.
 */
export async function changeCourierState<T>(courierId: string, actor: DispatchActor, withdraw: Withdrawal | null, apply: (tx: Tx, out: Outbox, courier: CourierState) => Promise<T>): Promise<T> {
  const where = withdraw?.where ?? {};
  const pending = withdraw ? await pendingOffersOf(db, courierId, where) : [];
  return dispatchTx(async (tx, out) => {
    await lockRows(tx, { orders: pending.map(item => item.delivery.orderId), deliveries: pending.map(item => item.deliveryId), couriers: [courierId] });
    if (withdraw) await pendingOffersUnchanged(tx, courierId, pending, where);
    const courier = await readCourier(tx, courierId);
    assert(courier, 404, 'NOT_FOUND', 'Профиль курьера не найден');
    const result = await apply(tx, out, courier);
    if (withdraw) await closeOffers(tx, out, await tx.deliveryOffer.findMany({ where: { ...where, courierId, status: 'PENDING' } }), 'WITHDRAWN', withdraw.reason, actor);
    return result;
  });
}
async function updateCourierProfile(tx: Tx, out: Outbox, courierId: string, data: Prisma.CourierProfileUpdateInput) {
  const profile = await tx.courierProfile.update({ where: { userId: courierId }, data });
  out.courier(courierId, 'courier:profile_updated', { isAvailable: profile.isAvailable, workMode: profile.workMode, approvalStatus: profile.approvalStatus });
  return profile;
}
const asCourier = (courierId: string): DispatchActor => ({ id: courierId, role: 'COURIER' });

/** Going offline withdraws open offers; going online re-checks every permission on the server. */
export async function setCourierAvailability(courierId: string, available: boolean) {
  if (!available) return changeCourierState(courierId, asCourier(courierId), { reason: 'COURIER_UNAVAILABLE' }, (tx, out) => updateCourierProfile(tx, out, courierId, { isAvailable: false }));
  const profile = await changeCourierState(courierId, asCourier(courierId), null, async (tx, out, courier) => {
    const problem = readinessError(courier);
    if (problem) throw problem;
    return updateCourierProfile(tx, out, courierId, { isAvailable: true });
  });
  await matchCourierToOpenSearches(courierId).catch(() => 0);
  return profile;
}

/**
 * The work mode is chosen during onboarding, before any access exists; going online checks the
 * permission. Changing it withdraws open offers and keeps availability only if the new mode is ready.
 */
export async function setCourierWorkMode(courierId: string, mode: CourierWorkMode) {
  const current = await db.courierProfile.findUnique({ where: { userId: courierId } });
  assert(current, 404, 'NOT_FOUND', 'Профиль курьера не найден');
  if (current.workMode === mode) return current;
  const profile = await changeCourierState(courierId, asCourier(courierId), { reason: 'WORK_MODE_CHANGED' }, (tx, out, courier) => {
    assert(courier.approvalStatus !== 'SUSPENDED', 403, 'COURIER_SUSPENDED', 'Аккаунт курьера заблокирован');
    return updateCourierProfile(tx, out, courierId, { workMode: mode, isAvailable: courier.isAvailable && !readinessError({ ...courier, workMode: mode }) });
  });
  await matchCourierToOpenSearches(courierId).catch(() => 0);
  return profile;
}

/** Free-search offers from the old area are withdrawn; open searches in the new area are offered. */
export async function setCourierServiceArea(courierId: string, city: string, zone: string) {
  const current = await db.courierProfile.findUnique({ where: { userId: courierId } });
  assert(current, 404, 'NOT_FOUND', 'Профиль курьера не найден');
  if (current.city === city && current.serviceZone === zone) return current;
  const profile = await changeCourierState(courierId, asCourier(courierId), { reason: 'SERVICE_AREA_CHANGED', where: { mode: 'UZBITE_COURIER' } }, (tx, out) => updateCourierProfile(tx, out, courierId, { city, serviceZone: zone }));
  await matchCourierToOpenSearches(courierId).catch(() => 0);
  return profile;
}

/** Platform admission (developer CLI for now). Suspension withdraws every open offer and goes offline. */
export async function setCourierApproval(courierId: string, status: CourierApprovalStatus, options: { testAccount?: boolean } = {}) {
  const suspend = status === 'SUSPENDED';
  return changeCourierState(courierId, SYSTEM, suspend ? { reason: 'COURIER_SUSPENDED' } : null, (tx, out) => updateCourierProfile(tx, out, courierId, {
    approvalStatus: status, ...(suspend ? { isAvailable: false } : {}), ...(options.testAccount === undefined ? {} : { isTestAccount: options.testAccount }),
  }));
}

/**
 * Ends a restaurant affiliation, by the courier or by the restaurant. Personal offers from that
 * restaurant are withdrawn; without another affiliation a RESTAURANT-mode courier goes offline.
 */
export async function endAffiliation(affiliationId: string, owner: { courierId: string } | { restaurantId: string }, actor: DispatchActor) {
  const affiliation = await db.restaurantCourierAffiliation.findFirst({ where: { id: affiliationId, ...owner } });
  assert(affiliation, 404, 'NOT_FOUND', 'Привязка не найдена');
  const { courierId, restaurantId } = affiliation;
  return changeCourierState(courierId, actor, { reason: 'AFFILIATION_ENDED', where: { mode: 'RESTAURANT_COURIER', delivery: { restaurantId } } }, async (tx, out, courier) => {
    const current = await tx.restaurantCourierAffiliation.findUniqueOrThrow({ where: { id: affiliationId } });
    if (current.status === 'ENDED') return current;
    assert(!await tx.delivery.findFirst({ where: { courierId, restaurantId, status: { in: ACTIVE_DELIVERY } }, select: { id: true } }), 409, 'ACTIVE_DELIVERY', 'Сначала завершите текущую доставку этого ресторана');
    const ended = await tx.restaurantCourierAffiliation.update({ where: { id: affiliationId }, data: { status: 'ENDED', endedAt: new Date(), endedBy: actor.role } });
    const remaining = courier.affiliatedRestaurantIds.filter(id => id !== restaurantId).length;
    if (!remaining && courier.workMode === 'RESTAURANT' && courier.isAvailable) await updateCourierProfile(tx, out, courierId, { isAvailable: false });
    out.emit([`courier:${courierId}`, `restaurant:${restaurantId}`], 'courier:affiliation_updated', { affiliationId, restaurantId, courierId, status: 'ENDED' });
    return ended;
  });
}

// ---------------------------------------------------------------------------------------------
// Restaurant order handling
// ---------------------------------------------------------------------------------------------

async function restaurantOrder(client: Tx, orderId: string) {
  return restaurantOrderDto(await client.order.findUniqueOrThrow({ where: { id: orderId }, include: restaurantOrderInclude }));
}
export async function getRestaurantOrder(restaurantId: string, orderId: string) {
  const order = await db.order.findFirst({ where: { id: orderId, restaurantId }, include: restaurantOrderInclude });
  assert(order, 404, 'NOT_FOUND', 'Заказ не найден');
  return restaurantOrderDto(order);
}

/** Accept or start preparing. Order/payment rules (a card order must be PAID) come from applyOrderState. */
export async function advanceRestaurantOrder(restaurantId: string, orderId: string, to: 'ACCEPTED' | 'PREPARING') {
  await assertRestaurantOrder(restaurantId, orderId);
  return dispatchTx(async (tx, out) => {
    const order = await lockedOrder(tx, orderId);
    if (order.status !== to) {
      queueOrderUpdate(out, await applyOrderState(tx, orderId, to));
      out.restaurant(restaurantId, 'restaurant:order_updated', { orderId, status: to });
    }
    return restaurantOrder(tx, orderId);
  });
}

/** The restaurant's decision on a card transfer. A receipt screenshot never marks a payment PAID by itself. */
export async function decideCardPayment(restaurantId: string, orderId: string, input: { status: 'PAID' | 'REJECTED'; reason?: string | null }) {
  const reason = input.status === 'REJECTED' ? reasonText(input.reason, true)! : undefined;
  await assertRestaurantOrder(restaurantId, orderId);
  return dispatchTx(async (tx, out) => {
    const order = await lockedOrder(tx, orderId);
    assert(order.payment?.method === 'CARD', 409, 'NOT_CARD_PAYMENT', 'Подтверждение нужно только для оплаты картой');
    if (order.payment.status !== input.status) {
      queueOrderUpdate(out, await applyOrderState(tx, orderId, order.status, input.status, reason));
      out.restaurant(restaurantId, 'restaurant:order_updated', { orderId, paymentStatus: input.status });
    }
    return restaurantOrder(tx, orderId);
  });
}

/** Cancels an order before the courier picked it up. The reason is stored and shown to the customer. */
export async function cancelRestaurantOrder(restaurantId: string, orderId: string, reason: string, actor: DispatchActor) {
  const text = reasonText(reason, true)!;
  await assertRestaurantOrder(restaurantId, orderId);
  return dispatchTx(async (tx, out) => {
    const order = await lockedOrder(tx, orderId);
    if (order.status === 'CANCELLED') return restaurantOrder(tx, orderId);
    assert(['PENDING_ACCEPTANCE', 'ACCEPTED', 'PREPARING'].includes(order.status), 409, 'ORDER_NOT_CANCELLABLE', 'Заказ уже в пути или завершён');
    const existing = await tx.delivery.findUnique({ where: { orderId }, select: { id: true } });
    if (existing) {
      await lockRows(tx, { deliveries: [existing.id] });
      const delivery = await tx.delivery.findUniqueOrThrow({ where: { id: existing.id } });
      if (AFTER_PICKUP.includes(delivery.status)) throw new ApiError(409, 'USE_ISSUE_PROCEDURE', 'Курьер уже забрал заказ. Отмена возможна только через обращение курьера');
      const at = new Date();
      await closeOffers(tx, out, await tx.deliveryOffer.findMany({ where: { deliveryId: delivery.id, status: 'PENDING' } }), 'WITHDRAWN', 'ORDER_CANCELLED', actor, false);
      const formerCourier = delivery.courierId;
      if (formerCourier && BEFORE_PICKUP.includes(delivery.status)) {
        await tx.deliveryOffer.updateMany({ where: { deliveryId: delivery.id, courierId: formerCourier, status: 'ACCEPTED', releasedAt: null }, data: { releasedAt: at, releaseReason: text } });
        await notifyCourier(tx, out, formerCourier, 'RELEASED_BY_RESTAURANT', { deliveryId: delivery.id, orderId, restaurantName: order.restaurantName });
      }
      if (!['DELIVERED', 'FAILED', 'CANCELLED'].includes(delivery.status)) {
        const cancelled = await tx.delivery.update({ where: { id: delivery.id }, data: { status: 'CANCELLED', courierId: null, closedAt: at, closeReason: text, version: nextVersion } });
        await audit(tx, delivery.id, 'DELIVERY_CANCELLED', actor, { from: delivery.status, to: cancelled.status, reason: text });
        signal(out, 'delivery:cancelled', cancelled, { reason: text }, formerCourier);
        if (formerCourier) out.leave(formerCourier, `delivery:${delivery.id}`);
      }
    }
    queueOrderUpdate(out, await applyOrderState(tx, orderId, 'CANCELLED'));
    await tx.order.update({ where: { id: orderId }, data: { cancellationReason: text, cancelledAt: new Date() } });
    out.restaurant(restaurantId, 'restaurant:order_updated', { orderId, status: 'CANCELLED' });
    return restaurantOrder(tx, orderId);
  });
}

// ---------------------------------------------------------------------------------------------
// Deadlines (server time is the source of truth)
// ---------------------------------------------------------------------------------------------

async function expireSearch(deliveryId: string, orderId: string, at: Date) {
  return dispatchTx(async (tx, out) => {
    await lockRows(tx, { orders: [orderId], deliveries: [deliveryId] });
    const delivery = await tx.delivery.findUniqueOrThrow({ where: { id: deliveryId }, include: { order: { select: { restaurantName: true } } } });
    if (delivery.status !== 'SEARCHING' || !delivery.searchExpiresAt || delivery.searchExpiresAt > at) return 0;
    const offers = await tx.deliveryOffer.findMany({ where: { deliveryId, status: 'PENDING' } });
    await closeOffers(tx, out, offers, 'EXPIRED', 'SEARCH_EXPIRED', SYSTEM, false);
    const updated = await tx.delivery.update({ where: { id: deliveryId }, data: { status: 'NOT_REQUESTED', mode: null, reward: null, version: nextVersion } });
    await audit(tx, deliveryId, 'SEARCH_EXPIRED', SYSTEM, { from: delivery.status, to: updated.status });
    await notifyRestaurant(tx, out, delivery.restaurantId, 'SEARCH_EXPIRED', { deliveryId, orderId, restaurantName: delivery.order.restaurantName });
    signal(out, 'delivery:status_updated', updated);
    return 1;
  });
}
async function expireOffersOf(deliveryId: string, orderId: string, at: Date) {
  return dispatchTx(async (tx, out) => {
    await lockRows(tx, { orders: [orderId], deliveries: [deliveryId] });
    const offers = await tx.deliveryOffer.findMany({ where: { deliveryId, status: 'PENDING', expiresAt: { lte: at } } });
    await closeOffers(tx, out, offers, 'EXPIRED', 'DEADLINE_PASSED', SYSTEM);
    return offers.length;
  });
}

/** Closes due searches and offers. Idempotent and safe to run from several API processes. */
export async function runDispatchSweep(at = new Date()) {
  const stats = { searches: 0, offers: 0, failed: 0 };
  const searches = await db.delivery.findMany({ where: { status: 'SEARCHING', searchExpiresAt: { lte: at } }, select: { id: true, orderId: true }, take: 50 });
  for (const item of searches) {
    try { stats.searches += await expireSearch(item.id, item.orderId, at); } catch { stats.failed += 1; }
  }
  const offers = await db.deliveryOffer.findMany({ where: { status: 'PENDING', expiresAt: { lte: at } }, select: { deliveryId: true, delivery: { select: { orderId: true } } }, distinct: ['deliveryId'], take: 50 });
  for (const item of offers) {
    try { stats.offers += await expireOffersOf(item.deliveryId, item.delivery.orderId, at); } catch { stats.failed += 1; }
  }
  return stats;
}
export function startDispatchSweeper(intervalMs = 5000) {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    runDispatchSweep()
      .then(stats => { if (stats.failed) console.warn(`Dispatch sweep: ${stats.failed} item(s) will be retried.`); })
      .catch(() => console.warn('Dispatch sweep skipped: database unavailable.'))
      .finally(() => { running = false; });
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
