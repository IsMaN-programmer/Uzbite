import { Prisma } from '@prisma/client';
import type { CourierAccount, CourierEarnings, CourierHistoryItem, CourierHistoryOutcome, Language, Theme } from '@uzbite/shared';
import { db } from '../config/database.js';
import { ApiError, assert } from '../utils/errors.js';
import { ACTIVE_DELIVERY, orderNumber } from './dispatch-dto.js';
import { courierAvailability, courierPermissions } from './dispatch.js';
import { deletePrivateObject, storePrivateImage } from './storage.js';

const language = (value: string | undefined): Language => value === 'uz' || value === 'en' ? value : 'ru';
const theme = (value: string | undefined): Theme => value === 'dark' ? 'dark' : 'light';

/** The courier's own account. Every permission and the BUSY state are computed on the server. */
export async function courierAccount(userId: string): Promise<CourierAccount> {
  const user = await db.user.findUnique({ where: { id: userId }, include: { settings: true, courierProfile: { include: { _count: { select: { affiliations: { where: { status: 'ACTIVE' } } } } } } } });
  assert(user?.courierProfile && user.role === 'COURIER', 404, 'NOT_FOUND', 'Профиль курьера не найден');
  const profile = user.courierProfile;
  const active = await db.delivery.findFirst({ where: { courierId: userId, status: { in: ACTIVE_DELIVERY } }, select: { id: true } });
  const affiliations = profile._count.affiliations;
  return {
    id: user.id, email: user.email, phone: user.phone, avatarUrl: user.avatarUrl, role: 'COURIER',
    settings: { language: language(user.settings?.language), theme: theme(user.settings?.theme) },
    profile: {
      firstName: profile.firstName, lastName: profile.lastName, approvalStatus: profile.approvalStatus, isTestAccount: profile.isTestAccount,
      workMode: profile.workMode, isAvailable: profile.isAvailable, availability: courierAvailability(profile, active?.id ?? null),
      city: profile.city, onboardingStep: profile.onboardingStep, onboardingCompleted: Boolean(profile.onboardingCompletedAt),
      permissions: courierPermissions(profile, affiliations),
      identity: { passportSeries: profile.passportSeries, passportNumber: profile.passportNumber, facePhoto: Boolean(profile.facePhotoId), locked: identityLocked(profile) },
    },
    activeDeliveryId: active?.id ?? null, activeAffiliations: affiliations, createdAt: user.createdAt.toISOString(),
  };
}

/** Identity is checked by UzBite at admission; after that (or when blocked) it cannot be changed. */
export const identityLocked = (profile: { approvalStatus: string }) => profile.approvalStatus !== 'PENDING';
const identityLockedError = () => new ApiError(409, 'IDENTITY_LOCKED', 'Паспортные данные и фото уже проверены. Для изменения обратитесь в поддержку');

/** Passport series and number together. One courier account per passport (unique index). */
export async function setCourierPassport(courierId: string, passportSeries: string, passportNumber: string, tx: Prisma.TransactionClient = db) {
  const profile = await tx.courierProfile.findUniqueOrThrow({ where: { userId: courierId } });
  if (profile.passportSeries === passportSeries && profile.passportNumber === passportNumber) return;
  if (identityLocked(profile)) throw identityLockedError();
  try { await tx.courierProfile.update({ where: { userId: courierId }, data: { passportSeries, passportNumber } }); }
  catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ApiError(409, 'PASSPORT_TAKEN', 'Этот паспорт уже указан в другом аккаунте курьера');
    throw error;
  }
}

/** Stores a new private face photo and removes the previous one. */
export async function setCourierFacePhoto(courierId: string, file: Express.Multer.File | undefined) {
  const profile = await db.courierProfile.findUnique({ where: { userId: courierId }, include: { facePhoto: true } });
  assert(profile, 404, 'NOT_FOUND', 'Профиль курьера не найден');
  if (identityLocked(profile)) throw identityLockedError();
  const upload = await storePrivateImage(courierId, 'COURIER_FACE', file);
  try {
    await db.courierProfile.update({ where: { userId: courierId }, data: { facePhotoId: upload.id } });
  } catch (error) {
    await db.upload.delete({ where: { id: upload.id } }).catch(() => {});
    await deletePrivateObject(upload);
    throw error;
  }
  if (profile.facePhoto) {
    await db.upload.delete({ where: { id: profile.facePhoto.id } }).catch(() => {});
    await deletePrivateObject(profile.facePhoto);
  }
  return courierAccount(courierId);
}

/**
 * Onboarding progress is stored on the server: 1 name, passport and face photo → 2 work mode →
 * 3 restaurant code or city → 4 finish. Finishing re-checks the data each mode needs.
 */
