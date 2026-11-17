import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { allowedOrigins } from '../config/env.js';
import { db, redis } from '../config/database.js';
import { accessCookie, identityFromAccess, identityFromBearer, type Identity } from './auth.js';
import { customerOrderJson, orderInclude } from './orders.js';
import { ACTIVE_DELIVERY } from './dispatch-dto.js';
import { jsonValue } from '../utils/serialize.js';
import { notificationDto } from './notifications.js';

/**
 * Socket.IO for the customer website (HttpOnly cookie) and the native apps (Bearer token in
 * `handshake.auth.token`). The server decides every room:
 *   user:{id}        every account (its own notifications)
 *   courier:{id}     the courier's offers and assignments
 *   restaurant:{id}  the staff member's own restaurant, resolved from the account
 *   order:{id}       only the customer who owns the order (it carries the handoff code)
 *   delivery:{id}    the restaurant of the delivery or its currently assigned courier
 * Events are hints emitted after commit; clients re-read REST after every (re)connection.
 */
let io: Server | undefined;
let subscriber: ReturnType<typeof redis.duplicate> | undefined;
type Credential = { kind: 'cookie' | 'bearer'; token: string };
type SocketData = { user: Identity; credential: Credential; restaurantId?: string };
type Ack = (data: { ok: boolean }) => void;

function cookieToken(socket: Socket) {
  for (const part of (socket.handshake.headers.cookie ?? '').split(';')) {
    const item = part.trim(), index = item.indexOf('=');
    if (index > 0 && item.slice(0, index) === accessCookie) return decodeURIComponent(item.slice(index + 1));
  }
  return undefined;
}
/** Native apps send a Bearer token; the website its cookie. Never both. */
function credentialOf(socket: Socket): Credential {
  const auth = socket.handshake.auth as { token?: unknown } | undefined;
  if (auth?.token !== undefined) {
    if (typeof auth.token !== 'string' || auth.token.length > 4100) throw new Error('Invalid token');
    return { kind: 'bearer', token: auth.token.replace(/^Bearer /, '') };
  }
  const token = cookieToken(socket);
  if (!token) throw new Error('Missing token');
  return { kind: 'cookie', token };
}
const verify = (credential: Credential) => credential.kind === 'bearer' ? identityFromBearer(credential.token) : identityFromAccess(credential.token);
/** Room requests re-check the session, so a revoked or expired session cannot join anything new. */
async function stillValid(socket: Socket) {
  const data = socket.data as SocketData;
  try { return (await verify(data.credential)).id === data.user.id; } catch { return false; }
}
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 100;
const replier = (ack: unknown) => (ok: boolean) => { if (typeof ack === 'function') (ack as Ack)({ ok }); };

