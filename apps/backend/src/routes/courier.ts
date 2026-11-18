import { randomUUID } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { z } from 'zod';
import { db } from '../config/database.js';
import { env } from '../config/env.js';
import { requireCourier } from '../middleware/auth.js';
import { rateLimit } from '../middleware/security.js';
import { createAppSession, refreshAppSession, revokeAppSession } from '../services/auth.js';
import { disconnectSession } from '../services/realtime.js';
import { courierAccount, courierEarnings, courierHistory, setCourierFacePhoto, setCourierLocation, setCourierPassport, updateOnboarding } from '../services/courier-account.js';
import { acceptInvitation, claimInvitation, courierAffiliation, listCourierAffiliations, listCourierInvitations, rejectInvitation } from '../services/affiliations.js';
import { courierMap } from '../services/courier-map.js';
import {
  acceptOffer, completeDelivery, confirmCashCollected, confirmPickup, endAffiliation, getActiveCourierDelivery, getCourierDelivery, getCourierOffer,
  listCourierOffers, listNearbyOrders, rejectOffer, reportHandoffProblem, requestCourierCancellation, setCourierServiceArea, setCourierWorkMode, startDelivery, takeOrder,
} from '../services/dispatch.js';
import { assert } from '../utils/errors.js';
import { pageMetadata, paginationSchema } from '../utils/pagination.js';
import { emailSchema, loginPasswordSchema, newPasswordSchema, phoneSchema, reasonSchema } from '../utils/validators.js';
import { serviceAreaSchema } from '../utils/zones.js';
import { actorOf, appLoginSchema, emailTaken, emailTakenError, logoutSchema, mountAppNotifications, refreshSchema, routeId, verifyAppLogin } from './app-shared.js';

/**
 * Courier mobile app API. Bearer tokens only (never cookies); the role is fixed to COURIER by the
 * server and cannot be supplied by the client. Every id is checked against the signed-in courier.
 */
export const courierRouter = Router();
const nameSchema = z.string().trim().min(1).max(60);
/** Name, passport and face photo are collected in onboarding step 1, not at registration. */
const registerSchema = z.object({
  email: emailSchema, phone: phoneSchema,
  password: newPasswordSchema, passwordConfirmation: z.string().max(72),
  language: z.enum(['ru', 'uz', 'en']).default('ru'), theme: z.enum(['light', 'dark']).default('light'),
}).strict().refine(input => input.password === input.passwordConfirmation, { path: ['passwordConfirmation'], message: 'Пароли не совпадают' });

