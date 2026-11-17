import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import type { Prisma } from '@prisma/client';
import { env } from '../config/env.js';
import { db } from '../config/database.js';
import { ApiError } from '../utils/errors.js';

const secure = env.NODE_ENV === 'production';
const commonCookie = { httpOnly: true, secure, sameSite: 'lax' as const, path: '/' };
export const accessCookie = 'uzbite_access';
const refreshCookie = 'uzbite_refresh';
export type Identity = { id: string; role: string; tokenVersion: number; sessionId: string; accessExpiresAt: number; via: 'cookie' | 'bearer' };
/** Native apps (courier, restaurant desktop) cannot rely on browser cookies, so they get separate audiences. */
const appAudience = 'uzbite-app';
const appRefreshAudience = 'uzbite-app-refresh';
declare module 'express-serve-static-core' { interface Request { user?: Identity } }

function hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
const refreshSecret = () => env.JWT_REFRESH_SECRET ?? `${env.JWT_SECRET}:refresh`;
function decode(token: string, refresh = false, audience = refresh ? 'uzbite-refresh' : 'uzbite-web'): JwtPayload {
  const payload = jwt.verify(token, refresh ? refreshSecret() : env.JWT_SECRET, { algorithms: ['HS256'], issuer: 'uzbite', audience });
  if (typeof payload === 'string' || typeof payload.sub !== 'string' || typeof payload.sid !== 'string' || typeof payload.ver !== 'number') throw new Error('Invalid token');
  return payload;
}
export async function identityFromAccess(token: string): Promise<Identity> {
  try {
    const payload = decode(token);
    const session = await db.session.findUnique({ where: { id: payload.sid as string }, include: { user: true } });
    if (!session || session.expiresAt < new Date() || session.userId !== payload.sub || session.user.tokenVersion !== payload.ver || session.user.role !== 'USER') throw new Error('Revoked');
    return { id: session.userId, role: session.user.role, tokenVersion: session.user.tokenVersion, sessionId: session.id, accessExpiresAt: Math.min((payload.exp ?? 0) * 1000, session.expiresAt.getTime()), via: 'cookie' };
  } catch (error) {
    if (error instanceof Error && error.name.startsWith('Prisma')) throw error;
    throw new ApiError(401, 'UNAUTHORIZED', 'Войдите в аккаунт');
  }
}
/** Bearer access token from a native app. Any role; each route group enforces its own role. */
export async function identityFromBearer(token: string): Promise<Identity> {
  try {
    const payload = decode(token, false, appAudience);
    const session = await db.session.findUnique({ where: { id: payload.sid as string }, include: { user: true } });
    if (!session || session.expiresAt < new Date() || session.userId !== payload.sub || session.user.tokenVersion !== payload.ver || payload.role !== session.user.role) throw new Error('Revoked');
    return { id: session.userId, role: session.user.role, tokenVersion: session.user.tokenVersion, sessionId: session.id, accessExpiresAt: Math.min((payload.exp ?? 0) * 1000, session.expiresAt.getTime()), via: 'bearer' };
  } catch (error) {
    if (error instanceof Error && error.name.startsWith('Prisma')) throw error;
    throw new ApiError(401, 'UNAUTHORIZED', 'Сессия истекла. Войдите снова');
  }
}
function signAppTokens(user: { id: string; role: string; tokenVersion: number }, sessionId: string, nonce: string) {
  const accessExpiresAt = new Date(Date.now() + 15 * 60_000);
  const accessToken = jwt.sign({ sid: sessionId, ver: user.tokenVersion, role: user.role }, env.JWT_SECRET, { subject: user.id, issuer: 'uzbite', audience: appAudience, algorithm: 'HS256', expiresIn: '15m' });
  const refreshToken = jwt.sign({ sid: sessionId, ver: user.tokenVersion, nonce }, refreshSecret(), { subject: user.id, issuer: 'uzbite', audience: appRefreshAudience, algorithm: 'HS256', expiresIn: '30d' });
  return { accessToken, refreshToken, accessExpiresAt: accessExpiresAt.toISOString() };
}
/** Creates a server session for a native app; tokens travel in JSON, never in cookies. */
export async function createAppSession(user: { id: string; role: string; tokenVersion: number }, tx: Prisma.TransactionClient = db) {
  const nonce = randomBytes(32).toString('hex');
  await tx.session.deleteMany({ where: { userId: user.id, expiresAt: { lte: new Date() } } });
  const session = await tx.session.create({ data: { userId: user.id, refreshHash: hash(nonce), expiresAt: new Date(Date.now() + 30 * 86400_000) } });
  return signAppTokens(user, session.id, nonce);
}
/** Rotates an app refresh token. A reused (already rotated) token is rejected. */
export async function refreshAppSession(refreshToken: string, expectedRole: string) {
  try {
    const payload = decode(refreshToken, true, appRefreshAudience);
    if (typeof payload.nonce !== 'string') throw new Error('Invalid');
    const session = await db.session.findUnique({ where: { id: payload.sid as string }, include: { user: true } });
    const digest = hash(payload.nonce);
    if (!session || session.userId !== payload.sub || session.expiresAt < new Date() || session.user.tokenVersion !== payload.ver || session.user.role !== expectedRole || !timingSafeEqual(Buffer.from(session.refreshHash), Buffer.from(digest))) throw new Error('Revoked');
    const nonce = randomBytes(32).toString('hex');
    const rotated = await db.session.updateMany({ where: { id: session.id, refreshHash: digest }, data: { refreshHash: hash(nonce) } });
    if (rotated.count !== 1) throw new Error('Already rotated');
    return signAppTokens(session.user, session.id, nonce);
  } catch (error) {
    if (error instanceof Error && error.name.startsWith('Prisma')) throw error;
    throw new ApiError(401, 'UNAUTHORIZED', 'Сессия истекла. Войдите снова');
  }
}
/** Logout for native apps: the refresh token identifies the session even if the access token expired. */
export async function revokeAppSession(identity: Identity | undefined, refreshToken: unknown) {
  let sessionId = identity?.via === 'bearer' ? identity.sessionId : undefined;
  let userId = identity?.via === 'bearer' ? identity.id : undefined;
  if (!sessionId && typeof refreshToken === 'string') {
    try { const payload = decode(refreshToken, true, appRefreshAudience); sessionId = payload.sid as string; userId = payload.sub; } catch { /* Nothing valid to revoke. */ }
  }
  if (sessionId && userId) await db.session.deleteMany({ where: { id: sessionId, userId } });
  return sessionId;
}
function writeTokens(res: Response, user: { id: string; tokenVersion: number }, sessionId: string, nonce: string) {
  const access = jwt.sign({ sid: sessionId, ver: user.tokenVersion }, env.JWT_SECRET, { subject: user.id, issuer: 'uzbite', audience: 'uzbite-web', algorithm: 'HS256', expiresIn: '15m' });
  const refresh = jwt.sign({ sid: sessionId, ver: user.tokenVersion, nonce }, refreshSecret(), { subject: user.id, issuer: 'uzbite', audience: 'uzbite-refresh', algorithm: 'HS256', expiresIn: '30d' });
  res.cookie(accessCookie, access, { ...commonCookie, maxAge: 15 * 60_000 });
  res.cookie(refreshCookie, refresh, { ...commonCookie, maxAge: 30 * 86400_000 });
}
export async function createSession(res: Response, user: { id: string; tokenVersion: number }) {
  const nonce = randomBytes(32).toString('hex');
  const session = await db.$transaction(async tx => {
    await tx.session.deleteMany({ where: { userId: user.id, expiresAt: { lte: new Date() } } });
    return tx.session.create({ data: { userId: user.id, refreshHash: hash(nonce), expiresAt: new Date(Date.now() + 30 * 86400_000) } });
  });
  writeTokens(res, user, session.id, nonce);
}
export async function refreshSession(req: Request, res: Response) {
  try {
    const token: unknown = req.cookies[refreshCookie];
    if (typeof token !== 'string') throw new Error('Missing');
    const payload = decode(token, true);
    if (typeof payload.nonce !== 'string') throw new Error('Invalid');
    const session = await db.session.findUnique({ where: { id: payload.sid as string }, include: { user: true } });
    const digest = hash(payload.nonce);
    if (!session || session.userId !== payload.sub || session.expiresAt < new Date() || session.user.tokenVersion !== payload.ver || session.user.role !== 'USER' || !timingSafeEqual(Buffer.from(session.refreshHash), Buffer.from(digest))) throw new Error('Revoked');
    const nonce = randomBytes(32).toString('hex');
    const rotated = await db.session.updateMany({ where: { id: session.id, refreshHash: digest }, data: { refreshHash: hash(nonce) } });
    if (rotated.count !== 1) throw new Error('Already rotated');
    writeTokens(res, session.user, session.id, nonce);
  } catch (error) {
    if (error instanceof Error && error.name.startsWith('Prisma')) throw error;
    clearSessionCookies(res);
    throw new ApiError(401, 'UNAUTHORIZED', 'Сессия истекла. Войдите снова');
  }
}
export function clearSessionCookies(res: Response) { res.clearCookie(accessCookie, commonCookie); res.clearCookie(refreshCookie, commonCookie); }
export async function revokeSession(req: Request, res: Response) {
  let sessionId = req.user?.sessionId;
  let userId = req.user?.id;
  if (!sessionId) {
    // Invalid/expired JWTs can be cleared, but a database failure must not masquerade as revocation.
    try { const token: unknown = req.cookies[refreshCookie]; if (typeof token === 'string') { const payload = decode(token, true); sessionId = payload.sid as string; userId = payload.sub; } } catch { /* No valid session to revoke. */ }
  }
  if (sessionId && userId) await db.session.deleteMany({ where: { id: sessionId, userId } });
  clearSessionCookies(res);
  return sessionId;
}
