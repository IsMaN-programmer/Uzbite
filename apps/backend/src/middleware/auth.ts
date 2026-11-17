import type { RequestHandler } from 'express';
import { accessCookie, identityFromAccess } from '../services/auth.js';
import { ApiError } from '../utils/errors.js';

export const optionalAuth: RequestHandler = async (req, _res, next) => {
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
