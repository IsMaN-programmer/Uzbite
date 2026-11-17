import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { CourierProfile, PaymentMethod } from '@prisma/client';
import { db } from '../apps/backend/src/config/database.js';
import { env } from '../apps/backend/src/config/env.js';
import { updateOrderState } from '../apps/backend/src/services/order-status.js';
import { customerOrderJson, orderInclude } from '../apps/backend/src/services/orders.js';
import * as dispatch from '../apps/backend/src/services/dispatch.js';
import { ApiError } from '../apps/backend/src/utils/errors.js';

// Service-level dispatch tests on the real PostgreSQL database. Test rows are removed afterwards;
// the demo catalog is only read (the restaurant zone is restored).
type Json = Record<string, unknown>;
const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
const RESTAURANT = 'rest-osh', OTHER_RESTAURANT = 'rest-basilico';
const userIds: string[] = [];
let staff: dispatch.DispatchActor, otherStaff: dispatch.DispatchActor;
let originalZone: string | null = null;

async function rejectsWith(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ApiError, `Expected ApiError ${code}, got ${String(error)}`);
    assert.equal(error.code, code, error.message);
    return true;
  });
}
async function makeUser(role: 'USER' | 'RESTAURANT' | 'COURIER', label: string) {
  const handle = `${label}_${suffix}`;
  const user = await db.user.create({ data: { email: `${handle}@example.test`, passwordHash: 'not-a-login-fixture', name: handle, username: handle, role } });
  userIds.push(user.id);
  return user.id;
}
async function makeStaff(restaurantId: string, label: string): Promise<dispatch.DispatchActor> {
  const id = await makeUser('RESTAURANT', label);
  await db.restaurantStaff.create({ data: { userId: id, restaurantId } });
  return { id, role: 'RESTAURANT' };
}
async function makeCourier(label: string, profile: Partial<Pick<CourierProfile, 'approvalStatus' | 'workMode' | 'isAvailable' | 'serviceZone' | 'onboardingCompletedAt'>> = {}) {
  const id = await makeUser('COURIER', label);
  await db.courierProfile.create({ data: { userId: id, firstName: label, lastName: 'Test', onboardingStep: 5, onboardingCompletedAt: new Date(), city: 'tashkent', ...profile } });
  return id;
}
async function affiliate(courierId: string, restaurantId = RESTAURANT) {
  await db.restaurantCourierAffiliation.create({ data: { restaurantId, courierId, invitedAt: new Date() } });
}
/** An accepted order of a fresh customer (one active order per customer is enforced by the database). */
async function makeOrder(method: PaymentMethod = 'CASH', restaurantId = RESTAURANT) {
  const customerId = await makeUser('USER', `customer${userIds.length}`);
  const restaurant = await db.restaurant.findUniqueOrThrow({ where: { id: restaurantId } });
  const dish = await db.dish.findFirstOrThrow({ where: { restaurantId }, orderBy: { id: 'asc' } });
  const order = await db.order.create({ data: {
    userId: customerId, restaurantId, restaurantName: restaurant.name, restaurantAddress: restaurant.addressText,
    addressSnapshot: { latitude: 41.3, longitude: 69.25, addressText: 'Dispatch test address', label: 'Test', entrance: '2', floor: '3', apartment: '14', comment: 'Ring twice' },
    recipientName: 'Dispatch Customer', recipientPhone: '+998901234567', subtotal: dish.price, deliveryFee: restaurant.deliveryFee, total: dish.price.add(restaurant.deliveryFee),
    items: { create: [{ dishId: dish.id, dishName: dish.name, unitPrice: dish.price, quantity: 1, imageUrl: dish.imageUrl }] },
    payment: { create: { method, status: method === 'CARD' ? 'PAID' : 'AWAITING_PAYMENT' } },
  } });
  await updateOrderState(order.id, 'ACCEPTED');
  return order.id;
}
const deliveryOf = (orderId: string) => db.delivery.findUniqueOrThrow({ where: { orderId } });
const offerFor = (courierId: string, deliveryId: string) => db.deliveryOffer.findFirstOrThrow({ where: { courierId, deliveryId }, orderBy: { createdAt: 'desc' } });
const customerView = async (orderId: string) => customerOrderJson(await db.order.findUniqueOrThrow({ where: { id: orderId }, include: orderInclude })) as { delivery: { status: string; handoffCode: string | null; courierAssigned: boolean } | null; status: string };
const wrongCode = (code: string) => String((Number(code) + 1) % 10_000).padStart(4, '0');
const eventTypes = async (deliveryId: string) => (await db.deliveryEvent.findMany({ where: { deliveryId }, orderBy: { createdAt: 'asc' } })).map(event => event.type);

