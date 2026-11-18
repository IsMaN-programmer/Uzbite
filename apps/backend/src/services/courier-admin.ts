import type { CourierApprovalStatus, Prisma } from '@prisma/client';
import { db } from '../config/database.js';
import { assert } from '../utils/errors.js';
import { setCourierApproval } from './dispatch.js';
import { readPrivateObject } from './storage.js';

/**
 * Support review of courier applications (admin panel). The decision is the CourierProfile's
 * approvalStatus, which every order path checks on the server: only APPROVED couriers see and take orders.
 * Later: a decisions table for history and the support user who decided (approvalDecidedById).
 */
export const REVIEW_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'] as const;
const select = {
  userId: true, firstName: true, lastName: true, passportSeries: true, passportNumber: true, facePhotoId: true, approvalStatus: true,
  rejectionReason: true, approvalChangedAt: true, onboardingCompletedAt: true, createdAt: true, workMode: true, city: true,
  user: { select: { email: true, phone: true } },
} satisfies Prisma.CourierProfileSelect;
type Row = Prisma.CourierProfileGetPayload<{ select: typeof select }>;
const dto = (row: Row) => ({
  id: row.userId, firstName: row.firstName, lastName: row.lastName, email: row.user.email, phone: row.user.phone,
  passportSeries: row.passportSeries, passportNumber: row.passportNumber, hasFacePhoto: Boolean(row.facePhotoId),
  status: row.approvalStatus, rejectionReason: row.rejectionReason, workMode: row.workMode, city: row.city,
  submittedAt: (row.onboardingCompletedAt ?? row.createdAt).toISOString(), statusChangedAt: row.approvalChangedAt?.toISOString() ?? null,
});

export async function listCourierApplications(status: CourierApprovalStatus | 'ALL') {
  const [rows, groups] = await Promise.all([
    db.courierProfile.findMany({ where: status === 'ALL' ? {} : { approvalStatus: status }, select, orderBy: { createdAt: 'asc' }, take: 300 }),
    db.courierProfile.groupBy({ by: ['approvalStatus'], _count: { _all: true } }),
  ]);
  const counts = Object.fromEntries(REVIEW_STATUSES.map(item => [item, groups.find(group => group.approvalStatus === item)?._count._all ?? 0]));
  return { items: rows.map(dto), counts };
}
export async function courierApplication(courierId: string) {
  const row = await db.courierProfile.findUnique({ where: { userId: courierId }, select });
  assert(row, 404, 'NOT_FOUND', 'Курьер не найден');
  return dto(row);
}
export async function courierFacePhoto(courierId: string) {
  const row = await db.courierProfile.findUnique({ where: { userId: courierId }, select: { facePhoto: true } });
  assert(row?.facePhoto, 404, 'NOT_FOUND', 'Фото лица не загружено');
  return { mimeType: row.facePhoto.mimeType, bytes: await readPrivateObject(row.facePhoto) };
}
export async function approveCourier(courierId: string) {
  const row = await db.courierProfile.findUnique({ where: { userId: courierId }, select: { passportSeries: true, passportNumber: true, facePhotoId: true } });
  assert(row, 404, 'NOT_FOUND', 'Курьер не найден');
  assert(row.passportSeries && row.passportNumber && row.facePhotoId, 409, 'IDENTITY_REQUIRED', 'Курьер ещё не указал паспорт и не загрузил фото лица');
  await setCourierApproval(courierId, 'APPROVED');
  return courierApplication(courierId);
}
export async function rejectCourier(courierId: string, reason: string | null) {
  assert(await db.courierProfile.findUnique({ where: { userId: courierId }, select: { userId: true } }), 404, 'NOT_FOUND', 'Курьер не найден');
  await setCourierApproval(courierId, 'REJECTED', { reason });
  return courierApplication(courierId);
}