export async function updateOnboarding(courierId: string, input: { step?: number; complete?: boolean }) {
  const profile = await db.courierProfile.findUnique({ where: { userId: courierId }, include: { user: { select: { phone: true } }, _count: { select: { affiliations: { where: { status: 'ACTIVE' } } } } } });
  assert(profile, 404, 'NOT_FOUND', 'Профиль курьера не найден');
  if (input.complete) {
    assert(profile.firstName.trim() && profile.lastName.trim() && profile.user.phone, 409, 'PERSONAL_DATA_REQUIRED', 'Заполните имя и фамилию');
    assert(profile.passportSeries && profile.passportNumber && profile.facePhotoId, 409, 'IDENTITY_REQUIRED', 'Укажите серию и номер паспорта и сделайте фото лица');
    assert(profile.workMode, 409, 'WORK_MODE_REQUIRED', 'Выберите режим работы');
    if (profile.workMode === 'RESTAURANT') assert(profile._count.affiliations > 0, 409, 'AFFILIATION_REQUIRED', 'Введите код приглашения ресторана и подтвердите привязку');
    else assert(profile.city, 409, 'SERVICE_AREA_REQUIRED', 'Выберите город работы');
    await db.courierProfile.update({ where: { userId: courierId }, data: { onboardingStep: 4, onboardingCompletedAt: profile.onboardingCompletedAt ?? new Date() } });
  } else if (input.step !== undefined) {
    await db.courierProfile.update({ where: { userId: courierId }, data: { onboardingStep: input.step } });
  }
  return courierAccount(courierId);
}

export type HistoryFilter = 'all' | 'completed' | 'cancelled' | 'restaurant' | 'freelance';
const historyWhere: Record<HistoryFilter, Prisma.DeliveryOfferWhereInput> = {
  all: {},
  completed: { releasedAt: null, delivery: { status: 'DELIVERED' } },
  cancelled: { OR: [{ releasedAt: { not: null } }, { delivery: { status: { in: ['CANCELLED', 'FAILED'] } } }] },
  restaurant: { mode: 'RESTAURANT_COURIER' },
  freelance: { mode: 'UZBITE_COURIER' },
};
/** Every delivery the courier accepted, with its outcome. No customer name, phone or address. */
export async function courierHistory(courierId: string, filter: HistoryFilter, page: number, pageSize: number) {
  const where: Prisma.DeliveryOfferWhereInput = { courierId, status: 'ACCEPTED', ...historyWhere[filter] };
  const [offers, total] = await Promise.all([
    db.deliveryOffer.findMany({
      where, orderBy: [{ respondedAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize,
      include: { delivery: { select: { id: true, orderId: true, status: true, courierId: true, reward: true, rewardStatus: true, deliveredAt: true, closedAt: true, closeReason: true, order: { select: { restaurantName: true } } } } },
    }),
    db.deliveryOffer.count({ where }),
  ]);
  const items = offers.map((offer): CourierHistoryItem => {
    const { delivery } = offer;
    const mine = delivery.courierId === courierId;
    let outcome: CourierHistoryOutcome = 'IN_PROGRESS';
    let reason: string | null = null;
    if (delivery.status === 'FAILED' && mine) { outcome = 'FAILED'; reason = delivery.closeReason; }
    else if (offer.releasedAt) { outcome = 'CANCELLED'; reason = offer.releaseReason; }
    else if (delivery.status === 'DELIVERED' && mine) outcome = 'DELIVERED';
    else if (delivery.status === 'CANCELLED') { outcome = 'CANCELLED'; reason = delivery.closeReason; }
    const delivered = outcome === 'DELIVERED';
    return {
      offerId: offer.id, deliveryId: delivery.id, number: orderNumber(delivery.orderId), restaurantName: delivery.order.restaurantName, mode: offer.mode, outcome,
      reward: delivered ? delivery.reward?.toNumber() ?? null : offer.reward?.toNumber() ?? null,
      rewardStatus: delivered ? delivery.rewardStatus : 'NONE',
      acceptedAt: (offer.respondedAt ?? offer.createdAt).toISOString(),
      finishedAt: (delivered ? delivery.deliveredAt : offer.releasedAt ?? delivery.closedAt)?.toISOString() ?? null,
      reason,
    };
  });
  return { items, total };
}

/** Start of the current day in Tashkent (UTC+5, no daylight saving). */
function tashkentDayStart(now = new Date()) {
  const offset = 5 * 3600_000;
  return new Date(Math.floor((now.getTime() + offset) / 86400_000) * 86400_000 - offset);
}
/**
 * Earnings from delivered orders. ACCRUED = начислено, CONFIRMED = подтверждено рестораном,
 * PAID = выплата отмечена рестораном. UzBite itself moves no money.
 */
export async function courierEarnings(courierId: string): Promise<CourierEarnings> {
  const where: Prisma.DeliveryWhereInput = { courierId, status: 'DELIVERED' };
  const [groups, today] = await Promise.all([
    db.delivery.groupBy({ by: ['rewardStatus'], where, _sum: { reward: true }, _count: { _all: true } }),
    db.delivery.aggregate({ where: { ...where, deliveredAt: { gte: tashkentDayStart() } }, _sum: { reward: true }, _count: { _all: true } }),
  ]);
  const sum = (statuses: string[]) => groups.filter(group => statuses.includes(group.rewardStatus)).reduce((total, group) => total + (group._sum.reward?.toNumber() ?? 0), 0);
  const accrued = sum(['ACCRUED', 'CONFIRMED', 'PAID']), confirmed = sum(['CONFIRMED', 'PAID']), paid = sum(['PAID']);
  return {
    completedCount: groups.reduce((total, group) => total + group._count._all, 0),
    totals: { accrued, confirmed, paid },
    pending: Math.round((accrued - paid) * 100) / 100,
    today: { completed: today._count._all, accrued: today._sum.reward?.toNumber() ?? 0 },
    withoutReward: groups.find(group => group.rewardStatus === 'NONE')?._count._all ?? 0,
  };
}
