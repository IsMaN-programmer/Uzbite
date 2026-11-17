import type { Request, Router } from 'express';
import bcrypt from 'bcryptjs';
import { Prisma, type Role } from '@prisma/client';
import { z } from 'zod';
import { db } from '../config/database.js';
import { ApiError, assert } from '../utils/errors.js';
import { DUMMY_PASSWORD_HASH, emailSchema, loginPasswordSchema } from '../utils/validators.js';
import { paginationSchema, pageMetadata } from '../utils/pagination.js';
import { notificationDto } from '../services/notifications.js';
import type { DispatchActor } from '../services/dispatch.js';

/** Shared pieces of the native-app APIs (courier mobile app, restaurant Windows app). */
export const appLoginSchema = z.object({ email: emailSchema, password: loginPasswordSchema }).strict();
export const refreshSchema = z.object({ refreshToken: z.string().min(20).max(4096) }).strict();
export const logoutSchema = z.object({ refreshToken: z.string().max(4096).optional() }).strict();

/** Same answer and timing for an unknown email, a wrong password and an account of another role. */
export async function verifyAppLogin(email: string, password: string, role: Role) {
  const user = await db.user.findUnique({ where: { email } });
  const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  assert(user && valid && user.role === role, 401, 'INVALID_CREDENTIALS', 'Неверная почта или пароль');
  return user;
}
export const actorOf = (req: Request): DispatchActor => ({ id: req.user!.id, role: req.user!.role as DispatchActor['role'] });
export const routeId = (req: Request, name = 'id') => req.params[name] as string;
export function emailTaken(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && JSON.stringify(error.meta?.target ?? '').includes('email');
}
export const emailTakenError = () => new ApiError(409, 'EMAIL_TAKEN', 'Эта почта уже зарегистрирована');

/** Own notifications, localized by the account's language; `read` marks given ids or all of them. */
export function mountAppNotifications(router: Router) {
  router.get('/notifications', async (req, res) => {
    const { page, pageSize } = paginationSchema.parse(req.query);
    const where = { userId: req.user!.id };
    const [items, total, unreadCount, settings] = await Promise.all([
      db.notification.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
      db.notification.count({ where }), db.notification.count({ where: { ...where, readAt: null } }), db.userSettings.findUnique({ where: { userId: req.user!.id } }),
    ]);
    res.json({ data: items.map(item => notificationDto(item, settings?.language)), pagination: pageMetadata(page, pageSize, total), unreadCount });
  });
  router.patch('/notifications/read', async (req, res) => {
    const { ids } = z.object({ ids: z.array(z.string().min(1).max(100)).min(1).max(100).optional() }).strict().parse(req.body ?? {});
    const updated = await db.notification.updateMany({ where: { userId: req.user!.id, readAt: null, ...(ids ? { id: { in: ids } } : {}) }, data: { readAt: new Date() } });
    res.json({ data: { read: updated.count } });
  });
}
