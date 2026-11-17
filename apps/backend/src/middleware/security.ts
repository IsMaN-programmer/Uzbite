import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import { env, allowedOrigins } from '../config/env.js';
import { redis } from '../config/database.js';
import { ApiError } from '../utils/errors.js';

export const csrfCookie = 'uzbite_csrf';
/** Courier/restaurant native clients send `X-UzBite-Client: app` and/or a Bearer token. */
export function isAppRequest(req: Request) { return req.get('x-uzbite-client') === 'app' || Boolean(req.get('authorization')); }
export const csrfIssue: RequestHandler = (req, res) => {
  const existing: unknown = req.cookies[csrfCookie];
  const csrfToken = typeof existing === 'string' && /^[a-f0-9]{64}$/.test(existing) ? existing : randomBytes(32).toString('hex');
  res.cookie(csrfCookie, csrfToken, { sameSite: 'lax', secure: env.NODE_ENV === 'production', httpOnly: false, path: '/', maxAge: 30 * 86400_000 });
  res.json({ data: { csrfToken } });
};
export const csrfProtection: RequestHandler = (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) { next(); return; }
  const origin = req.get('origin');
  // Native-app requests carry no ambient credentials (cookies are ignored for them) and use custom
  // headers that a cross-site page cannot send without a CORS preflight the allow-list rejects.
  if (isAppRequest(req) && (!origin || allowedOrigins.includes(origin))) { next(); return; }
  if (origin && !allowedOrigins.includes(origin)) { next(new ApiError(403, 'ORIGIN_FORBIDDEN', 'Источник запроса не разрешён')); return; }
  const a = req.cookies[csrfCookie] as unknown;
  const b = req.get('x-csrf-token');
  if (typeof a !== 'string' || !b || !/^[a-f0-9]{64}$/.test(a) || !/^[a-f0-9]{64}$/.test(b) || !timingSafeEqual(Buffer.from(a), Buffer.from(b))) { next(new ApiError(403, 'CSRF', 'Обновите страницу и повторите действие')); return; }
  next();
};
const fallbackCounters = new Map<string, { count: number; expiresAt: number }>();
export const rateLimit = (scope: string, limit: number, seconds: number): RequestHandler => async (req, res, next) => {
  const identity = req.user ? `user:${req.user.id}` : `ip:${req.ip ?? 'unknown'}`;
  const key = `rate:${scope}:${identity}`;
  if (!redis.isReady) {
    if (env.NODE_ENV === 'production') { next(new ApiError(503, 'RATE_LIMIT_UNAVAILABLE', 'Сервис временно недоступен. Попробуйте позже')); return; }
    const now = Date.now();
    for (const [k, item] of fallbackCounters) if (item.expiresAt < now) fallbackCounters.delete(k);
    const item = fallbackCounters.get(key) ?? { count: 0, expiresAt: now + seconds * 1000 };
    item.count += 1;
    fallbackCounters.set(key, item);
    if (item.count > limit) { res.setHeader('Retry-After', seconds); next(new ApiError(429, 'RATE_LIMIT', 'Слишком много запросов. Попробуйте позже')); return; }
    next(); return;
  }
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, seconds);
    if (count > limit) { res.setHeader('Retry-After', seconds); next(new ApiError(429, 'RATE_LIMIT', 'Слишком много запросов. Попробуйте позже')); return; }
    next();
  } catch { next(new ApiError(503, 'RATE_LIMIT_UNAVAILABLE', 'Сервис временно недоступен')); }
};
