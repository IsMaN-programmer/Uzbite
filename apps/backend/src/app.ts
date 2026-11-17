import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { db, redis } from './config/database.js';
import { env, allowedOrigins, storageReady, receiptStorageReady } from './config/env.js';
import { csrfProtection, rateLimit } from './middleware/security.js';
import { optionalAuth } from './middleware/auth.js';
import { authRouter } from './routes/auth.js';
import { catalogRouter } from './routes/catalog.js';
import { profileRouter } from './routes/profile.js';
import { addressRouter } from './routes/addresses.js';
import { orderRouter } from './routes/orders.js';
import { notificationRouter } from './routes/notifications.js';
import { uploadRouter } from './routes/uploads.js';
import { courierRouter } from './routes/courier.js';
import { restaurantRouter } from './routes/restaurant.js';
import { errorHandler, notFound } from './utils/errors.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin)), credentials: true }));
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());
  app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.get('/api/health', async (_req, res) => {
    let database = false;
    try { await db.$queryRaw`SELECT 1`; database = true; } catch { /* Report actual service readiness. */ }
    const ready = database && (env.NODE_ENV !== 'production' || redis.isReady);
    res.status(ready ? 200 : 503).json({ data: { status: ready ? (redis.isReady ? 'ok' : 'degraded') : 'unavailable', database: database ? 'connected' : 'unavailable', redis: redis.isReady ? 'connected' : 'unavailable', rateLimit: redis.isReady ? 'redis' : env.NODE_ENV === 'production' ? 'fail-closed' : 'process-memory-development-only', storage: storageReady, privateReceiptStorage: receiptStorageReady } });
  });
  app.use('/api', rateLimit('api', 1200, 60), csrfProtection, optionalAuth);
  app.use('/api/auth', authRouter);
  // Native apps (Bearer tokens): courier mobile app and the future restaurant Windows app.
  app.use('/api/courier', courierRouter);
  app.use('/api/restaurant', restaurantRouter);
  app.use('/api', catalogRouter);
  app.use('/api/profile', profileRouter);
  app.use('/api/addresses', addressRouter);
  app.use('/api/orders', orderRouter);
  app.use('/api/notifications', notificationRouter);
  app.use('/api/uploads', uploadRouter);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
