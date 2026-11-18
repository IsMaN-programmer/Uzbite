import { env } from '../config/env.js';
import { db } from '../config/database.js';
import { setCourierApproval } from '../services/dispatch.js';
import { privateFileLocation } from '../services/storage.js';
import { assert } from '../utils/errors.js';
import { emailSchema } from '../utils/validators.js';

// Private developer CLI for platform admission of couriers. APPROVED allows free UzBite deliveries
// and needs the passport and face photo from onboarding (check them before approving);
// --suspend blocks every mode, withdraws open offers and sets the courier offline.
const args = process.argv.slice(2);
const flags = args.filter(arg => arg.startsWith('--'));
const [emailArg] = args.filter(arg => !arg.startsWith('--'));
try {
  assert(env.NODE_ENV !== 'production', 403, 'DEVELOPMENT_ONLY', 'Developer tool is disabled in production');
  assert(emailArg && flags.every(flag => ['--test', '--suspend'].includes(flag)), 400, 'USAGE', 'Usage: npm run courier:approve -- <email> [--test] [--suspend]');
  const email = emailSchema.safeParse(emailArg);
  assert(email.success, 400, 'EMAIL', 'Invalid email address');
  const user = await db.user.findUnique({ where: { email: email.data }, include: { courierProfile: { include: { facePhoto: true } } } });
  assert(user?.role === 'COURIER' && user.courierProfile, 404, 'NOT_FOUND', 'Courier account not found');
  const { firstName, lastName, passportSeries, passportNumber, facePhoto } = user.courierProfile;
  console.log(`Name: ${`${firstName} ${lastName}`.trim() || '—'}`);
  console.log(`Passport: ${passportSeries && passportNumber ? `${passportSeries} ${passportNumber}` : '—'}`);
  console.log(`Face photo: ${facePhoto ? privateFileLocation(facePhoto) : '—'}`);
  if (!flags.includes('--suspend')) assert(passportSeries && passportNumber && facePhoto, 409, 'IDENTITY_REQUIRED', 'The courier has not provided a passport and a face photo yet');
  const profile = await setCourierApproval(user.id, flags.includes('--suspend') ? 'SUSPENDED' : 'APPROVED', flags.includes('--test') ? { testAccount: true } : {});
  console.log(`Courier ${email.data}: ${profile.approvalStatus}${profile.isTestAccount ? ' (test account)' : ''}`);
} catch (error) { console.error(error instanceof Error ? error.message : 'Could not update the courier'); process.exitCode = 1; }
finally { await db.$disconnect(); }
