import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '../config/database.js';
import { requireRestaurantStaff } from '../middleware/auth.js';
import { rateLimit } from '../middleware/security.js';
import { createAppSession, refreshAppSession, revokeAppSession } from '../services/auth.js';
import { disconnectSession } from '../services/realtime.js';
import { activeStatuses } from '../services/orders.js';
import { restaurantOrderListInclude, restaurantOrderSummaryDto } from '../services/dispatch-dto.js';
import { createInvitation, listRestaurantCouriers, listRestaurantInvitations, revokeInvitation } from '../services/affiliations.js';
import {
  advanceRestaurantOrder, advanceReward, cancelDispatch, cancelRestaurantOrder, decideCardPayment, endAffiliation, getRestaurantDelivery, getRestaurantOrder,
  markReadyForPickup, offerToOwnCourier, resolveIssue, settleCash, startFreeSearch,
} from '../services/dispatch.js';
import { ApiError, assert } from '../utils/errors.js';
import { jsonValue } from '../utils/serialize.js';
import { pageMetadata, paginationSchema } from '../utils/pagination.js';
import { idSchema, reasonSchema } from '../utils/validators.js';
import { actorOf, appLoginSchema, logoutSchema, mountAppNotifications, refreshSchema, routeId, verifyAppLogin } from './app-shared.js';

/**
 * Restaurant API for the future Windows application (no UI yet). Staff accounts are created by the
 * developer CLI; every order, delivery, issue and courier is resolved against the staff member's
 * own restaurant, never one named in the request.
 */
export const restaurantRouter = Router();

async function restaurantAccount(userId: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { settings: true, restaurantStaff: { include: { restaurant: { select: { id: true, slug: true, name: true, logoUrl: true, addressText: true, phone: true, city: true, serviceZone: true, isOpen: true } } } } } });
  assert(user.restaurantStaff, 403, 'FORBIDDEN', 'Аккаунт не привязан к ресторану');
  return { id: user.id, email: user.email, role: 'RESTAURANT' as const, settings: { language: user.settings?.language ?? 'ru', theme: user.settings?.theme ?? 'light' }, restaurant: user.restaurantStaff.restaurant };
}

restaurantRouter.post('/auth/login', rateLimit('restaurant-login', 20, 900), async (req, res) => {
  const input = appLoginSchema.parse(req.body);
  const user = await verifyAppLogin(input.email, input.password, 'RESTAURANT');
  // A staff account without a restaurant link gets the same answer as wrong credentials.
  if (!await db.restaurantStaff.findUnique({ where: { userId: user.id }, select: { userId: true } })) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Неверная почта или пароль');
  res.json({ data: { tokens: await createAppSession(user), account: await restaurantAccount(user.id) } });
});
restaurantRouter.post('/auth/refresh', rateLimit('restaurant-refresh', 120, 900), async (req, res) => {
  const { refreshToken } = refreshSchema.parse(req.body);
  res.json({ data: { tokens: await refreshAppSession(refreshToken, 'RESTAURANT') } });
});
restaurantRouter.post('/auth/logout', async (req, res) => {
  const { refreshToken } = logoutSchema.parse(req.body ?? {});
  const sessionId = await revokeAppSession(req.user, refreshToken);
  if (sessionId) disconnectSession(sessionId);
  res.json({ data: { loggedOut: true } });
});

restaurantRouter.use(requireRestaurantStaff);
const restaurantOf = (req: { restaurantId?: string }) => req.restaurantId!;
restaurantRouter.get('/me', async (req, res) => { res.json({ data: await restaurantAccount(req.user!.id) }); });

