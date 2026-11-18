import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { io, type Socket } from 'socket.io-client';
import type { AuthTokens, CourierAccount, CourierDelivery, CourierEarnings, CourierHistoryItem, CourierMap, CourierMapHint, CourierNearbyOrders, CourierOffer, DeliverySocketHint } from '@uzbite/shared';
import { db } from '../apps/backend/src/config/database.js';
import { deletePrivateObject } from '../apps/backend/src/services/storage.js';

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
  const reply = await client.request<{ tokens: AuthTokens; account: CourierAccount }>('POST', '/courier/auth/register', { email: emailOf(label), phone: '+998901112233', password, passwordConfirmation: password, language }, false);
  assert.equal(reply.status, 201, JSON.stringify(reply.error));
  client.tokens = reply.data.tokens;
  return { client, id: reply.data.account.id };
}
/** Smallest valid JPEG header is enough: the server checks the real file signature. */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
async function uploadFace(courier: AppClient, body: Buffer = JPEG, type = 'image/jpeg') {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(body)], { type }), 'face.jpg');
  const response = await fetch(`${base}/api/courier/identity/face-photo`, { method: 'POST', headers: { 'X-UzBite-Client': 'app', Authorization: `Bearer ${courier.tokens!.accessToken}` }, body: form });
  const payload = await response.json() as { data: CourierAccount; error?: { code: string } };
  return { status: response.status, data: payload.data, error: payload.error };
}
let passportCounter = 0;
/** Unique 7-digit passport number per courier of this run (one account per passport). */
const nextPassport = () => `${String(parseInt(suffix.slice(0, 6), 16) % 10_000).padStart(4, '0')}${String(passportCounter++).padStart(3, '0')}`;
/** Onboarding step 1: name, passport and face photo. */
async function identify(courier: AppClient) {
  const personal = await courier.request<CourierAccount>('PATCH', '/courier/profile', { firstName: 'Courier', lastName: 'Test', passportSeries: 'aa', passportNumber: nextPassport() });
  assert.equal(personal.status, 200, JSON.stringify(personal.error));
  assert.equal((await uploadFace(courier)).status, 201);
}
async function onboard(courier: AppClient, mode: 'RESTAURANT' | 'FREELANCE') {
  await identify(courier);
  assert.equal((await courier.request('PATCH', '/courier/onboarding', { step: 2 })).status, 200);
  assert.equal((await courier.request('PATCH', '/courier/work-mode', { mode })).status, 200);
  if (mode === 'FREELANCE') assert.equal((await courier.request('PATCH', '/courier/service-area', { city: 'tashkent' })).status, 200);
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

/**
 * Admitted free couriers are always on duty, so test couriers leave the pool when their test ends:
 * later free searches (of this run or of a developer) must not be offered to them.
 */
const leavePool = (...courierIds: string[]) => db.courierProfile.updateMany({ where: { userId: { in: courierIds } }, data: { approvalStatus: 'SUSPENDED' } });

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
    const faces = await db.upload.findMany({ where: { userId: { in: userIds }, purpose: 'COURIER_FACE' } });
    await db.upload.deleteMany({ where: { id: { in: faces.map(face => face.id) } } });
    await Promise.all(faces.map(face => deletePrivateObject(face)));
    await db.payment.deleteMany({ where: { orderId: { in: orderIds } } });
    await db.order.deleteMany({ where: { id: { in: orderIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
  } finally { await db.$disconnect(); }
});

test('Courier auth: registration without a role choice, login, refresh rotation, logout; other roles are kept out', async () => {
  const anonymous = new AppClient();
  const input = { email: emailOf('auth'), phone: '+998901112233', password, passwordConfirmation: password, language: 'uz' };
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

test('Onboarding identity: name, passport and a private face photo are required; one account per passport; locked after admission', async () => {
  const { client: courier, id } = await registerCourier('identity');
  const fresh = (await courier.request<CourierAccount>('GET', '/courier/me')).data;
  assert.equal(fresh.profile.firstName, '', 'Registration asks only for phone, email and password');
  assert.equal(fresh.profile.city, null);
  assert.deepEqual(fresh.profile.identity, { passportSeries: null, passportNumber: null, facePhoto: false, locked: false });
  assert.equal((await courier.request('PATCH', '/courier/work-mode', { mode: 'FREELANCE' })).status, 200);
  assert.equal((await courier.request('PATCH', '/courier/service-area', { city: 'tashkent', zone: 'mirabad' })).status, 400, 'Districts are no longer accepted');
  assert.equal((await courier.request('PATCH', '/courier/service-area', { city: 'atlantis' })).status, 400);
  assert.equal((await courier.request<CourierAccount>('PATCH', '/courier/service-area', { city: 'samarkand' })).data.profile.city, 'samarkand');
  assert.equal((await courier.request('PATCH', '/courier/onboarding', { complete: true })).error?.code, 'PERSONAL_DATA_REQUIRED');

  assert.equal((await courier.request('PATCH', '/courier/profile', { passportSeries: 'A1', passportNumber: '1234567' })).status, 400);
  assert.equal((await courier.request('PATCH', '/courier/profile', { passportSeries: 'AB', passportNumber: '123456' })).status, 400);
  assert.equal((await courier.request('PATCH', '/courier/profile', { passportSeries: 'AB' })).status, 400, 'Series and number come together');
  const number = nextPassport();
  const named = await courier.request<CourierAccount>('PATCH', '/courier/profile', { firstName: 'Aziz', lastName: 'Karimov', passportSeries: 'ab ', passportNumber: `${number.slice(0, 3)} ${number.slice(3)}` });
  assert.equal(named.status, 200, JSON.stringify(named.error));
  assert.deepEqual(named.data.profile.identity, { passportSeries: 'AB', passportNumber: number, facePhoto: false, locked: false });
  assert.equal((await courier.request('PATCH', '/courier/onboarding', { complete: true })).error?.code, 'IDENTITY_REQUIRED');

  assert.equal((await uploadFace(courier, Buffer.from('not an image'))).error?.code, 'FILE_TYPE');
  const photo = await uploadFace(courier);
  assert.equal(photo.status, 201, JSON.stringify(photo.error));
  assert.equal(photo.data.profile.identity.facePhoto, true);
  assert.equal((await uploadFace(courier)).status, 201, 'The photo can be retaken before admission');
  assert.equal(await db.upload.count({ where: { userId: id, purpose: 'COURIER_FACE' } }), 1, 'The previous photo is removed');
  const done = await courier.request<CourierAccount>('PATCH', '/courier/onboarding', { complete: true });
  assert.equal(done.status, 200, JSON.stringify(done.error));

  const { client: twin } = await registerCourier('identity_twin');
  assert.equal((await twin.request('PATCH', '/courier/profile', { passportSeries: 'AB', passportNumber: number })).error?.code, 'PASSPORT_TAKEN');
  await assert.rejects(cli('courier-approve.ts', emailOf('identity_twin')), /passport and a face photo/, 'Admission needs the identity');
  assert.match(await cli('courier-approve.ts', emailOf('identity')), new RegExp(`Passport: AB ${number}[\\s\\S]*APPROVED`));
  assert.equal((await courier.request<CourierAccount>('GET', '/courier/me')).data.profile.identity.locked, true);
  assert.equal((await courier.request('PATCH', '/courier/profile', { passportSeries: 'AC', passportNumber: number })).error?.code, 'IDENTITY_LOCKED');
  assert.equal((await uploadFace(courier)).error?.code, 'IDENTITY_LOCKED');
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
  assert.equal((await courier.request<CourierAccount>('GET', '/courier/me')).data.profile.availability, 'AVAILABLE', 'A linked courier is on duty without any switch');
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

test('Free search over REST: admission by CLI, city setup, two couriers race and exactly one wins', async () => {
  const first = await registerCourier('free_one'), second = await registerCourier('free_two');
  for (const courier of [first, second]) {
    await onboard(courier.client, 'FREELANCE');
    assert.equal((await courier.client.request<CourierAccount>('GET', '/courier/me')).data.profile.availability, 'UNAVAILABLE', 'Free deliveries need admission');
    assert.match(await cli('courier-approve.ts', emailOf(courier.client === first.client ? 'free_one' : 'free_two'), '--test'), /APPROVED \(test account\)/);
    assert.equal((await courier.client.request<CourierAccount>('GET', '/courier/me')).data.profile.availability, 'AVAILABLE', 'Admission puts the courier on duty at once');
  }
  assert.equal((await first.client.request('PATCH', '/courier/availability', { available: false })).status, 404, 'There is no availability switch');
  assert.equal((await first.client.request('PATCH', '/courier/work-mode', { mode: 'RESTAURANT' })).error?.code, 'AFFILIATION_REQUIRED', 'Own-restaurant mode needs the code of the hiring restaurant');
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
    await leavePool(first.id, second.id);
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
  assert.equal((await courier.request<CourierAccount>('GET', '/courier/me')).data.profile.availability, 'AVAILABLE');
  assert.equal((await courier.request('POST', `/restaurant/orders/${orderId}/payment`, { status: 'PAID' })).status, 403, 'A courier cannot confirm payments');
  assert.match(await cli('courier-approve.ts', emailOf('suspended'), '--suspend'), /SUSPENDED/);
  const account = (await courier.request<CourierAccount>('GET', '/courier/me')).data;
  assert.equal(account.profile.availability, 'UNAVAILABLE');
  assert.deepEqual(account.profile.permissions, { restaurantMode: false, freelanceMode: false, reason: 'SUSPENDED' });
  assert.equal((await courier.request('PATCH', '/courier/work-mode', { mode: 'FREELANCE' })).error?.code, 'COURIER_SUSPENDED');
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

test('Nearby orders (MVP): a new order shows to verified couriers within 5 km of the restaurant; the first «Взять заказ» wins', async () => {
  const restaurant = await db.restaurant.findUniqueOrThrow({ where: { slug: 'osh-olov' } });
  const couriers = await Promise.all(['near_one', 'near_two', 'near_far'].map(label => registerCourier(label)));
  for (const [index, courier] of couriers.entries()) {
    await onboard(courier.client, 'FREELANCE');
    assert.match(await cli('courier-approve.ts', emailOf(['near_one', 'near_two', 'near_far'][index]!), '--test'), /APPROVED/);
  }
  const [one, two, far] = couriers as [typeof couriers[0], typeof couriers[0], typeof couriers[0]];
  try {
    assert.equal((await one.client.request<{ located: boolean }>('GET', '/courier/nearby-orders')).data.located, false, 'No position reported yet');
    // About 1 km and 11 km north of the restaurant.
    for (const [courier, shift] of [[one, 0.009], [two, 0.009], [far, 0.1]] as const) {
      assert.equal((await courier.client.request('PATCH', '/courier/location', { latitude: restaurant.latitude + shift, longitude: restaurant.longitude })).status, 200);
    }
    assert.equal((await one.client.request('PATCH', '/courier/location', { latitude: 120, longitude: 0 })).status, 400);

    const customer = new BrowserSession();
    await customer.register('near_customer');
    const address = await customer.request<{ id: string }>('POST', '/addresses', { latitude: 41.3, longitude: 69.25, addressText: 'Nearby test address', label: 'Home', apartment: '3' });
    const created = await customer.request<{ id: string; status: string }>('POST', '/orders', { items: [{ dishId: 'dish-plov', quantity: 1 }], addressId: address.data.id, recipientName: 'Nearby Customer', recipientPhone: '+998907650000', paymentMethod: 'CASH' });
    assert.equal(created.status, 201, JSON.stringify(created.error));
    const orderId = created.data.id;
    assert.equal(created.data.status, 'PENDING_ACCEPTANCE', 'No restaurant action is needed');

    const list = await one.client.request<CourierNearbyOrders>('GET', '/courier/nearby-orders');
    const found = list.data.items.find(item => item.orderId === orderId);
    assert.ok(found, 'A courier 1 km away sees the new order');
    assert.ok(found.distanceKm <= 5 && found.distanceKm > 0.5);
    assert.deepEqual([found.restaurant.latitude, found.restaurant.longitude], [restaurant.latitude, restaurant.longitude]);
    assert.equal(JSON.stringify(list.data).includes('+998907650000') || JSON.stringify(list.data).includes('Nearby test address'), false, 'No customer data before taking');
    assert.equal((await far.client.request<CourierNearbyOrders>('GET', '/courier/nearby-orders')).data.items.some(item => item.orderId === orderId), false, 'A courier 11 km away does not see it');
    assert.equal((await far.client.request('POST', `/courier/orders/${orderId}/take`)).error?.code, 'TOO_FAR');

    const results = await Promise.all([one.client.request<CourierDelivery>('POST', `/courier/orders/${orderId}/take`), two.client.request<CourierDelivery>('POST', `/courier/orders/${orderId}/take`)]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409], 'Exactly one courier gets the order');
    const lost = results.find(result => result.status === 409)!;
    assert.equal(lost.error?.code, 'OFFER_TAKEN');
    const winner = results[0]!.status === 200 ? one : two, loser = winner === one ? two : one;
    const taken = results.find(result => result.status === 200)!.data;
    assert.equal(taken.status, 'ASSIGNED');
    assert.equal(taken.restaurant.latitude, restaurant.latitude);
    assert.equal((await winner.client.request<CourierDelivery>('GET', '/courier/deliveries/active')).data.id, taken.id, 'The order is the winner’s active delivery');
    assert.equal((await winner.client.request('POST', `/courier/orders/${orderId}/take`)).status, 200, 'Taking again is idempotent');
    assert.equal((await loser.client.request<CourierNearbyOrders>('GET', '/courier/nearby-orders')).data.items.some(item => item.orderId === orderId), false, 'Gone for everyone else');
    const history = await winner.client.request<CourierHistoryItem[]>('GET', '/courier/history');
    assert.ok(history.data.some(item => item.deliveryId === taken.id && item.outcome === 'IN_PROGRESS'));
    const seen = await customer.request<{ delivery: { courierAssigned: boolean } | null }>('GET', `/orders/${orderId}`);
    assert.equal(seen.data.delivery?.courierAssigned, true, 'The customer sees that a courier took the order');
  } finally {
    await leavePool(...couriers.map(courier => courier.id));
  }
});

test('Courier map: a free search puts the restaurant on the map of admitted couriers of its city, with a live hint', async () => {
  const restaurant = await db.restaurant.findUniqueOrThrow({ where: { slug: 'osh-olov' } });
  const { client: courier, id: courierId } = await registerCourier('map_free');
  const { client: waiting } = await registerCourier('map_waiting');
  await onboard(courier, 'FREELANCE');
  await onboard(waiting, 'FREELANCE');
  assert.match(await cli('courier-approve.ts', emailOf('map_free'), '--test'), /APPROVED \(test account\)/);
  assert.equal((await courier.request<CourierAccount>('GET', '/courier/me')).data.profile.availability, 'AVAILABLE');
  const mapSocket = connect({ token: courier.tokens!.accessToken }), waitingSocket = connect({ token: waiting.tokens!.accessToken });
  let orderId = '';
  try {
    assert.equal(await opened(mapSocket), true);
    assert.equal(await opened(waitingSocket), true);
    assert.equal(await joins(mapSocket, 'courier-map:join', ''), true, 'An admitted free courier follows the map of their city');
    assert.equal(await joins(waitingSocket, 'courier-map:join', ''), false, 'No map room without admission');
    let waitingHeard = false;
    waitingSocket.on('courier:map_updated', () => { waitingHeard = true; });

    ({ orderId } = await acceptedOrder(osh, 'map_customer'));
    const before = (await courier.request<CourierMap>('GET', '/courier/map')).data.restaurants.find(item => item.id === restaurant.id)?.waitingOrders ?? 0;
    const hint = nextEvent<CourierMapHint>(mapSocket, 'courier:map_updated');
    assert.equal((await osh.request<Json>('POST', `/restaurant/orders/${orderId}/delivery/search`, {})).data.status, 'SEARCHING');
    assert.equal((await hint).restaurantId, restaurant.id, 'The city map room hears about the search after commit');

    const reply = await courier.request<CourierMap>('GET', '/courier/map');
    assert.equal(reply.status, 200, JSON.stringify(reply.error));
    assert.equal(reply.data.city, 'tashkent');
    const pin = reply.data.restaurants.find(item => item.id === restaurant.id);
    assert.ok(pin, 'The searching restaurant is on the map');
    assert.equal(pin.waitingOrders, before + 1);
    assert.deepEqual([pin.latitude, pin.longitude, pin.name], [restaurant.latitude, restaurant.longitude, restaurant.name], 'The point is the stored restaurant location');
    const offer = (await courier.request<CourierOffer[]>('GET', '/courier/delivery-offers')).data.find(item => item.order.number === orderId.slice(-8).toUpperCase());
    assert.ok(offer && pin.offerIds.includes(offer.id), 'The map links to the courier’s own open offer');
    assert.equal(JSON.stringify(reply.data).includes('+998907654321') || JSON.stringify(reply.data).includes('Courier API test address'), false, 'No customer data on the map');
    assert.deepEqual((await waiting.request<CourierMap>('GET', '/courier/map')).data.restaurants, [], 'A courier without admission sees no free searches');

    const gone = nextEvent<CourierMapHint>(mapSocket, 'courier:map_updated');
    assert.equal((await courier.request('POST', `/courier/delivery-offers/${offer.id}/accept`)).status, 200);
    await gone;
    const after = (await courier.request<CourierMap>('GET', '/courier/map')).data.restaurants.find(item => item.id === restaurant.id);
    assert.equal(after?.waitingOrders ?? 0, before, 'An accepted order leaves the map');
    assert.equal(after?.offerIds.includes(offer.id) ?? false, false);
    await pause(300);
    assert.equal(waitingHeard, false, 'Couriers outside the map room hear nothing');
  } finally {
    if (orderId) await osh.request('POST', `/restaurant/orders/${orderId}/delivery/cancel`, { reason: 'Тест карты: снимаем назначение' });
    await leavePool(courierId);
    mapSocket.disconnect(); waitingSocket.disconnect();
  }
});
