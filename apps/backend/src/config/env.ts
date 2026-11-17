import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)), quiet: true });
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(8081),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32).optional(),
  ALLOWED_ORIGINS: z.string().default('http://localhost:8080,http://127.0.0.1:8080'),
  DELIVERY_AVERAGE_SPEED_KMH: z.coerce.number().min(5).max(80).default(18),
  DELIVERY_ROAD_FACTOR: z.coerce.number().min(1).max(3).default(1.35),
  DELIVERY_PICKUP_MINUTES: z.coerce.number().min(0).max(60).default(5),
  DELIVERY_ESTIMATE_MARGIN_MINUTES: z.coerce.number().min(5).max(60).default(10),
  S3_ENDPOINT: z.string().optional(), S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().optional(), S3_PRIVATE_BUCKET: z.string().optional(), S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(), CDN_BASE_URL: z.string().optional(),
});
export const env = schema.parse(process.env);
export const allowedOrigins = env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
export const storageReady = Boolean(env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY && env.CDN_BASE_URL);
export const receiptStorageReady = Boolean(storageReady && env.S3_PRIVATE_BUCKET);
