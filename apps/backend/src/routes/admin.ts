import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { ApiError } from '../utils/errors.js';
import { approveCourier, courierApplication, courierFacePhoto, listCourierApplications, rejectCourier, REVIEW_STATUSES } from '../services/courier-admin.js';
import { routeId } from './app-shared.js';
import { ADMIN_PAGE_HTML, ADMIN_PAGE_JS } from './admin-page.js';

/**
 * Internal support API, separate from the courier and customer APIs (/api/admin/*).
 * No support accounts yet: `requireSupport` lets everyone in during development and, in production,
 * only requests with `X-Admin-Key: $ADMIN_API_KEY`. Real support sign-in and roles (SUPPORT, ADMIN)
 * replace this one middleware later; the routes stay as they are.
 */
const requireSupport: RequestHandler = (req, _res, next) => {
  if (env.NODE_ENV !== 'production') { next(); return; }
  const key = process.env.ADMIN_API_KEY;
  if (key && req.get('x-admin-key') === key) { next(); return; }
  next(new ApiError(403, 'SUPPORT_ONLY', 'Доступ только для поддержки'));
};

export const adminRouter = Router();
adminRouter.use(requireSupport);
adminRouter.get('/couriers', async (req, res) => {
  const { status } = z.object({ status: z.enum([...REVIEW_STATUSES, 'ALL']).default('PENDING') }).parse(req.query);
  res.json({ data: await listCourierApplications(status) });
});
adminRouter.get('/couriers/:id', async (req, res) => { res.json({ data: await courierApplication(routeId(req)) }); });
adminRouter.get('/couriers/:id/face-photo', async (req, res) => {
  const photo = await courierFacePhoto(routeId(req));
  res.setHeader('Cache-Control', 'no-store');
  res.type(photo.mimeType).send(photo.bytes);
});
adminRouter.post('/couriers/:id/approve', async (req, res) => { res.json({ data: await approveCourier(routeId(req)) }); });
adminRouter.post('/couriers/:id/reject', async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().max(500).optional() }).strict().parse(req.body ?? {});
  res.json({ data: await rejectCourier(routeId(req), reason || null) });
});

/** The support page itself: plain HTML + a script file (the CSP allows only same-origin scripts). */
export const adminPageRouter = Router();
// Own CSP: same-origin script and API, photos as data: URLs, no https upgrade (the panel runs on plain HTTP in development).
const PAGE_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
adminPageRouter.get('/', (_req, res) => { res.setHeader('Content-Security-Policy', PAGE_CSP); res.type('html').send(ADMIN_PAGE_HTML); });
adminPageRouter.get('/app.js', (_req, res) => { res.type('application/javascript').send(ADMIN_PAGE_JS); });