before(async () => {
  originalZone = (await db.restaurant.findUniqueOrThrow({ where: { id: RESTAURANT } })).serviceZone;
  staff = await makeStaff(RESTAURANT, 'staff');
  otherStaff = await makeStaff(OTHER_RESTAURANT, 'otherstaff');
});
after(async () => {
  try {
    const orders = await db.order.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
    const orderIds = orders.map(order => order.id);
    await db.delivery.deleteMany({ where: { orderId: { in: orderIds } } });
    await db.restaurantCourierAffiliation.deleteMany({ where: { courierId: { in: userIds } } });
    await db.payment.deleteMany({ where: { orderId: { in: orderIds } } });
    await db.order.deleteMany({ where: { id: { in: orderIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.restaurant.update({ where: { id: RESTAURANT }, data: { serviceZone: originalZone } });
  } finally { await db.$disconnect(); }
});

test('Own courier: personal offer, accept, ready, pickup, start, cash, code, delivered, settlement and reward', async () => {
  const courier = await makeCourier('own', { workMode: 'RESTAURANT', isAvailable: true });
  await affiliate(courier);
  const orderId = await makeOrder('CASH');
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  await rejectsWith(dispatch.offerToOwnCourier(OTHER_RESTAURANT, orderId, { courierId: courier }, otherStaff), 'NOT_FOUND');
  const offered = await dispatch.offerToOwnCourier(RESTAURANT, orderId, { courierId: courier, reward: 15000 }, staff) as Json;
  assert.equal(offered.status, 'OFFERED');
  assert.equal('handoffCode' in offered, false, 'The restaurant never sees the handoff code');
  const { items } = await dispatch.listCourierOffers(courier);
  assert.equal(items.length, 1);
  const preview = items[0]!;
  assert.equal(preview.mode, 'RESTAURANT_COURIER');
  assert.equal(preview.order.cashToCollect, order.total.toNumber());
  assert.ok(preview.straightLineKm !== null && preview.straightLineKm > 0);
  for (const secret of ['Dispatch Customer', '+998901234567', 'Dispatch test address', 'Ring twice']) assert.equal(JSON.stringify(preview).includes(secret), false, `Offer leaks ${secret}`);

  const assigned = await dispatch.acceptOffer(courier, preview.id);
  assert.equal(assigned.status, 'ASSIGNED');
  assert.equal(assigned.dropoff?.recipientName, 'Dispatch Customer');
  assert.equal(assigned.dropoff?.apartment, '14');
  assert.equal(assigned.reward, 15000);
  assert.equal((await dispatch.acceptOffer(courier, preview.id)).id, assigned.id, 'Repeated acceptance is idempotent');
  const deliveryId = assigned.id;
  const { handoffCode } = await deliveryOf(orderId);
  assert.equal((await customerView(orderId)).delivery?.handoffCode, handoffCode, 'The customer sees the code once a courier is assigned');

  await rejectsWith(dispatch.confirmPickup(courier, deliveryId), 'NOT_READY');
  await rejectsWith(dispatch.startDelivery(courier, deliveryId), 'NOT_PICKED_UP');
  assert.equal((await dispatch.markReadyForPickup(RESTAURANT, orderId, staff) as Json).status, 'READY_FOR_PICKUP');
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status, 'PREPARING');
  assert.equal((await dispatch.confirmPickup(courier, deliveryId)).status, 'PICKED_UP');
  assert.equal((await dispatch.confirmPickup(courier, deliveryId)).status, 'PICKED_UP', 'Repeated pickup is idempotent');
  assert.equal((await dispatch.startDelivery(courier, deliveryId)).status, 'ON_THE_WAY');
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status, 'DELIVERING');

  await rejectsWith(dispatch.completeDelivery(courier, deliveryId, handoffCode), 'CASH_NOT_CONFIRMED');
  assert.equal((await dispatch.confirmCashCollected(courier, deliveryId)).cash.status, 'COLLECTED');
  await rejectsWith(dispatch.completeDelivery(courier, deliveryId, wrongCode(handoffCode)), 'HANDOFF_CODE_INVALID');
  assert.equal((await deliveryOf(orderId)).handoffAttempts, 1, 'A wrong attempt is persisted although the call failed');
  await rejectsWith(dispatch.completeDelivery(courier, deliveryId, '12a4'), 'HANDOFF_CODE_FORMAT');

  const done = await dispatch.completeDelivery(courier, deliveryId, handoffCode);
  assert.equal(done.status, 'DELIVERED');
  assert.equal(done.dropoff, null, 'Customer data is not served after completion');
  assert.equal(done.rewardStatus, 'ACCRUED');
  const customer = await customerView(orderId);
  assert.equal(customer.status, 'DELIVERED');
  assert.equal(customer.delivery?.handoffCode, null);
  assert.equal(await dispatch.getActiveCourierDelivery(courier), null);

  await rejectsWith(dispatch.advanceReward(RESTAURANT, deliveryId, 'PAID', staff), 'INVALID_REWARD_TRANSITION');
  await rejectsWith(dispatch.settleCash(OTHER_RESTAURANT, deliveryId, otherStaff), 'NOT_FOUND');
  assert.equal(((await dispatch.settleCash(RESTAURANT, deliveryId, staff)) as Json).cashStatus, 'SETTLED');
  assert.equal((await db.payment.findUniqueOrThrow({ where: { orderId } })).status, 'PAID');
  assert.equal(((await dispatch.advanceReward(RESTAURANT, deliveryId, 'CONFIRMED', staff)) as Json).rewardStatus, 'CONFIRMED');
  assert.equal(((await dispatch.advanceReward(RESTAURANT, deliveryId, 'PAID', staff)) as Json).rewardStatus, 'PAID');

  assert.deepEqual(await eventTypes(deliveryId), ['CREATED', 'OFFER_CREATED', 'COURIER_ASSIGNED', 'READY_FOR_PICKUP', 'PICKED_UP', 'DELIVERY_STARTED', 'CASH_COLLECTED', 'HANDOFF_CODE_REJECTED', 'DELIVERED', 'CASH_SETTLED', 'REWARD_CONFIRMED', 'REWARD_PAID']);
  const customerNotices = await db.notification.findMany({ where: { userId: order.userId } });
  assert.ok(customerNotices.some(notice => notice.type === 'DELIVERY_STATUS' && (notice.metadata as Json).event === 'COURIER_ASSIGNED'));
  assert.ok(customerNotices.some(notice => notice.type === 'ORDER_STATUS' && (notice.metadata as Json).status === 'DELIVERED'));
  const staffEvents = (await db.notification.findMany({ where: { userId: staff.id!, type: 'RESTAURANT_DELIVERY', metadata: { path: ['orderId'], equals: orderId } } })).map(notice => (notice.metadata as Json).event);
  assert.deepEqual(new Set(staffEvents), new Set(['COURIER_ASSIGNED', 'DELIVERED']));
  assert.equal((await db.notification.count({ where: { userId: otherStaff.id!, metadata: { path: ['orderId'], equals: orderId } } })), 0, 'Another restaurant is never notified');
});

test('Free search: zone matching, late availability and atomic acceptance by exactly one courier', async () => {
  await db.restaurant.update({ where: { id: RESTAURANT }, data: { serviceZone: 'mirabad' } });
  const free = { approvalStatus: 'APPROVED' as const, workMode: 'FREELANCE' as const, isAvailable: true, serviceZone: 'mirabad' };
  const first = await makeCourier('free_a', free), second = await makeCourier('free_b', free);
  const late = await makeCourier('free_late', { ...free, isAvailable: false });
  const elsewhere = await makeCourier('free_far', { ...free, serviceZone: 'chilanzar' });
  const unapproved = await makeCourier('free_pending', { ...free, approvalStatus: 'PENDING' });
  const freelancers = [first, second, late, elsewhere, unapproved];
  try {
    const orderId = await makeOrder('CASH');
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    const search = await dispatch.startFreeSearch(RESTAURANT, orderId, {}, staff) as Json;
    assert.equal(search.status, 'SEARCHING');
    assert.equal(search.reward, order.deliveryFee.toNumber(), 'Without an explicit amount the reward is the paid delivery fee');
    const deliveryId = search.id as string;
    const offered = await db.deliveryOffer.findMany({ where: { deliveryId } });
    assert.deepEqual(new Set(offered.map(offer => offer.courierId)), new Set([first, second]));
    assert.ok(offered.every(offer => offer.expiresAt.getTime() === (search.searchExpiresAt ? Date.parse(search.searchExpiresAt as string) : NaN)), 'Free-search offers live as long as the search');

    await dispatch.setCourierAvailability(late, true);
    assert.equal((await offerFor(late, deliveryId)).status, 'PENDING', 'A courier who became available during the search is offered it');

    const [a, b] = await Promise.all([offerFor(first, deliveryId), offerFor(second, deliveryId)]);
    const results = await Promise.allSettled([dispatch.acceptOffer(first, a.id), dispatch.acceptOffer(second, b.id)]);
    const won = results.filter(result => result.status === 'fulfilled');
    const lost = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    assert.equal(won.length, 1, 'Exactly one courier wins the race');
    assert.ok(lost[0]!.reason instanceof ApiError && lost[0]!.reason.code === 'OFFER_TAKEN', String(lost[0]!.reason));
    assert.equal(lost[0]!.reason.message, 'Этот заказ уже принят другим курьером');
    const winner = results[0]!.status === 'fulfilled' ? first : second, loser = winner === first ? second : first;
    const delivery = await deliveryOf(orderId);
    assert.equal(delivery.courierId, winner);
    assert.equal(delivery.mode, 'UZBITE_COURIER');
    assert.equal((await offerFor(loser, deliveryId)).status, 'TAKEN');
    assert.equal((await offerFor(late, deliveryId)).status, 'TAKEN');
    assert.equal((await dispatch.listCourierOffers(loser)).items.length, 0);
    assert.equal(((await dispatch.getRestaurantDelivery(RESTAURANT, orderId)) as { courier: { id: string } }).courier.id, winner);
    await rejectsWith(dispatch.acceptOffer(loser, (await offerFor(loser, deliveryId)).id), 'OFFER_TAKEN');
  } finally {
    for (const courierId of freelancers) await dispatch.setCourierAvailability(courierId, false);
    await db.restaurant.update({ where: { id: RESTAURANT }, data: { serviceZone: originalZone } });
  }
});

test('Deadlines use server time: expired personal offers and searches return to the restaurant', async () => {
  const own = await makeCourier('exp_own', { workMode: 'RESTAURANT', isAvailable: true });
  await affiliate(own);
  const orderId = await makeOrder('CASH');
  await dispatch.offerToOwnCourier(RESTAURANT, orderId, { courierId: own }, staff);
  const { id: deliveryId } = await deliveryOf(orderId);
  const stale = await offerFor(own, deliveryId);
  await db.deliveryOffer.update({ where: { id: stale.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await dispatch.listCourierOffers(own)).items.length, 0, 'An expired offer is hidden before any sweep');
  await rejectsWith(dispatch.acceptOffer(own, stale.id), 'OFFER_EXPIRED');
  assert.equal((await offerFor(own, deliveryId)).status, 'EXPIRED', 'The expiry is persisted although acceptance failed');
  assert.equal((await deliveryOf(orderId)).status, 'NOT_REQUESTED');

  await dispatch.offerToOwnCourier(RESTAURANT, orderId, { courierId: own }, staff);
  const swept = await dispatch.runDispatchSweep(new Date(Date.now() + (env.DELIVERY_OFFER_TTL_SECONDS + 1) * 1000));
  assert.ok(swept.offers >= 1);
  assert.equal((await offerFor(own, deliveryId)).status, 'EXPIRED');
  assert.equal((await deliveryOf(orderId)).status, 'NOT_REQUESTED');
  assert.ok(await db.notification.count({ where: { userId: staff.id!, metadata: { path: ['event'], equals: 'OFFER_EXPIRED' } } }));

  const free = await makeCourier('exp_free', { approvalStatus: 'APPROVED', workMode: 'FREELANCE', isAvailable: true, serviceZone: 'yunusabad' });
  try {
    await dispatch.startFreeSearch(RESTAURANT, orderId, { reward: 20000 }, staff);
    const freeOffer = await offerFor(free, deliveryId);
    assert.equal(freeOffer.reward?.toNumber(), 20000);
    const expired = await dispatch.runDispatchSweep(new Date(Date.now() + (env.DELIVERY_SEARCH_TTL_SECONDS + 1) * 1000));
    assert.ok(expired.searches >= 1);
    assert.equal((await deliveryOf(orderId)).status, 'NOT_REQUESTED');
    assert.equal((await offerFor(free, deliveryId)).status, 'EXPIRED');
    assert.ok(await db.notification.count({ where: { userId: staff.id!, metadata: { path: ['event'], equals: 'SEARCH_EXPIRED' } } }));
    await rejectsWith(dispatch.acceptOffer(free, freeOffer.id), 'OFFER_EXPIRED');
    assert.deepEqual((await eventTypes(deliveryId)).filter(type => type.includes('EXPIRED')), ['OFFER_EXPIRED', 'OFFER_EXPIRED', 'OFFER_EXPIRED', 'SEARCH_EXPIRED']);
  } finally { await dispatch.setCourierAvailability(free, false); }
});

test('Rejection and cancellation by restaurant and courier, before and after pickup', async () => {
  const own = await makeCourier('cancel_own', { workMode: 'RESTAURANT', isAvailable: true });
  await affiliate(own);
  const orderId = await makeOrder('CASH');
  await dispatch.offerToOwnCourier(RESTAURANT, orderId, { courierId: own }, staff);
  const { id: deliveryId } = await deliveryOf(orderId);
  await dispatch.rejectOffer(own, (await offerFor(own, deliveryId)).id, 'Далеко от меня');
  assert.equal((await deliveryOf(orderId)).status, 'NOT_REQUESTED', 'A rejected personal offer returns the order to the restaurant');
  assert.equal((await offerFor(own, deliveryId)).rejectReason, 'Далеко от меня');
  assert.ok(await db.notification.count({ where: { userId: staff.id!, metadata: { path: ['event'], equals: 'OFFER_REJECTED' } } }));

  await dispatch.offerToOwnCourier(RESTAURANT, orderId, { courierId: own }, staff);
  await rejectsWith(dispatch.offerToOwnCourier(RESTAURANT, orderId, { courierId: own }, staff), 'DISPATCH_IN_PROGRESS');
  await dispatch.cancelDispatch(RESTAURANT, orderId, null, staff);
  assert.equal((await offerFor(own, deliveryId)).status, 'WITHDRAWN');
  assert.equal((await deliveryOf(orderId)).status, 'NOT_REQUESTED');

  await dispatch.offerToOwnCourier(RESTAURANT, orderId, { courierId: own }, staff);
  await dispatch.acceptOffer(own, (await offerFor(own, deliveryId)).id);
  await rejectsWith(dispatch.cancelDispatch(RESTAURANT, orderId, '', staff), 'REASON_REQUIRED');
  await dispatch.cancelDispatch(RESTAURANT, orderId, 'Передаём другому курьеру', staff);
  const released = await offerFor(own, deliveryId);
  assert.equal(released.releaseReason, 'Передаём другому курьеру');
  assert.equal((await deliveryOf(orderId)).courierId, null);
  assert.equal((await customerView(orderId)).delivery?.handoffCode, null, 'Without a courier the code is hidden again');

  await dispatch.offerToOwnCourier(RESTAURANT, orderId, { courierId: own }, staff);
  await dispatch.acceptOffer(own, (await offerFor(own, deliveryId)).id);
  await rejectsWith(dispatch.requestCourierCancellation(own, deliveryId, 'x'), 'REASON_REQUIRED');
  const dropped = await dispatch.requestCourierCancellation(own, deliveryId, 'Сломался велосипед');
  assert.equal(dropped.outcome, 'RELEASED');
  assert.equal((await deliveryOf(orderId)).status, 'NOT_REQUESTED');
  assert.ok(await db.notification.count({ where: { userId: staff.id!, metadata: { path: ['event'], equals: 'COURIER_RELEASED' } } }));

  await dispatch.markReadyForPickup(RESTAURANT, orderId, staff);
  await dispatch.offerToOwnCourier(RESTAURANT, orderId, { courierId: own }, staff);
  const ready = await dispatch.acceptOffer(own, (await offerFor(own, deliveryId)).id);
  assert.equal(ready.status, 'READY_FOR_PICKUP', 'Readiness marked before assignment is kept');
  await dispatch.confirmPickup(own, deliveryId);
  await rejectsWith(dispatch.cancelDispatch(RESTAURANT, orderId, 'Слишком поздно', staff), 'USE_ISSUE_PROCEDURE');
  const request = await dispatch.requestCourierCancellation(own, deliveryId, 'ДТП, заказ повреждён');
  assert.equal(request.outcome, 'ISSUE_OPENED');
  assert.equal((await dispatch.requestCourierCancellation(own, deliveryId, 'ДТП, заказ повреждён')).issueId, request.issueId, 'One open request per type');
  assert.equal((await deliveryOf(orderId)).status, 'PICKED_UP', 'After pickup the courier cannot drop the order alone');
  await rejectsWith(dispatch.resolveIssue(OTHER_RESTAURANT, request.issueId!, { resolution: 'APPROVE' }, otherStaff), 'NOT_FOUND');
  await rejectsWith(dispatch.resolveIssue(RESTAURANT, request.issueId!, { resolution: 'CONFIRM_DELIVERED' }, staff), 'INVALID_RESOLUTION');
  await dispatch.resolveIssue(RESTAURANT, request.issueId!, { resolution: 'APPROVE', note: 'Курьер вернул заказ' }, staff);
  const failed = await deliveryOf(orderId);
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.closeReason, 'ДТП, заказ повреждён');
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status, 'CANCELLED');
  const issue = await db.deliveryIssue.findUniqueOrThrow({ where: { id: request.issueId! } });
  assert.equal(issue.resolvedById, staff.id);
  assert.equal(issue.resolutionNote, 'Курьер вернул заказ');
  assert.equal(await dispatch.getActiveCourierDelivery(own), null);
});

test('Security and limits: foreign access, eligibility, one active delivery, handoff limit and fallback', async () => {
  const own = await makeCourier('sec_own', { workMode: 'RESTAURANT', isAvailable: true });
  const stranger = await makeCourier('sec_stranger', { workMode: 'RESTAURANT', isAvailable: true });
  await affiliate(own); await affiliate(stranger, OTHER_RESTAURANT);
  const orderA = await makeOrder('CASH'), orderB = await makeOrder('CARD');
  await rejectsWith(dispatch.offerToOwnCourier(RESTAURANT, orderA, { courierId: stranger }, staff), 'NOT_AFFILIATED');
  await rejectsWith(dispatch.offerToOwnCourier(RESTAURANT, orderA, { courierId: staff.id! }, staff), 'COURIER_NOT_FOUND');
  await rejectsWith(dispatch.offerToOwnCourier(RESTAURANT, orderA, { courierId: own, reward: -5 }, staff), 'INVALID_REWARD');
  await dispatch.offerToOwnCourier(RESTAURANT, orderA, { courierId: own }, staff);
  const { id: deliveryId } = await deliveryOf(orderA);
  const offerA = await offerFor(own, deliveryId);
  await rejectsWith(dispatch.acceptOffer(stranger, offerA.id), 'NOT_FOUND');
  await dispatch.acceptOffer(own, offerA.id);
  await rejectsWith(dispatch.getCourierDelivery(stranger, deliveryId), 'NOT_FOUND');
  await rejectsWith(dispatch.confirmPickup(stranger, deliveryId), 'NOT_FOUND');
  await rejectsWith(dispatch.markReadyForPickup(OTHER_RESTAURANT, orderA, otherStaff), 'NOT_FOUND');
  await rejectsWith(dispatch.offerToOwnCourier(RESTAURANT, orderB, { courierId: own }, staff), 'COURIER_BUSY');
  assert.equal((await dispatch.getActiveCourierDelivery(own))?.id, deliveryId);

  await dispatch.markReadyForPickup(RESTAURANT, orderA, staff);
  await dispatch.confirmPickup(own, deliveryId);
  await dispatch.startDelivery(own, deliveryId);
  await dispatch.confirmCashCollected(own, deliveryId);
  const { handoffCode } = await deliveryOf(orderA);
  for (let attempt = 1; attempt < env.DELIVERY_HANDOFF_MAX_ATTEMPTS; attempt += 1) await rejectsWith(dispatch.completeDelivery(own, deliveryId, wrongCode(handoffCode)), 'HANDOFF_CODE_INVALID');
  await rejectsWith(dispatch.completeDelivery(own, deliveryId, wrongCode(handoffCode)), 'HANDOFF_LOCKED');
  await rejectsWith(dispatch.completeDelivery(own, deliveryId, handoffCode), 'HANDOFF_LOCKED');
  assert.equal((await deliveryOf(orderA)).handoffAttempts, env.DELIVERY_HANDOFF_MAX_ATTEMPTS);
  const problem = await dispatch.reportHandoffProblem(own, deliveryId, 'Покупатель не видит код в приложении');
  await dispatch.resolveIssue(RESTAURANT, problem.issueId, { resolution: 'CONFIRM_DELIVERED', note: 'Покупатель подтвердил по телефону' }, staff);
  const confirmed = await deliveryOf(orderA);
  assert.equal(confirmed.status, 'DELIVERED');
  assert.equal(confirmed.completedVia, 'RESTAURANT_CONFIRMATION');
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: orderA } })).status, 'DELIVERED');

  const suspended = await makeCourier('sec_suspended', { workMode: 'RESTAURANT', isAvailable: true });
  await affiliate(suspended);
  await dispatch.offerToOwnCourier(RESTAURANT, orderB, { courierId: suspended }, staff);
  const deliveryB = (await deliveryOf(orderB)).id;
  // A status changed behind the courier's back is caught at acceptance time.
  await db.courierProfile.update({ where: { userId: suspended }, data: { approvalStatus: 'SUSPENDED' } });
  await rejectsWith(dispatch.acceptOffer(suspended, (await offerFor(suspended, deliveryB)).id), 'COURIER_SUSPENDED');
  await rejectsWith(dispatch.setCourierAvailability(suspended, true), 'COURIER_SUSPENDED');
  const blocked = await dispatch.setCourierApproval(suspended, 'SUSPENDED');
  assert.equal(blocked.isAvailable, false);
  assert.equal((await offerFor(suspended, deliveryB)).status, 'WITHDRAWN');
  assert.equal((await deliveryOf(orderB)).status, 'NOT_REQUESTED');

  // The work mode is a preference; going online checks the permission for it.
  const newcomer = await makeCourier('sec_new', { approvalStatus: 'PENDING' });
  await rejectsWith(dispatch.setCourierAvailability(newcomer, true), 'WORK_MODE_REQUIRED');
  await dispatch.setCourierWorkMode(newcomer, 'FREELANCE');
  await rejectsWith(dispatch.setCourierAvailability(newcomer, true), 'MODE_NOT_ALLOWED');
  assert.equal((await dispatch.setCourierWorkMode(newcomer, 'RESTAURANT')).workMode, 'RESTAURANT');
  await rejectsWith(dispatch.setCourierAvailability(newcomer, true), 'MODE_NOT_ALLOWED');
  await affiliate(newcomer);
  await dispatch.setCourierAvailability(newcomer, true);
  await dispatch.offerToOwnCourier(RESTAURANT, orderB, { courierId: newcomer }, staff);
  await dispatch.setCourierAvailability(newcomer, false);
  assert.equal((await offerFor(newcomer, deliveryB)).status, 'WITHDRAWN', 'Going offline withdraws open offers');
  assert.equal((await deliveryOf(orderB)).status, 'NOT_REQUESTED');

  // Acceptance racing the courier going offline ends in one consistent state (no deadlock, no half state).
  await dispatch.setCourierAvailability(newcomer, true);
  await dispatch.offerToOwnCourier(RESTAURANT, orderB, { courierId: newcomer }, staff);
  const racing = await offerFor(newcomer, deliveryB);
  const [accepted] = await Promise.allSettled([dispatch.acceptOffer(newcomer, racing.id), dispatch.setCourierAvailability(newcomer, false)]);
  const after = await deliveryOf(orderB), offerAfter = await offerFor(newcomer, deliveryB);
  if (accepted.status === 'fulfilled') {
    assert.equal(after.courierId, newcomer); assert.equal(offerAfter.status, 'ACCEPTED');
  } else {
    assert.equal(after.status, 'NOT_REQUESTED'); assert.equal(offerAfter.status, 'WITHDRAWN');
  }
});
