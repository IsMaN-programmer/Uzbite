import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { io, type Socket } from 'socket.io-client';
import type { AuthTokens, CourierAccount, CourierDelivery, CourierEarnings, CourierHistoryItem, CourierOffer, DeliverySocketHint } from '@uzbite/shared';
import { db } from '../apps/backend/src/config/database.js';

// REST tests of the courier and restaurant APIs against the running API and real PostgreSQL.
// Staff accounts and courier admission go through the real developer CLIs. Test rows are removed.
const base = process.env.TEST_BASE_URL ?? 'http://localhost:8081';
const origin = process.env.TEST_ORIGIN ?? 'http://localhost:8080';
const root = resolve(import.meta.dirname, '..');
const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
const password = `Courier_${suffix}!`;
const emailOf = (label: string) => `${label}_${suffix}@example.test`;
type Json = Record<string, unknown>;
type Reply<T> = { status: number; data: T; error?: { code: string; message: string }; serverTime?: string };

/** A native-app client: Bearer tokens in JSON, never cookies. */
class AppClient {
  tokens: AuthTokens | null = null;
  async request<T = Json>(method: string, path: string, body?: unknown, auth = true): Promise<Reply<T>> {
    const headers: Record<string, string> = { 'X-UzBite-Client': 'app' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && this.tokens) headers.Authorization = `Bearer ${this.tokens.accessToken}`;
    const response = await fetch(`${base}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const payload = await response.json() as { data: T; error?: { code: string; message: string }; serverTime?: string };
    return { status: response.status, data: payload.data, error: payload.error, serverTime: payload.serverTime };
  }
  async login(kind: 'courier' | 'restaurant', email: string, secret = password) {
    const reply = await this.request<{ tokens: AuthTokens }>('POST', `/${kind}/auth/login`, { email, password: secret }, false);
    assert.equal(reply.status, 200, JSON.stringify(reply.error));
    this.tokens = reply.data.tokens;
    return reply;
  }
}
/** The customer web client: HttpOnly cookies and CSRF. */
class BrowserSession {
  cookies = new Map<string, string>();
  csrf = '';
  cookieHeader() { return [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; '); }
  async request<T = Json>(method: string, path: string, body?: unknown): Promise<Reply<T>> {
    const response = await fetch(`${base}/api${path}`, { method, headers: { Origin: origin, Cookie: this.cookieHeader(), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(method === 'GET' ? {} : { 'X-CSRF-Token': this.csrf }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const cookie of response.headers.getSetCookie()) { const [pair] = cookie.split(';'); const index = pair!.indexOf('='); this.cookies.set(pair!.slice(0, index), pair!.slice(index + 1)); }
    const payload = await response.json() as { data: T; error?: { code: string; message: string } };
    return { status: response.status, data: payload.data, error: payload.error };
  }
  async register(label: string) {
    this.csrf = (await this.request<{ csrfToken: string }>('GET', '/auth/csrf')).data.csrfToken;
    assert.equal((await this.request('POST', '/auth/register', { email: emailOf(label), password })).status, 201);
  }
}
const run = promisify(execFile);
async function cli(script: string, ...args: string[]) {
  const { stdout } = await run(process.execPath, [resolve(root, 'node_modules/tsx/dist/cli.mjs'), resolve(root, `apps/backend/src/scripts/${script}`), ...args], { cwd: root });
  return stdout;
}
async function makeStaff(slug: string, label: string) {
  const output = await cli('restaurant-staff.ts', slug, emailOf(label));
  const secret = /Password \(shown once, store it securely\): (\S+)/.exec(output)?.[1];
  assert.ok(secret, 'The CLI prints the generated password once');
  const client = new AppClient();
  await client.login('restaurant', emailOf(label), secret);
  return client;
}
async function registerCourier(label: string, language: 'ru' | 'uz' | 'en' = 'ru') {
  const client = new AppClient();
  const reply = await client.request<{ tokens: AuthTokens; account: CourierAccount }>('POST', '/courier/auth/register', { firstName: label, lastName: 'Test', email: emailOf(label), phone: '+998901112233', password, passwordConfirmation: password, language }, false);
  assert.equal(reply.status, 201, JSON.stringify(reply.error));
  client.tokens = reply.data.tokens;
  return { client, id: reply.data.account.id };
}
async function onboard(courier: AppClient, mode: 'RESTAURANT' | 'FREELANCE') {
  assert.equal((await courier.request('PATCH', '/courier/onboarding', { step: 2 })).status, 200);
  assert.equal((await courier.request('PATCH', '/courier/work-mode', { mode })).status, 200);
  if (mode === 'FREELANCE') assert.equal((await courier.request('PATCH', '/courier/service-area', { city: 'tashkent', zone: 'mirabad' })).status, 200);
  const done = await courier.request<CourierAccount>('PATCH', '/courier/onboarding', { complete: true });
  assert.equal(done.status, 200, JSON.stringify(done.error));
  assert.equal(done.data.profile.onboardingCompleted, true);
}
async function linkToRestaurant(restaurant: AppClient, courier: AppClient) {
  const invitation = await restaurant.request<{ id: string; code: string }>('POST', '/restaurant/courier-invitations');
  assert.equal(invitation.status, 201);
  assert.equal((await courier.request('POST', '/courier/restaurant-invitations/claim', { code: invitation.data.code })).status, 200);
  assert.equal((await courier.request('POST', `/courier/restaurant-invitations/${invitation.data.id}/accept`)).status, 200);
}
/** A cash order of a fresh customer, accepted by the restaurant. */
async function acceptedOrder(restaurant: AppClient, label: string) {
  const customer = new BrowserSession();
  await customer.register(label);
  const address = await customer.request<{ id: string }>('POST', '/addresses', { latitude: 41.3, longitude: 69.25, addressText: 'Courier API test address', label: 'Home', apartment: '7' });
  const order = await customer.request<{ id: string }>('POST', '/orders', { items: [{ dishId: 'dish-plov', quantity: 1 }], addressId: address.data.id, recipientName: 'Courier Api Customer', recipientPhone: '+998907654321', paymentMethod: 'CASH' });
  assert.equal(order.status, 201, JSON.stringify(order.error));
  assert.equal((await restaurant.request<Json>('POST', `/restaurant/orders/${order.data.id}/accept`)).data.status, 'ACCEPTED');
  return { customer, orderId: order.data.id };
}

let osh: AppClient, basilico: AppClient;
before(async () => {
  assert.equal((await fetch(`${base}/api/health`)).status, 200, 'Start PostgreSQL and the API before courier integration tests');
  osh = await makeStaff('osh-olov', 'staff_osh');
  basilico = await makeStaff('basilico', 'staff_basilico');
});
after(async () => {
  try {
    const users = await db.user.findMany({ where: { email: { endsWith: `_${suffix}@example.test` } }, select: { id: true } });
    const userIds = users.map(user => user.id);
    const orderIds = (await db.order.findMany({ where: { userId: { in: userIds } }, select: { id: true } })).map(order => order.id);
    await db.delivery.deleteMany({ where: { orderId: { in: orderIds } } });
    await db.restaurantCourierAffiliation.deleteMany({ where: { courierId: { in: userIds } } });
    await db.courierInvitation.deleteMany({ where: { OR: [{ createdById: { in: userIds } }, { courierId: { in: userIds } }] } });
    await db.payment.deleteMany({ where: { orderId: { in: orderIds } } });
    await db.order.deleteMany({ where: { id: { in: orderIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
  } finally { await db.$disconnect(); }
});

test('Courier auth: registration without a role choice, login, refresh rotation, logout; other roles are kept out', async () => {
  const anonymous = new AppClient();
  const input = { firstName: 'Aziz', lastName: 'Test', email: emailOf('auth'), phone: '+998901112233', password, passwordConfirmation: password, language: 'uz' };
  assert.equal((await anonymous.request('POST', '/courier/auth/register', { ...input, role: 'RESTAURANT' }, false)).status, 400, 'A role cannot be supplied');
  assert.equal((await anonymous.request('POST', '/courier/auth/register', { ...input, passwordConfirmation: 'different' }, false)).status, 400);
  const created = await anonymous.request<{ tokens: AuthTokens; account: CourierAccount }>('POST', '/courier/auth/register', input, false);
  assert.equal(created.status, 201, JSON.stringify(created.error));
  assert.equal(created.data.account.role, 'COURIER');
  assert.equal(created.data.account.profile.approvalStatus, 'PENDING');
  assert.equal(created.data.account.settings.language, 'uz');
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: created.data.account.id } })).role, 'COURIER');
  assert.equal((await anonymous.request('POST', '/courier/auth/register', input, false)).error?.code, 'EMAIL_TAKEN');

  const courier = new AppClient();
  assert.equal((await courier.request('POST', '/courier/auth/login', { email: emailOf('auth'), password: 'wrong-password' }, false)).status, 401);
  await courier.login('courier', emailOf('auth'));
  assert.equal((await courier.request<CourierAccount>('GET', '/courier/me')).data.id, created.data.account.id);
  const previous = courier.tokens!.refreshToken;
  const rotated = await courier.request<{ tokens: AuthTokens }>('POST', '/courier/auth/refresh', { refreshToken: previous }, false);
  assert.equal(rotated.status, 200);
  assert.notEqual(rotated.data.tokens.refreshToken, previous);
  assert.equal((await courier.request('POST', '/courier/auth/refresh', { refreshToken: previous }, false)).status, 401, 'A rotated refresh token cannot be replayed');
  courier.tokens = rotated.data.tokens;
  const tampered = new AppClient(); tampered.tokens = { ...rotated.data.tokens, accessToken: `${rotated.data.tokens.accessToken.slice(0, -6)}abcdef` };
  assert.equal((await tampered.request('GET', '/courier/me')).status, 401);
  assert.equal((await courier.request('POST', '/courier/auth/logout', { refreshToken: courier.tokens.refreshToken })).status, 200);
  assert.equal((await courier.request('GET', '/courier/me')).status, 401, 'Logout revokes the session at once');
  await courier.login('courier', emailOf('auth'));

  const customer = new BrowserSession(); await customer.register('auth_customer');
  assert.equal((await customer.request('GET', '/courier/me')).status, 403, 'A customer session is not a courier');
  assert.equal((await new AppClient().request('POST', '/courier/auth/login', { email: emailOf('auth_customer'), password }, false)).status, 401);
  assert.equal((await new AppClient().request('POST', '/restaurant/auth/login', { email: emailOf('auth'), password }, false)).status, 401, 'A courier cannot sign in as a restaurant');
  assert.equal((await courier.request('GET', '/orders')).status, 401, 'A courier token is not a customer session');
  assert.equal((await courier.request('GET', '/restaurant/orders')).status, 403);
  assert.equal((await osh.request('GET', '/courier/me')).status, 403);
});

test('Invitations: code → claim → accept → affiliation in PostgreSQL; expired, revoked and reused codes are rejected', async () => {
  const { client: courier, id: courierId } = await registerCourier('invited');
  const { client: other } = await registerCourier('intruder');
  const invitation = await osh.request<{ id: string; code: string; expiresAt: string }>('POST', '/restaurant/courier-invitations');
  assert.equal(invitation.status, 201);
  assert.match(invitation.data.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const listed = JSON.stringify((await osh.request('GET', '/restaurant/courier-invitations')).data);
  assert.equal(listed.includes(invitation.data.code), false, 'The code is shown once and never listed');
  assert.equal(listed.includes('codeHash'), false);

  const claimed = await courier.request<{ status: string; restaurant: { name: string } }>('POST', '/courier/restaurant-invitations/claim', { code: invitation.data.code.toLowerCase().replace('-', ' ') });
  assert.equal(claimed.status, 200, JSON.stringify(claimed.error));
  assert.equal(claimed.data.restaurant.name, 'Osh & Olov');
  assert.equal((await other.request('POST', '/courier/restaurant-invitations/claim', { code: invitation.data.code })).error?.code, 'INVITATION_INVALID', 'A claimed code belongs to one courier');
  assert.equal((await other.request('POST', `/courier/restaurant-invitations/${invitation.data.id}/accept`)).status, 404);
  const accepted = await courier.request<{ status: string }>('POST', `/courier/restaurant-invitations/${invitation.data.id}/accept`);
  assert.equal(accepted.data.status, 'ACTIVE');
  assert.equal(await db.restaurantCourierAffiliation.count({ where: { courierId, restaurantId: 'rest-osh', status: 'ACTIVE' } }), 1);
  assert.equal((await courier.request('POST', '/courier/restaurant-invitations/claim', { code: invitation.data.code })).error?.code, 'INVITATION_INVALID', 'A used code cannot be reused');

  const expired = await osh.request<{ id: string; code: string }>('POST', '/restaurant/courier-invitations');
  await db.courierInvitation.update({ where: { id: expired.data.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await other.request('POST', '/courier/restaurant-invitations/claim', { code: expired.data.code })).error?.code, 'INVITATION_INVALID');
  const revoked = await osh.request<{ id: string; code: string }>('POST', '/restaurant/courier-invitations');
  assert.equal((await basilico.request('POST', `/restaurant/courier-invitations/${revoked.data.id}/revoke`)).status, 404, 'Another restaurant cannot revoke it');
  assert.equal((await osh.request('POST', `/restaurant/courier-invitations/${revoked.data.id}/revoke`)).status, 200);
  assert.equal((await other.request('POST', '/courier/restaurant-invitations/claim', { code: revoked.data.code })).error?.code, 'INVITATION_INVALID');

  const couriers = await osh.request<{ courier: { id: string; phone: string } }[]>('GET', '/restaurant/couriers');
  assert.ok(couriers.data.some(item => item.courier.id === courierId));
  assert.equal((await basilico.request<unknown[]>('GET', '/restaurant/couriers')).data.length, 0);
  const affiliations = await courier.request<{ id: string; status: string }[]>('GET', '/courier/affiliations');
  assert.deepEqual(affiliations.data.map(item => item.status), ['ACTIVE']);
});

test('Own courier end to end over REST: customer order → restaurant → courier → customer sees «Доставлено»', async () => {
  const { client: courier, id: courierId } = await registerCourier('own', 'uz');
  await linkToRestaurant(osh, courier);
  await onboard(courier, 'RESTAURANT');
  assert.equal((await courier.request<CourierAccount>('PATCH', '/courier/availability', { available: true })).data.profile.availability, 'AVAILABLE');
  const { customer, orderId } = await acceptedOrder(osh, 'own_customer');
  assert.ok((await osh.request<{ id: string }[]>('GET', '/restaurant/orders')).data.some(order => order.id === orderId));
  assert.equal((await basilico.request('GET', `/restaurant/orders/${orderId}`)).status, 404, 'Another restaurant cannot see the order');
  assert.equal((await basilico.request('POST', `/restaurant/orders/${orderId}/delivery/offer`, { courierId })).status, 404);

  assert.equal((await osh.request('POST', `/restaurant/orders/${orderId}/delivery/offer`, { courierId, reward: 15000 })).status, 200);
  const offers = await courier.request<CourierOffer[]>('GET', '/courier/delivery-offers');
  assert.equal(offers.data.length, 1);
  assert.ok(offers.serverTime && Date.parse(offers.data[0]!.expiresAt) > Date.parse(offers.serverTime));
  for (const secret of ['Courier Api Customer', '+998907654321', 'Courier API test address']) assert.equal(JSON.stringify(offers.data).includes(secret), false);
  const assigned = await courier.request<CourierDelivery>('POST', `/courier/delivery-offers/${offers.data[0]!.id}/accept`);
  assert.equal(assigned.status, 200, JSON.stringify(assigned.error));
  assert.equal(assigned.data.dropoff?.recipientPhone, '+998907654321', 'The assigned courier gets the drop-off contact');
  const busy = (await courier.request<CourierAccount>('GET', '/courier/me')).data;
  assert.equal(busy.profile.availability, 'BUSY');
  assert.equal(busy.activeDeliveryId, assigned.data.id);

  const customerOrder = await customer.request<{ delivery: { handoffCode: string | null; courierAssigned: boolean } }>('GET', `/orders/${orderId}`);
  const code = customerOrder.data.delivery.handoffCode!;
  assert.match(code, /^\d{4}$/);
  assert.equal(customerOrder.data.delivery.courierAssigned, true);
  const restaurantView = JSON.stringify((await osh.request('GET', `/restaurant/orders/${orderId}/delivery`)).data);
  assert.equal(restaurantView.includes('handoffCode'), false, 'The restaurant never receives the handoff code');

  const deliveryId = assigned.data.id;
  assert.equal((await courier.request('POST', `/courier/deliveries/${deliveryId}/pickup`)).error?.code, 'NOT_READY');
  assert.equal((await osh.request<Json>('POST', `/restaurant/orders/${orderId}/delivery/ready`)).data.status, 'READY_FOR_PICKUP');
  assert.equal((await courier.request<CourierDelivery>('POST', `/courier/deliveries/${deliveryId}/pickup`)).data.status, 'PICKED_UP');
  assert.equal((await courier.request<CourierDelivery>('POST', `/courier/deliveries/${deliveryId}/start`)).data.status, 'ON_THE_WAY');
  assert.equal((await customer.request<Json>('GET', `/orders/${orderId}`)).data.status, 'DELIVERING');
  const wrong = String((Number(code) + 1) % 10_000).padStart(4, '0');
  assert.equal((await courier.request('POST', `/courier/deliveries/${deliveryId}/complete`, { code })).error?.code, 'CASH_NOT_CONFIRMED');
  assert.equal((await courier.request<CourierDelivery>('POST', `/courier/deliveries/${deliveryId}/cash-collected`)).data.cash.status, 'COLLECTED');
  assert.equal((await courier.request('POST', `/courier/deliveries/${deliveryId}/complete`, { code: wrong })).error?.code, 'HANDOFF_CODE_INVALID');
  const done = await courier.request<CourierDelivery>('POST', `/courier/deliveries/${deliveryId}/complete`, { code });
  assert.equal(done.data.status, 'DELIVERED');

  const delivered = await customer.request<{ status: string; delivery: { handoffCode: string | null } }>('GET', `/orders/${orderId}`);
  assert.equal(delivered.data.status, 'DELIVERED');
  assert.equal(delivered.data.delivery.handoffCode, null);
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status, 'DELIVERED');

  assert.equal((await basilico.request('POST', `/restaurant/deliveries/${deliveryId}/cash-settled`)).status, 404);
  assert.equal((await courier.request('POST', `/restaurant/deliveries/${deliveryId}/reward/confirm`)).status, 403, 'A courier cannot confirm their own reward');
  assert.equal((await osh.request<Json>('POST', `/restaurant/deliveries/${deliveryId}/cash-settled`)).data.cashStatus, 'SETTLED');
  assert.equal((await db.payment.findUniqueOrThrow({ where: { orderId } })).status, 'PAID');
  assert.equal((await osh.request<Json>('POST', `/restaurant/deliveries/${deliveryId}/reward/confirm`)).data.rewardStatus, 'CONFIRMED');
  assert.equal((await osh.request<Json>('POST', `/restaurant/deliveries/${deliveryId}/reward/paid`)).data.rewardStatus, 'PAID');

  const earnings = (await courier.request<CourierEarnings>('GET', '/courier/earnings')).data;
  assert.deepEqual({ count: earnings.completedCount, paid: earnings.totals.paid, pending: earnings.pending }, { count: 1, paid: 15000, pending: 0 });
  assert.equal(earnings.today.completed, 1);
  const history = await courier.request<CourierHistoryItem[]>('GET', '/courier/history?filter=completed');
  assert.equal(history.data[0]?.outcome, 'DELIVERED');
  assert.equal(JSON.stringify(history.data).includes('+998907654321'), false, 'History keeps no customer contact');
  assert.equal((await courier.request<CourierHistoryItem[]>('GET', '/courier/history?filter=freelance')).data.length, 0);
  const notices = await courier.request<{ title: string; metadata: Json }[]>('GET', '/courier/notifications');
  assert.ok(notices.data.some(notice => notice.metadata.event === 'OFFER_CREATED' && notice.title === 'Yangi yetkazish taklifi'), 'Courier notifications follow the courier language');
  assert.equal((await courier.request<{ read: number }>('PATCH', '/courier/notifications/read', {})).status, 200);
  const staffNotices = await osh.request<{ metadata: Json }[]>('GET', '/restaurant/notifications');
  assert.ok(staffNotices.data.some(notice => notice.metadata.event === 'COURIER_ASSIGNED' && notice.metadata.orderId === orderId));
  assert.equal((await courier.request<CourierAccount>('GET', '/courier/me')).data.profile.availability, 'AVAILABLE');
});

test('Free search over REST: admission by CLI, zone setup, two couriers race and exactly one wins', async () => {
  const first = await registerCourier('free_one'), second = await registerCourier('free_two');
  for (const courier of [first, second]) {
    await onboard(courier.client, 'FREELANCE');
    assert.equal((await courier.client.request('PATCH', '/courier/availability', { available: true })).error?.code, 'MODE_NOT_ALLOWED', 'Free deliveries need admission');
    assert.match(await cli('courier-approve.ts', emailOf(courier.client === first.client ? 'free_one' : 'free_two'), '--test'), /APPROVED \(test account\)/);
    assert.equal((await courier.client.request<CourierAccount>('PATCH', '/courier/availability', { available: true })).data.profile.availability, 'AVAILABLE');
  }
  try {
    const { orderId } = await acceptedOrder(osh, 'free_customer');
    const search = await osh.request<Json>('POST', `/restaurant/orders/${orderId}/delivery/search`, {});
    assert.equal(search.data.status, 'SEARCHING');
    const [a, b] = await Promise.all([first.client.request<CourierOffer[]>('GET', '/courier/delivery-offers'), second.client.request<CourierOffer[]>('GET', '/courier/delivery-offers')]);
    const offerA = a.data.find(offer => offer.order.number === orderId.slice(-8).toUpperCase())!, offerB = b.data.find(offer => offer.order.number === orderId.slice(-8).toUpperCase())!;
    assert.ok(offerA && offerB, 'Both matching couriers receive the offer');
    assert.equal(offerA.mode, 'UZBITE_COURIER');
    const results = await Promise.all([first.client.request('POST', `/courier/delivery-offers/${offerA.id}/accept`), second.client.request('POST', `/courier/delivery-offers/${offerB.id}/accept`)]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    const lost = results.find(result => result.status === 409)!;
    assert.equal(lost.error?.code, 'OFFER_TAKEN');
    assert.equal(lost.error?.message, 'Этот заказ уже принят другим курьером');
    const winner = results[0]!.status === 200 ? first : second;
    const view = await osh.request<{ courier: { id: string } | null; status: string }>('GET', `/restaurant/orders/${orderId}/delivery`);
    assert.equal(view.data.courier?.id, winner.id);
    assert.equal(view.data.status, 'ASSIGNED');
    const loser = winner === first ? second : first;
    const winnerDelivery = (await winner.client.request<CourierDelivery>('GET', '/courier/deliveries/active')).data;
    assert.equal((await loser.client.request('GET', `/courier/deliveries/${winnerDelivery.id}`)).status, 404, 'Another courier cannot read the delivery');
    assert.equal((await loser.client.request('POST', `/courier/deliveries/${winnerDelivery.id}/pickup`)).status, 404);
    assert.equal((await osh.request('POST', `/restaurant/orders/${orderId}/delivery/cancel`, { reason: 'Тест: отменяем назначение' })).status, 200);
    assert.equal((await winner.client.request('GET', '/courier/deliveries/active')).data, null);
  } finally {
    for (const courier of [first, second]) await courier.client.request('PATCH', '/courier/availability', { available: false });
  }
});

test('Restaurant cancels with a reason the customer sees; suspension and payment rights are enforced', async () => {
  const { customer, orderId } = await acceptedOrder(osh, 'cancel_customer');
  assert.equal((await osh.request('POST', `/restaurant/orders/${orderId}/cancel`, {})).status, 400, 'A reason is required');
  assert.equal((await basilico.request('POST', `/restaurant/orders/${orderId}/cancel`, { reason: 'Чужой ресторан' })).status, 404);
  const cancelled = await osh.request<Json>('POST', `/restaurant/orders/${orderId}/cancel`, { reason: 'Закончились продукты' });
  assert.equal(cancelled.data.status, 'CANCELLED');
  const seen = await customer.request<Json>('GET', `/orders/${orderId}`);
  assert.equal(seen.data.status, 'CANCELLED');
  assert.equal(seen.data.cancellationReason, 'Закончились продукты');
  assert.equal((await osh.request('POST', `/restaurant/orders/${orderId}/payment`, { status: 'PAID' })).error?.code, 'NOT_CARD_PAYMENT', 'Cash is settled through the courier, not confirmed here');

  const { client: courier } = await registerCourier('suspended');
  await linkToRestaurant(osh, courier);
  await onboard(courier, 'RESTAURANT');
  assert.equal((await courier.request('PATCH', '/courier/availability', { available: true })).status, 200);
  assert.equal((await courier.request('POST', `/restaurant/orders/${orderId}/payment`, { status: 'PAID' })).status, 403, 'A courier cannot confirm payments');
  assert.match(await cli('courier-approve.ts', emailOf('suspended'), '--suspend'), /SUSPENDED/);
  const account = (await courier.request<CourierAccount>('GET', '/courier/me')).data;
  assert.equal(account.profile.availability, 'UNAVAILABLE');
  assert.deepEqual(account.profile.permissions, { restaurantMode: false, freelanceMode: false, reason: 'SUSPENDED' });
  assert.equal((await courier.request('PATCH', '/courier/availability', { available: true })).error?.code, 'COURIER_SUSPENDED');
});

const sockets: Socket[] = [];
const outcomes = new WeakMap<Socket, Promise<boolean>>();
/** The connection outcome is captured as the socket is created, so a fast connect is never missed. */
function connect(options: { token?: string; cookie?: string } = {}) {
  const socket = io(base, { transports: ['websocket'], reconnection: false, timeout: 4000, ...(options.token === undefined ? {} : { auth: { token: options.token } }), ...(options.cookie ? { extraHeaders: { Cookie: options.cookie, Origin: origin } } : {}) });
  outcomes.set(socket, new Promise<boolean>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Socket neither connected nor failed')), 6000);
    socket.once('connect', () => { clearTimeout(timer); resolve(true); });
    socket.once('connect_error', () => { clearTimeout(timer); resolve(false); });
  }));
  sockets.push(socket);
  return socket;
}
const opened = (socket: Socket) => outcomes.get(socket)!;
/** A room request must always be answered; a missing acknowledgement fails instead of hanging. */
const joins = (socket: Socket, event: string, id: string) => socket.timeout(5000).emitWithAck(event, id).then((reply: { ok: boolean }) => reply.ok, () => { throw new Error(`${event} was not acknowledged (connected: ${socket.connected})`); });
function nextEvent<T>(socket: Socket, event: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} did not arrive`)), 5000);
    socket.once(event, (data: T) => { clearTimeout(timer); resolve(data); });
  });
}
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('Socket.IO: Bearer auth, server-assigned rooms, foreign rooms refused, events only after commit', async () => {
  const { client: courier, id: courierId } = await registerCourier('socket_own');
  const { client: stranger } = await registerCourier('socket_stranger');
  await linkToRestaurant(osh, courier);
  await onboard(courier, 'RESTAURANT');
  await courier.request('PATCH', '/courier/availability', { available: true });
  try {
    assert.equal(await opened(connect()), false, 'No credentials, no connection');
    assert.equal(await opened(connect({ token: `${courier.tokens!.accessToken.slice(0, -6)}abcdef` })), false, 'A tampered token is refused');
    const courierSocket = connect({ token: courier.tokens!.accessToken }), strangerSocket = connect({ token: stranger.tokens!.accessToken });
    const oshSocket = connect({ token: osh.tokens!.accessToken }), basilicoSocket = connect({ token: basilico.tokens!.accessToken });
    for (const socket of [courierSocket, strangerSocket, oshSocket, basilicoSocket]) assert.equal(await opened(socket), true);
    const seenByOthers: string[] = [];
    strangerSocket.onAny(event => seenByOthers.push(`stranger:${event}`));
    basilicoSocket.onAny(event => seenByOthers.push(`basilico:${event}`));

    const orderCreated = nextEvent<{ orderId: string }>(oshSocket, 'restaurant:order_created');
    const { customer, orderId } = await acceptedOrder(osh, 'socket_customer');
    assert.equal((await orderCreated).orderId, orderId, 'The restaurant room hears about new orders');
    const customerSocket = connect({ cookie: customer.cookieHeader() });
    assert.equal(await opened(customerSocket), true);
    assert.equal(await joins(customerSocket, 'order:join', orderId), true);
    assert.equal(await joins(courierSocket, 'order:join', orderId), false, 'Order rooms carry the handoff code: customer only');
    assert.equal(await joins(oshSocket, 'order:join', orderId), false);

    const offered = nextEvent<{ offerId: string; deliveryId: string }>(courierSocket, 'delivery:offer_created');
    const courierNotice = nextEvent<{ type: string; metadata: Json }>(courierSocket, 'notification:created');
    await osh.request('POST', `/restaurant/orders/${orderId}/delivery/offer`, { courierId });
    const offer = await offered;
    assert.ok(await db.deliveryOffer.findUnique({ where: { id: offer.offerId } }), 'The event leaves only after the offer is committed');
    assert.equal(JSON.stringify(offer).includes('+998907654321'), false);
    assert.equal((await courierNotice).type, 'COURIER_DELIVERY');
    const deliveryId = offer.deliveryId;
    assert.equal(await joins(courierSocket, 'delivery:join', deliveryId), false, 'An offer is not an assignment');
    assert.equal(await joins(oshSocket, 'delivery:join', deliveryId), true);
    assert.equal(await joins(basilicoSocket, 'delivery:join', deliveryId), false);

    const assignedHint = nextEvent<DeliverySocketHint>(oshSocket, 'delivery:courier_assigned');
    const customerUpdate = nextEvent<{ delivery: { courierAssigned: boolean; handoffCode: string | null } }>(customerSocket, 'order:updated');
    const offers = await courier.request<CourierOffer[]>('GET', '/courier/delivery-offers');
    assert.equal((await courier.request('POST', `/courier/delivery-offers/${offers.data[0]!.id}/accept`)).status, 200);
    const hint = await assignedHint;
    assert.equal(hint.status, 'ASSIGNED');
    assert.equal(hint.version, (await db.delivery.findUniqueOrThrow({ where: { id: deliveryId } })).version);
    const update = await customerUpdate;
    assert.equal(update.delivery.courierAssigned, true);
    assert.match(update.delivery.handoffCode ?? '', /^\d{4}$/);
    assert.equal(await joins(courierSocket, 'delivery:join', deliveryId), true, 'The assigned courier may follow the delivery');
    assert.equal(await joins(strangerSocket, 'delivery:join', deliveryId), false);
    assert.equal(await joins(customerSocket, 'delivery:join', deliveryId), false);

    const released = nextEvent<DeliverySocketHint>(courierSocket, 'delivery:cancelled');
    await osh.request('POST', `/restaurant/orders/${orderId}/delivery/cancel`, { reason: 'Проверка событий' });
    assert.equal((await released).status, 'NOT_REQUESTED');
    let releasedCourierHeard = false;
    courierSocket.on('delivery:pickup_ready', () => { releasedCourierHeard = true; });
    const ready = nextEvent<DeliverySocketHint>(oshSocket, 'delivery:pickup_ready');
    await osh.request('POST', `/restaurant/orders/${orderId}/delivery/ready`);
    await ready; await pause(300);
    assert.equal(releasedCourierHeard, false, 'A released courier leaves the delivery room');
    assert.deepEqual(seenByOthers, [], 'Other couriers and restaurants receive nothing about this order');

    const dropped = nextEvent<string>(courierSocket, 'disconnect');
    assert.equal((await courier.request('POST', '/courier/auth/logout', { refreshToken: courier.tokens!.refreshToken })).status, 200);
    assert.equal(await dropped, 'io server disconnect', 'Logout closes the session socket');
  } finally {
    for (const socket of sockets) socket.disconnect();
  }
});
