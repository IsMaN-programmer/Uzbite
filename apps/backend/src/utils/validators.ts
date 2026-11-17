import { z } from 'zod';

export const phoneSchema = z.string().trim().regex(/^\+?[0-9\s()-]{7,22}$/).refine(value => {
  const digits = value.replace(/\D/g, ''); return digits.length >= 7 && digits.length <= 15;
}, 'Введите корректный номер телефона');
export const emailSchema = z.string().trim().pipe(z.email().max(254)).transform(s => s.toLowerCase());
/** bcrypt reads at most 72 bytes, so longer passwords are rejected instead of silently truncated. */
const within72Bytes = (value: string) => Buffer.byteLength(value, 'utf8') <= 72;
export const newPasswordSchema = z.string().min(8).max(72).refine(within72Bytes, 'Пароль должен занимать не больше 72 байт');
export const loginPasswordSchema = z.string().min(1).max(72).refine(within72Bytes, 'Пароль должен занимать не больше 72 байт');
/** Pre-computed bcrypt hash compared when an account does not exist, so timing does not reveal it. */
export const DUMMY_PASSWORD_HASH = '$2b$12$W5HK5wNwf86cby4uX7JS6evD8f54zyvWLVoDjxZdjAh60sFdn7A8S';
export const reasonSchema = z.string().trim().min(3).max(500);
export const idSchema = z.string().min(1).max(100);