courierRouter.post('/auth/register', rateLimit('courier-register', env.NODE_ENV === 'production' ? 10 : 200, 3600), async (req, res) => {
  const input = registerSchema.parse(req.body);
  const passwordHash = await bcrypt.hash(input.password, 12);
  const handle = `courier_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
  let session: { userId: string; tokens: Awaited<ReturnType<typeof createAppSession>> };
  try {
    session = await db.$transaction(async tx => {
      const user = await tx.user.create({ data: {
        email: input.email, phone: input.phone, name: '', username: handle, passwordHash, role: 'COURIER',
        settings: { create: { language: input.language, theme: input.theme } },
        courierProfile: { create: { firstName: '' } },
      } });
      return { userId: user.id, tokens: await createAppSession(user, tx) };
    });
  } catch (error) { if (emailTaken(error)) throw emailTakenError(); throw error; }
  res.status(201).json({ data: { tokens: session.tokens, account: await courierAccount(session.userId) } });
});
courierRouter.post('/auth/login', rateLimit('courier-login', env.NODE_ENV === 'production' ? 20 : 200, 900), async (req, res) => {
  const input = appLoginSchema.parse(req.body);
  const user = await verifyAppLogin(input.email, input.password, 'COURIER');
  res.json({ data: { tokens: await createAppSession(user), account: await courierAccount(user.id) } });
});
/** Send the refresh token without an Authorization header: the access token may already be expired. */
courierRouter.post('/auth/refresh', rateLimit('courier-refresh', 120, 900), async (req, res) => {
  const { refreshToken } = refreshSchema.parse(req.body);
  res.json({ data: { tokens: await refreshAppSession(refreshToken, 'COURIER') } });
});
courierRouter.post('/auth/logout', async (req, res) => {
  const { refreshToken } = logoutSchema.parse(req.body ?? {});
  const sessionId = await revokeAppSession(req.user, refreshToken);
  if (sessionId) disconnectSession(sessionId);
  res.json({ data: { loggedOut: true } });
});

courierRouter.use(requireCourier);
const me = (req: { user?: { id: string } }) => req.user!.id;
courierRouter.get('/me', async (req, res) => { res.json({ data: await courierAccount(me(req)) }); });
courierRouter.get('/profile', async (req, res) => { res.json({ data: await courierAccount(me(req)) }); });

/** Uzbek passport / ID card: 2 Latin letters and 7 digits. Spaces are ignored, letters upper-cased. */
const passportSeriesSchema = z.string().transform(value => value.replace(/\s/g, '').toUpperCase()).pipe(z.string().regex(/^[A-Z]{2}$/, 'Серия — две латинские буквы'));
const passportNumberSchema = z.string().transform(value => value.replace(/\s/g, '')).pipe(z.string().regex(/^[0-9]{7}$/, 'Номер — 7 цифр'));
const profileSchema = z.object({
  firstName: nameSchema.optional(), lastName: nameSchema.optional(), phone: phoneSchema.optional(), email: emailSchema.optional(),
  passportSeries: passportSeriesSchema.optional(), passportNumber: passportNumberSchema.optional(),
  currentPassword: loginPasswordSchema.optional(), newPassword: newPasswordSchema.optional(),
}).strict().refine(input => (input.passportSeries === undefined) === (input.passportNumber === undefined), { path: ['passportNumber'], message: 'Укажите серию и номер паспорта' });
const updateProfile: RequestHandler = async (req, res) => {
  const input = profileSchema.parse(req.body);
  const user = await db.user.findUniqueOrThrow({ where: { id: me(req) }, include: { courierProfile: true } });
  if ((input.email && input.email !== user.email) || input.newPassword) {
    assert(input.currentPassword && await bcrypt.compare(input.currentPassword, user.passwordHash), 403, 'PASSWORD_REQUIRED', 'Введите текущий пароль');
  }
  const passwordHash = input.newPassword ? await bcrypt.hash(input.newPassword, 12) : undefined;
  const firstName = input.firstName ?? user.courierProfile!.firstName, lastName = input.lastName ?? user.courierProfile!.lastName;
  try {
    await db.$transaction(async tx => {
      await tx.user.update({ where: { id: user.id }, data: {
        name: `${firstName} ${lastName}`.trim(), phone: input.phone, email: input.email, ...(passwordHash ? { passwordHash } : {}),
        courierProfile: { update: { firstName, lastName } },
      } });
      if (input.passportSeries && input.passportNumber) await setCourierPassport(user.id, input.passportSeries, input.passportNumber, tx);
      // A new password ends every other session; this device stays signed in.
      if (passwordHash) await tx.session.deleteMany({ where: { userId: user.id, id: { not: req.user!.sessionId } } });
    });
  } catch (error) { if (emailTaken(error)) throw emailTakenError(); throw error; }
  res.json({ data: await courierAccount(user.id) });
};
courierRouter.patch('/me', rateLimit('courier-profile', 30, 3600), updateProfile);
courierRouter.patch('/profile', rateLimit('courier-profile', 30, 3600), updateProfile);

courierRouter.get('/settings', async (req, res) => { res.json({ data: (await courierAccount(me(req))).settings }); });
courierRouter.patch('/settings', async (req, res) => {
  const input = z.object({ language: z.enum(['ru', 'uz', 'en']).optional(), theme: z.enum(['light', 'dark']).optional() }).strict().parse(req.body);
  await db.userSettings.upsert({ where: { userId: me(req) }, create: { userId: me(req), language: input.language ?? 'ru', theme: input.theme ?? 'light' }, update: input });
  res.json({ data: (await courierAccount(me(req))).settings });
});
// No availability switch: a courier permitted for the current mode is always on duty (see dispatch.ts).
courierRouter.patch('/work-mode', async (req, res) => {
  const { mode } = z.object({ mode: z.enum(['RESTAURANT', 'FREELANCE']) }).strict().parse(req.body);
  await setCourierWorkMode(me(req), mode);
  res.json({ data: await courierAccount(me(req)) });
});
courierRouter.patch('/service-area', async (req, res) => {
  const { city } = serviceAreaSchema.parse(req.body);
  await setCourierServiceArea(me(req), city);
  res.json({ data: await courierAccount(me(req)) });
});
/** Selfie for UzBite admission (multipart field `file`). Private: never shown to restaurants. */
const facePhotoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 0 } });
courierRouter.post('/identity/face-photo', rateLimit('courier-face-photo', 30, 3600), facePhotoUpload.single('file'), async (req, res) => {
  res.status(201).json({ data: await setCourierFacePhoto(me(req), req.file) });
});
courierRouter.patch('/onboarding', async (req, res) => {
  const input = z.object({ step: z.number().int().min(1).max(4).optional(), complete: z.literal(true).optional() }).strict()
    .refine(value => value.step !== undefined || value.complete, { message: 'Укажите шаг или завершение' }).parse(req.body);
  res.json({ data: await updateOnboarding(me(req), input) });
});

// Restaurant invitations and affiliations
courierRouter.post('/restaurant-invitations/claim', rateLimit('invitation-claim', 10, 900), async (req, res) => {
  const { code } = z.object({ code: z.string().trim().min(8).max(20) }).strict().parse(req.body);
  res.json({ data: await claimInvitation(me(req), code) });
});
courierRouter.get('/restaurant-invitations', async (req, res) => { res.json({ data: await listCourierInvitations(me(req)) }); });
courierRouter.post('/restaurant-invitations/:id/accept', async (req, res) => { res.json({ data: await acceptInvitation(me(req), routeId(req)) }); });
courierRouter.post('/restaurant-invitations/:id/reject', async (req, res) => { res.json({ data: await rejectInvitation(me(req), routeId(req)) }); });
courierRouter.get('/affiliations', async (req, res) => { res.json({ data: await listCourierAffiliations(me(req)) }); });
courierRouter.post('/affiliations/:id/end', async (req, res) => {
  await endAffiliation(routeId(req), { courierId: me(req) }, actorOf(req));
  res.json({ data: await courierAffiliation(routeId(req)) });
});

// Offers: the timer is driven by serverTime; an offer is accepted only when the server says so.
const actions = rateLimit('courier-actions', 120, 60);
courierRouter.get('/delivery-offers', async (req, res) => {
  const { serverTime, items } = await listCourierOffers(me(req));
  res.json({ data: items, serverTime });
});
// MVP: open orders within 5 km of the courier's last position; the first courier to take one gets it.
courierRouter.patch('/location', rateLimit('courier-location', 600, 3600), async (req, res) => {
  const { latitude, longitude } = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }).strict().parse(req.body);
  await setCourierLocation(me(req), latitude, longitude);
  res.json({ data: { saved: true } });
});
courierRouter.get('/nearby-orders', async (req, res) => { res.json({ data: await listNearbyOrders(me(req)) }); });
courierRouter.post('/orders/:id/take', actions, async (req, res) => { res.json({ data: await takeOrder(me(req), routeId(req)) }); });
/** Restaurants waiting for a courier now: free searches of the courier's city and personal offers. */
courierRouter.get('/map', async (req, res) => { res.json({ data: await courierMap(me(req)) }); });
courierRouter.get('/delivery-offers/:id', async (req, res) => { res.json({ data: await getCourierOffer(me(req), routeId(req)), serverTime: new Date().toISOString() }); });
courierRouter.post('/delivery-offers/:id/accept', actions, async (req, res) => { res.json({ data: await acceptOffer(me(req), routeId(req)) }); });
courierRouter.post('/delivery-offers/:id/reject', actions, async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().max(500).optional() }).strict().parse(req.body ?? {});
  res.json({ data: await rejectOffer(me(req), routeId(req), reason) });
});

// The assigned delivery
courierRouter.get('/deliveries/active', async (req, res) => { res.json({ data: await getActiveCourierDelivery(me(req)) }); });
courierRouter.get('/deliveries/:id', async (req, res) => { res.json({ data: await getCourierDelivery(me(req), routeId(req)) }); });
courierRouter.post('/deliveries/:id/pickup', actions, async (req, res) => { res.json({ data: await confirmPickup(me(req), routeId(req)) }); });
courierRouter.post('/deliveries/:id/start', actions, async (req, res) => { res.json({ data: await startDelivery(me(req), routeId(req)) }); });
courierRouter.post('/deliveries/:id/cash-collected', actions, async (req, res) => { res.json({ data: await confirmCashCollected(me(req), routeId(req)) }); });
courierRouter.post('/deliveries/:id/complete', actions, async (req, res) => {
  const { code } = z.object({ code: z.string().regex(/^\d{4}$/) }).strict().parse(req.body);
  res.json({ data: await completeDelivery(me(req), routeId(req), code) });
});
courierRouter.post('/deliveries/:id/request-cancellation', actions, async (req, res) => {
  const { reason } = z.object({ reason: reasonSchema }).strict().parse(req.body);
  res.json({ data: await requestCourierCancellation(me(req), routeId(req), reason) });
});
courierRouter.post('/deliveries/:id/handoff-problem', actions, async (req, res) => {
  const { reason } = z.object({ reason: reasonSchema }).strict().parse(req.body);
  res.json({ data: await reportHandoffProblem(me(req), routeId(req), reason) });
});

courierRouter.get('/history', async (req, res) => {
  const { page, pageSize, filter } = paginationSchema.extend({ filter: z.enum(['all', 'completed', 'cancelled', 'restaurant', 'freelance']).default('all') }).parse(req.query);
  const { items, total } = await courierHistory(me(req), filter, page, pageSize);
  res.json({ data: items, pagination: pageMetadata(page, pageSize, total) });
});
courierRouter.get('/earnings', async (req, res) => { res.json({ data: await courierEarnings(me(req)) }); });
mountAppNotifications(courierRouter);
