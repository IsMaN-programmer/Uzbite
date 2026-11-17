import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { db } from '../config/database.js';
import { assert } from '../utils/errors.js';
import { emailSchema } from '../utils/validators.js';

// Private developer CLI: creates a restaurant staff account (role RESTAURANT) and prints the
// generated password once. There is no public registration for restaurant accounts.
const [restaurantArg, emailArg] = process.argv.slice(2);
try {
  assert(env.NODE_ENV !== 'production', 403, 'DEVELOPMENT_ONLY', 'Developer tool is disabled in production');
  assert(restaurantArg && emailArg, 400, 'USAGE', 'Usage: npm run restaurant:staff -- <restaurant-slug> <email>');
  const email = emailSchema.safeParse(emailArg);
  assert(email.success, 400, 'EMAIL', 'Invalid email address');
  const restaurant = await db.restaurant.findFirst({ where: { OR: [{ slug: restaurantArg }, { id: restaurantArg }] } });
  assert(restaurant, 404, 'NOT_FOUND', `Restaurant not found: ${restaurantArg}`);
  assert(!await db.user.findUnique({ where: { email: email.data } }), 409, 'EMAIL_TAKEN', 'An account with this email already exists');
  const password = randomBytes(12).toString('base64url');
  await db.user.create({ data: {
    email: email.data, passwordHash: await bcrypt.hash(password, 12), name: `${restaurant.name} staff`, username: `staff_${randomBytes(10).toString('hex')}`, role: 'RESTAURANT',
    settings: { create: {} }, restaurantStaff: { create: { restaurantId: restaurant.id } },
  } });
  console.log(`Restaurant staff account created for ${restaurant.name} (${restaurant.slug}).`);
  console.log(`Email: ${email.data}`);
  console.log(`Password (shown once, store it securely): ${password}`);
} catch (error) { console.error(error instanceof Error ? error.message : 'Could not create the staff account'); process.exitCode = 1; }
finally { await db.$disconnect(); }
