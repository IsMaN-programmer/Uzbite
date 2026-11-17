import { db } from '../config/database.js';
import { customerOrderJson, orderInclude } from './orders.js';
import { notificationDto } from './notifications.js';
import { ioEvent } from './realtime.js';

/**
 * Realtime side effects collected during a transaction and emitted only after it commits.
 * Socket payloads are hints: every client re-reads REST, which reflects PostgreSQL.
 */
export class Outbox {
  private events: { room: string; event: string; payload: unknown }[] = [];
  private customerOrders = new Set<string>();
  private customerNotifications: string[] = [];
  private accountNotifications: string[] = [];
  emit(room: string, event: string, payload: unknown) { this.events.push({ room, event, payload }); return this; }
  courier(courierId: string, event: string, payload: unknown) { return this.emit(`courier:${courierId}`, event, payload); }
  restaurant(restaurantId: string, event: string, payload: unknown) { return this.emit(`restaurant:${restaurantId}`, event, payload); }
  customerOrder(orderId: string) { this.customerOrders.add(orderId); return this; }
  customerNotification(id: string) { this.customerNotifications.push(id); return this; }
  accountNotification(id: string) { this.accountNotifications.push(id); return this; }
  async flush() {
    try {
      for (const item of this.events) ioEvent(item.room, item.event, item.payload);
      for (const orderId of this.customerOrders) {
        const order = await db.order.findUnique({ where: { id: orderId }, include: orderInclude });
        if (order) ioEvent([`user:${order.userId}`, `order:${order.id}`], 'order:updated', customerOrderJson(order));
      }
      const ids = [...this.customerNotifications, ...this.accountNotifications];
      if (ids.length) {
        const notices = await db.notification.findMany({ where: { id: { in: ids } }, include: { user: { select: { settings: { select: { language: true } } } } }, orderBy: { createdAt: 'asc' } });
        for (const { user, ...notice } of notices) {
          // The customer web app listens to `notification`; native apps to `notification:created`.
          const event = this.customerNotifications.includes(notice.id) ? 'notification' : 'notification:created';
          ioEvent(`user:${notice.userId}`, event, notificationDto(notice, user.settings?.language));
        }
      }
    } catch { /* The state is committed; clients resynchronise over REST after reconnecting. */ }
  }
}
