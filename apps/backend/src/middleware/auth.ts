import type { RequestHandler } from 'express';
import { accessCookie, identityFromAccess, identityFromBearer } from '../services/auth.js';
import { db } from '../config/database.js';
import { ApiError } from '../utils/errors.js';
import { isAppRequest } from './security.js';

declare module 'express-serve-static-core' { interface Request { restaurantId?: string } }

/** Native apps authenticate with `Authorization: Bearer`; the browser keeps HttpOnly cookies. Never both. */
export function bearerToken(header: string | undefined) {
  const match = /^Bearer ([A-Za-z0-9._-]{20,4096})$/.exec(header ?? '');
  return match?.[1];
}
export const optionalAuth: RequestHandler = async (req, _res, next) => {
  const authorization = req.get('authorization');
  if (authorization || isAppRequest(req)) {
    if (!authorization) { next(); return; }
    const token = bearerToken(authorization);
    if (!token) { next(new ApiError(401, 'UNAUTHORIZED', 'Сессия истекла. Войдите снова')); return; }
    try { req.user = await identityFromBearer(token); next(); }
    catch (error) { next(error); }
    return;
  }
  const token: unknown = req.cookies[accessCookie];
  if (typeof token === 'string') {
    try { req.user = await identityFromAccess(token); }
    catch (error) { if (!(error instanceof ApiError && error.status === 401)) { next(error); return; } }
  }
  next();
};
export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user || req.user.role !== 'USER') { next(new ApiError(401, 'UNAUTHORIZED', 'Войдите в аккаунт пользователя')); return; }
  next();
};
export const requireCourier: RequestHandler = (req, _res, next) => {
  if (!req.user) { next(new ApiError(401, 'UNAUTHORIZED', 'Войдите в аккаунт курьера')); return; }
  if (req.user.role !== 'COURIER' || req.user.via !== 'bearer') { next(new ApiError(403, 'FORBIDDEN', 'Раздел доступен только курьерам')); return; }
  next();
};
/** Restaurant staff act only for the restaurant linked to their account, never one named in the request. */
export const requireRestaurantStaff: RequestHandler = async (req, _res, next) => {
  try {
    if (!req.user) throw new ApiError(401, 'UNAUTHORIZED', 'Войдите в аккаунт ресторана');
    if (req.user.role !== 'RESTAURANT' || req.user.via !== 'bearer') throw new ApiError(403, 'FORBIDDEN', 'Раздел доступен только ресторанам');
    const staff = await db.restaurantStaff.findUnique({ where: { userId: req.user.id }, select: { restaurantId: true } });
    if (!staff) throw new ApiError(403, 'FORBIDDEN', 'Аккаунт не привязан к ресторану');
    req.restaurantId = staff.restaurantId;
    next();
  } catch (error) { next(error); }
};
