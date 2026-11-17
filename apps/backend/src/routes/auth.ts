import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '../config/database.js';
import { rateLimit, csrfIssue } from '../middleware/security.js';
import { requireAuth } from '../middleware/auth.js';
import { createSession, refreshSession, revokeSession } from '../services/auth.js';
import { assert } from '../utils/errors.js';
import { publicUserSelect } from '../utils/serialize.js';
import { disconnectSession } from '../services/realtime.js';
import { env } from '../config/env.js';

const email = z.string().trim().pipe(z.email().max(254)).transform(s => s.toLowerCase());
const password = z.string().min(8).max(72).refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'Пароль должен занимать не больше 72 байт');
const registerSchema = z.object({ email, password, language: z.enum(['ru', 'uz', 'en']).default('ru'), theme: z.enum(['light', 'dark']).default('light') }).strict();
const loginSchema = z.object({ email, password: z.string().min(1).max(72).refine(value => Buffer.byteLength(value, 'utf8') <= 72, 'Пароль должен занимать не больше 72 байт') }).strict();
export const authRouter = Router();
authRouter.get('/csrf', csrfIssue);
authRouter.post('/register', rateLimit('register', env.NODE_ENV === 'production' ? 10 : 100, 3600), async (req, res) => {
  const input = registerSchema.parse(req.body);
  const handle = `user_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`;
  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await db.user.create({ data: { email: input.email, name: handle, username: handle, passwordHash, role: 'USER', settings: { create: { language: input.language, theme: input.theme } } }, select: { ...publicUserSelect, tokenVersion: true } });
  await createSession(res, user);
  const { tokenVersion: _version, ...safe } = user;
  res.status(201).json({ data: { ...safe, name: safe.username, nickname: safe.username } });
});
authRouter.post('/login', rateLimit('login', 20, 900), async (req, res) => {
  const input = loginSchema.parse(req.body);
  const user = await db.user.findUnique({ where: { email: input.email }, include: { settings: true } });
  const dummy = '$2b$12$W5HK5wNwf86cby4uX7JS6evD8f54zyvWLVoDjxZdjAh60sFdn7A8S';
  const valid = await bcrypt.compare(input.password, user?.passwordHash ?? dummy);
  assert(user && valid && user.role === 'USER', 401, 'INVALID_CREDENTIALS', 'Неверная почта или пароль');
  await createSession(res, user);
  const safe = await db.user.findUnique({ where: { id: user.id }, select: publicUserSelect });
  res.json({ data: { ...safe, name: safe?.username, nickname: safe?.username } });
});
authRouter.post('/refresh', rateLimit('refresh', 120, 900), async (req, res) => { await refreshSession(req, res); res.json({ data: { refreshed: true } }); });
authRouter.post('/logout', async (req, res) => { const sessionId = await revokeSession(req, res); if (sessionId) disconnectSession(sessionId); res.json({ data: { loggedOut: true } }); });
authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await db.user.findUnique({ where: { id: req.user!.id }, select: publicUserSelect });
  res.json({ data: { ...user, name: user?.username, nickname: user?.username } });
});