export function initRealtime(server: HttpServer) {
  io = new Server(server, { cors: { origin: allowedOrigins, credentials: true }, maxHttpBufferSize: 16 * 1024 });
  io.use(async (socket, next) => {
    try {
      const origin = socket.handshake.headers.origin;
      if (origin && !allowedOrigins.includes(origin)) throw new Error('Origin forbidden');
      const credential = credentialOf(socket);
      const user = await verify(credential);
      const data: SocketData = { user, credential };
      if (user.role === 'RESTAURANT') {
        const staff = await db.restaurantStaff.findUnique({ where: { userId: user.id }, select: { restaurantId: true } });
        if (!staff) throw new Error('No restaurant');
        data.restaurantId = staff.restaurantId;
      }
      socket.data = data;
      next();
    } catch { next(new Error('Unauthorized')); }
  });
  io.on('connection', socket => {
    const { user, restaurantId } = socket.data as SocketData;
    void socket.join(`user:${user.id}`);
    if (user.role === 'COURIER') void socket.join(`courier:${user.id}`);
    if (user.role === 'RESTAURANT' && restaurantId) void socket.join(`restaurant:${restaurantId}`);

    socket.on('order:join', async (orderId: unknown, ack?: unknown) => {
      const respond = replier(ack);
      // Order rooms carry the customer's handoff code: only the owning customer may join.
      if (user.role !== 'USER' || !validId(orderId)) { respond(false); return; }
      try {
        if (!await stillValid(socket) || !await db.order.findFirst({ where: { id: orderId, userId: user.id }, select: { id: true } })) { respond(false); return; }
        await socket.join(`order:${orderId}`); respond(true);
      } catch { respond(false); }
    });
    socket.on('delivery:join', async (deliveryId: unknown, ack?: unknown) => {
      const respond = replier(ack);
      if (!validId(deliveryId) || (user.role !== 'COURIER' && user.role !== 'RESTAURANT')) { respond(false); return; }
      try {
        const delivery = await db.delivery.findUnique({ where: { id: deliveryId }, select: { courierId: true, restaurantId: true, status: true } });
        const allowed = Boolean(delivery) && (user.role === 'COURIER'
          ? delivery!.courierId === user.id && ACTIVE_DELIVERY.includes(delivery!.status)
          : delivery!.restaurantId === restaurantId);
        if (!allowed || !await stillValid(socket)) { respond(false); return; }
        await socket.join(`delivery:${deliveryId}`); respond(true);
      } catch { respond(false); }
    });
    socket.on('delivery:leave', (deliveryId: unknown) => { if (validId(deliveryId)) void socket.leave(`delivery:${deliveryId}`); });
    socket.on('post:join', async (postId: unknown) => {
      if (!validId(postId)) return;
      try { if (await db.post.findUnique({ where: { id: postId }, select: { id: true } })) await socket.join(`post:${postId}`); } catch { /* REST remains source of truth. */ }
    });
    socket.on('post:leave', (postId: unknown) => { if (validId(postId)) void socket.leave(`post:${postId}`); });
    // Access credentials expire even on a long-lived socket; clients refresh and reconnect.
    const expiry = setTimeout(() => socket.disconnect(true), Math.max(0, Number(user.accessExpiresAt) - Date.now()));
    socket.on('disconnect', () => clearTimeout(expiry));
  });
  redis.on('ready', () => { void subscribeDeveloperEvents(); });
  if (redis.isReady) void subscribeDeveloperEvents();
  return io;
}
async function subscribeDeveloperEvents() {
  if (subscriber) return;
  subscriber = redis.duplicate(); subscriber.on('error', () => {});
  try {
    await subscriber.connect();
    await subscriber.subscribe('uzbite:events', message => {
      void (async () => {
        const event = JSON.parse(message) as { userId?: string; orderId?: string; notificationIds?: string[]; notification?: { id?: string } };
        if (!event.userId || !event.orderId) return;
        const order = await db.order.findFirst({ where: { id: event.orderId, userId: event.userId }, include: orderInclude });
        if (order) { ioEvent([`user:${event.userId}`, `order:${order.id}`], 'order:updated', customerOrderJson(order)); ioEvent(`user:${event.userId}`, 'payment:updated', { orderId: order.id, payment: jsonValue(order.payment) }); }
        const ids = event.notificationIds ?? (event.notification?.id ? [event.notification.id] : []);
        if (ids.length) {
          const [notices, settings] = await Promise.all([db.notification.findMany({ where: { id: { in: ids }, userId: event.userId }, orderBy: { createdAt: 'asc' } }), db.userSettings.findUnique({ where: { userId: event.userId } })]);
          for (const notice of notices) ioEvent(`user:${event.userId}`, 'notification', notificationDto(notice, settings?.language));
        }
      })().catch(() => {});
    });
  } catch { subscriber = undefined; }
}
export async function closeRealtimeRedis() { if (subscriber?.isOpen) await subscriber.quit(); }
export function ioEvent(room: string | string[], event: string, payload: unknown) { io?.to(room).emit(event, payload); }
/** Removes an account's sockets from a room, e.g. a courier released from a delivery. */
export function leaveRoom(userId: string, room: string) { io?.in(`user:${userId}`).socketsLeave(room); }
export function disconnectSession(sessionId: string) {
  if (io) for (const socket of io.sockets.sockets.values()) if ((socket.data as Partial<SocketData>).user?.sessionId === sessionId) socket.disconnect(true);
}
export function disconnectUser(userId: string) {
  if (io) for (const socket of io.sockets.sockets.values()) if ((socket.data as Partial<SocketData>).user?.id === userId) socket.disconnect(true);
}
