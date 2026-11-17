import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { allowedOrigins } from '../config/env.js';
import { db, redis } from '../config/database.js';
import { accessCookie, identityFromAccess } from './auth.js';
import { orderInclude } from './orders.js';
import { jsonValue } from '../utils/serialize.js';
import { notificationDto } from './notifications.js';

let io: Server | undefined;
let subscriber: ReturnType<typeof redis.duplicate> | undefined;
export function initRealtime(server: HttpServer) {
  io = new Server(server, { cors: { origin: allowedOrigins, credentials: true }, maxHttpBufferSize: 16 * 1024 });
  io.use(async (socket, next) => {
    try {
      const origin = socket.handshake.headers.origin;
      if (origin && !allowedOrigins.includes(origin)) throw new Error('Origin forbidden');
      const cookies = Object.fromEntries((socket.handshake.headers.cookie ?? '').split(';').map(item => item.trim().split('=')));
      const token = cookies[accessCookie];
      if (!token) throw new Error('Missing token');
      socket.data.user = await identityFromAccess(decodeURIComponent(token));
      next();
    } catch { next(new Error('Unauthorized')); }
  });
  io.on('connection', socket => {
    const userId = socket.data.user.id as string;
    void socket.join(`user:${userId}`);
    socket.on('order:join', async (orderId: unknown, ack?: (data: { ok: boolean }) => void) => {
      const respond = (ok: boolean) => { if (typeof ack === 'function') ack({ ok }); };
      if (typeof orderId !== 'string' || orderId.length > 100) { respond(false); return; }
      try {
        await identityFromAccess(String(socket.handshake.headers.cookie?.split(';').map(item => item.trim()).find(item => item.startsWith(`${accessCookie}=`))?.slice(accessCookie.length + 1) ?? ''));
        const order = await db.order.findFirst({ where: { id: orderId, userId }, select: { id: true } });
        if (!order) { respond(false); return; }
        await socket.join(`order:${orderId}`); respond(true);
      } catch { respond(false); }
    });
    socket.on('post:join', async (postId: unknown) => {
      if (typeof postId !== 'string' || postId.length > 100) return;
      try { if (await db.post.findUnique({ where: { id: postId }, select: { id: true } })) await socket.join(`post:${postId}`); } catch { /* REST remains source of truth. */ }
    });
    socket.on('post:leave', (postId: unknown) => { if (typeof postId === 'string' && postId.length <= 100) void socket.leave(`post:${postId}`); });
    // Access credentials expire even on a long-lived socket; the browser refreshes and reconnects.
    const expiry = setTimeout(() => socket.disconnect(true), Math.max(0, Number(socket.data.user.accessExpiresAt) - Date.now()));
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
        if (order) { ioEvent([`user:${event.userId}`, `order:${order.id}`], 'order:updated', jsonValue(order)); ioEvent(`user:${event.userId}`, 'payment:updated', { orderId: order.id, payment: jsonValue(order.payment) }); }
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
export function disconnectSession(sessionId: string) {
  if (io) for (const socket of io.sockets.sockets.values()) if (socket.data.user?.sessionId === sessionId) socket.disconnect(true);
}
export function disconnectUser(userId: string) {
  if (io) for (const socket of io.sockets.sockets.values()) if (socket.data.user?.id === userId) socket.disconnect(true);
}