// Orders
restaurantRouter.get('/orders', async (req, res) => {
  const { page, pageSize, scope } = paginationSchema.extend({ scope: z.enum(['active', 'history', 'all']).default('active') }).parse(req.query);
  const where: Prisma.OrderWhereInput = { restaurantId: restaurantOf(req), ...(scope === 'active' ? { status: { in: activeStatuses } } : scope === 'history' ? { status: { notIn: activeStatuses } } : {}) };
  const [orders, total] = await Promise.all([
    db.order.findMany({ where, include: restaurantOrderListInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
    db.order.count({ where }),
  ]);
  res.json({ data: orders.map(restaurantOrderSummaryDto), pagination: pageMetadata(page, pageSize, total) });
});
restaurantRouter.get('/orders/:id', async (req, res) => { res.json({ data: await getRestaurantOrder(restaurantOf(req), routeId(req)) }); });
restaurantRouter.post('/orders/:id/accept', async (req, res) => { res.json({ data: await advanceRestaurantOrder(restaurantOf(req), routeId(req), 'ACCEPTED') }); });
restaurantRouter.post('/orders/:id/start-preparing', async (req, res) => { res.json({ data: await advanceRestaurantOrder(restaurantOf(req), routeId(req), 'PREPARING') }); });
restaurantRouter.post('/orders/:id/cancel', async (req, res) => {
  const { reason } = z.object({ reason: reasonSchema }).strict().parse(req.body);
  res.json({ data: await cancelRestaurantOrder(restaurantOf(req), routeId(req), reason, actorOf(req)) });
});
restaurantRouter.post('/orders/:id/payment', async (req, res) => {
  const input = z.object({ status: z.enum(['PAID', 'REJECTED']), reason: z.string().trim().max(500).optional() }).strict().parse(req.body);
  res.json({ data: await decideCardPayment(restaurantOf(req), routeId(req), input) });
});

// Delivery of an order
const reward = z.number().min(0).max(100_000_000).nullable().optional();
restaurantRouter.get('/orders/:id/delivery', async (req, res) => {
  await getRestaurantOrder(restaurantOf(req), routeId(req));
  res.json({ data: await getRestaurantDelivery(restaurantOf(req), routeId(req)) });
});
restaurantRouter.post('/orders/:id/delivery/offer', async (req, res) => {
  const input = z.object({ courierId: idSchema, reward }).strict().parse(req.body);
  res.json({ data: await offerToOwnCourier(restaurantOf(req), routeId(req), input, actorOf(req)) });
});
restaurantRouter.post('/orders/:id/delivery/search', async (req, res) => {
  const input = z.object({ reward }).strict().parse(req.body ?? {});
  res.json({ data: await startFreeSearch(restaurantOf(req), routeId(req), input, actorOf(req)) });
});
restaurantRouter.post('/orders/:id/delivery/cancel', async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().max(500).optional() }).strict().parse(req.body ?? {});
  res.json({ data: await cancelDispatch(restaurantOf(req), routeId(req), reason, actorOf(req)) });
});
restaurantRouter.post('/orders/:id/delivery/ready', async (req, res) => { res.json({ data: await markReadyForPickup(restaurantOf(req), routeId(req), actorOf(req)) }); });

// Couriers and invitations
restaurantRouter.get('/couriers', async (req, res) => {
  const { status } = z.object({ status: z.enum(['ACTIVE', 'ENDED', 'ALL']).default('ACTIVE') }).parse(req.query);
  res.json({ data: jsonValue(await listRestaurantCouriers(restaurantOf(req), status)) });
});
restaurantRouter.post('/couriers/:affiliationId/end', async (req, res) => {
  const ended = await endAffiliation(routeId(req, 'affiliationId'), { restaurantId: restaurantOf(req) }, actorOf(req));
  res.json({ data: jsonValue(ended) });
});
restaurantRouter.get('/courier-invitations', async (req, res) => { res.json({ data: jsonValue(await listRestaurantInvitations(restaurantOf(req))) }); });
restaurantRouter.post('/courier-invitations', rateLimit('invitation-create', 30, 3600), async (req, res) => {
  res.status(201).json({ data: await createInvitation(restaurantOf(req), actorOf(req)) });
});
restaurantRouter.post('/courier-invitations/:id/revoke', async (req, res) => { res.json({ data: await revokeInvitation(restaurantOf(req), routeId(req)) }); });

// Courier issues
restaurantRouter.get('/delivery-issues', async (req, res) => {
  const { status } = z.object({ status: z.enum(['OPEN', 'RESOLVED', 'ALL']).default('OPEN') }).parse(req.query);
  const issues = await db.deliveryIssue.findMany({
    where: { delivery: { restaurantId: restaurantOf(req) }, ...(status === 'ALL' ? {} : { status }) }, orderBy: { createdAt: 'desc' }, take: 100,
    include: { courier: { select: { firstName: true, lastName: true } }, delivery: { select: { id: true, orderId: true, status: true } } },
  });
  res.json({ data: jsonValue(issues.map(({ courier, ...issue }) => ({ ...issue, courierName: `${courier.firstName} ${courier.lastName}`.trim() }))) });
});
restaurantRouter.post('/delivery-issues/:id/resolve', async (req, res) => {
  const input = z.object({ resolution: z.enum(['CONFIRM_DELIVERED', 'APPROVE', 'REJECT']), note: z.string().trim().max(500).optional() }).strict().parse(req.body);
  res.json({ data: await resolveIssue(restaurantOf(req), routeId(req), input, actorOf(req)) });
});

// Money after delivery: cash settlement and courier reward (records only; UzBite moves no money)
restaurantRouter.post('/deliveries/:id/cash-settled', async (req, res) => { res.json({ data: await settleCash(restaurantOf(req), routeId(req), actorOf(req)) }); });
restaurantRouter.post('/deliveries/:id/reward/confirm', async (req, res) => { res.json({ data: await advanceReward(restaurantOf(req), routeId(req), 'CONFIRMED', actorOf(req)) }); });
restaurantRouter.post('/deliveries/:id/reward/paid', async (req, res) => { res.json({ data: await advanceReward(restaurantOf(req), routeId(req), 'PAID', actorOf(req)) }); });
mountAppNotifications(restaurantRouter);
