import { createHash, randomInt } from 'node:crypto';
import { Prisma, type CourierInvitation } from '@prisma/client';
import type { CourierAffiliationDto, CourierInvitationDto, RestaurantBrief } from '@uzbite/shared';
import { db } from '../config/database.js';
import { env } from '../config/env.js';
import { ApiError, assert } from '../utils/errors.js';
import { ACTIVE_DELIVERY } from './dispatch-dto.js';
import { changeCourierState, courierAvailability, type DispatchActor } from './dispatch.js';
import { ioEvent } from './realtime.js';

/**
 * Restaurant → courier invitations. A code is shown once to the restaurant, stored only as a
 * SHA-256 hash, single-use and time-limited. The courier claims it, sees the restaurant, then
 * accepts or rejects; only acceptance creates the affiliation.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const normalizeCode = (code: string) => code.toUpperCase().replace(/[\s-]/g, '');
const hashCode = (code: string) => createHash('sha256').update(normalizeCode(code)).digest('hex');
function newCode() {
  const raw = Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}
const invalidCode = () => new ApiError(404, 'INVITATION_INVALID', 'Код недействителен, истёк или уже использован');
const restaurantBrief = { select: { id: true, name: true, logoUrl: true, addressText: true } } as const;
function invitationStatus(invitation: Pick<CourierInvitation, 'status' | 'expiresAt'>, now = new Date()) {
  return invitation.status === 'PENDING' && invitation.expiresAt <= now ? 'EXPIRED' as const : invitation.status;
}
function courierInvitationDto(invitation: CourierInvitation & { restaurant: RestaurantBrief }): CourierInvitationDto {
  return { id: invitation.id, restaurant: invitation.restaurant, status: invitationStatus(invitation), expiresAt: invitation.expiresAt.toISOString(), createdAt: invitation.createdAt.toISOString() };
}

// Restaurant side -------------------------------------------------------------------------------

export async function createInvitation(restaurantId: string, actor: DispatchActor) {
  const expiresAt = new Date(Date.now() + env.COURIER_INVITATION_TTL_HOURS * 3600_000);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = newCode();
    try {
      const invitation = await db.courierInvitation.create({ data: { restaurantId, codeHash: hashCode(code), createdById: actor.id, expiresAt } });
      // The plain code is returned once and never stored.
      return { id: invitation.id, code, status: invitation.status, expiresAt: invitation.expiresAt.toISOString(), createdAt: invitation.createdAt.toISOString() };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
    }
  }
  throw new ApiError(503, 'CODE_GENERATION_FAILED', 'Не удалось создать код. Повторите попытку');
}
export async function listRestaurantInvitations(restaurantId: string) {
  const invitations = await db.courierInvitation.findMany({ where: { restaurantId }, orderBy: { createdAt: 'desc' }, take: 100, include: { courier: { select: { firstName: true, lastName: true } } } });
  return invitations.map(({ codeHash: _hash, courier, ...invitation }) => ({
    ...invitation, status: invitationStatus(invitation), courierName: courier ? `${courier.firstName} ${courier.lastName}`.trim() : null,
  }));
}
export async function revokeInvitation(restaurantId: string, invitationId: string) {
  const invitation = await db.courierInvitation.findFirst({ where: { id: invitationId, restaurantId } });
  assert(invitation, 404, 'NOT_FOUND', 'Приглашение не найдено');
  if (invitation.status !== 'REVOKED') {
    const revoked = await db.courierInvitation.updateMany({ where: { id: invitationId, status: 'PENDING' }, data: { status: 'REVOKED', revokedAt: new Date() } });
    assert(revoked.count === 1, 409, 'INVITATION_CLOSED', 'Приглашение уже принято или отклонено');
    if (invitation.courierId) ioEvent(`courier:${invitation.courierId}`, 'courier:affiliation_updated', { invitationId, status: 'REVOKED' });
  }
  return { id: invitationId, status: 'REVOKED' as const };
}
/** Affiliated couriers with their live work status; phone is shared for delivery coordination. */
export async function listRestaurantCouriers(restaurantId: string, status: 'ACTIVE' | 'ENDED' | 'ALL') {
  const affiliations = await db.restaurantCourierAffiliation.findMany({
    where: { restaurantId, ...(status === 'ALL' ? {} : { status }) }, orderBy: [{ status: 'asc' }, { confirmedAt: 'desc' }], take: 200,
    include: { courier: { include: {
      user: { select: { phone: true, avatarUrl: true } }, deliveries: { where: { status: { in: ACTIVE_DELIVERY } }, select: { id: true, restaurantId: true } },
      _count: { select: { affiliations: { where: { status: 'ACTIVE' } } } },
    } } },
  });
  return affiliations.map(({ courier, ...affiliation }) => {
    const active = courier.deliveries[0];
    return {
      affiliationId: affiliation.id, status: affiliation.status, invitedAt: affiliation.invitedAt, confirmedAt: affiliation.confirmedAt, endedAt: affiliation.endedAt, endedBy: affiliation.endedBy,
      courier: {
        id: courier.userId, name: `${courier.firstName} ${courier.lastName}`.trim(), phone: courier.user.phone, avatarUrl: courier.user.avatarUrl,
        workMode: courier.workMode, approvalStatus: courier.approvalStatus, availability: courierAvailability(courier, courier._count.affiliations, active?.id ?? null),
        // Only this restaurant's own delivery is identified; another restaurant's is just "busy".
        activeDeliveryId: active?.restaurantId === restaurantId ? active.id : null,
      },
    };
  });
}

// Courier side ----------------------------------------------------------------------------------

export async function claimInvitation(courierId: string, code: string) {
  const normalized = normalizeCode(code);
  assert(/^[A-Z0-9]{8}$/.test(normalized), 400, 'INVITATION_CODE_FORMAT', 'Код приглашения состоит из 8 символов');
  const invitation = await db.courierInvitation.findUnique({ where: { codeHash: hashCode(normalized) } });
  if (!invitation || invitation.status !== 'PENDING' || invitation.expiresAt <= new Date() || (invitation.courierId && invitation.courierId !== courierId)) throw invalidCode();
  if (!invitation.courierId) {
    const claimed = await db.courierInvitation.updateMany({ where: { id: invitation.id, courierId: null, status: 'PENDING', expiresAt: { gt: new Date() } }, data: { courierId, claimedAt: new Date() } });
    if (claimed.count !== 1) throw invalidCode();
  }
  return courierInvitationDto(await db.courierInvitation.findUniqueOrThrow({ where: { id: invitation.id }, include: { restaurant: restaurantBrief } }));
}
export async function listCourierInvitations(courierId: string) {
  const invitations = await db.courierInvitation.findMany({ where: { courierId }, orderBy: { createdAt: 'desc' }, take: 50, include: { restaurant: restaurantBrief } });
  return invitations.map(courierInvitationDto);
}
export async function rejectInvitation(courierId: string, invitationId: string) {
  const invitation = await db.courierInvitation.findFirst({ where: { id: invitationId, courierId }, include: { restaurant: restaurantBrief } });
  assert(invitation, 404, 'NOT_FOUND', 'Приглашение не найдено');
  if (invitation.status !== 'REJECTED') {
    const rejected = await db.courierInvitation.updateMany({ where: { id: invitationId, courierId, status: 'PENDING' }, data: { status: 'REJECTED', respondedAt: new Date() } });
    assert(rejected.count === 1, 409, 'INVITATION_CLOSED', 'Приглашение больше не действует');
    ioEvent(`restaurant:${invitation.restaurantId}`, 'courier:affiliation_updated', { invitationId, status: 'REJECTED' });
  }
  return courierInvitationDto(await db.courierInvitation.findUniqueOrThrow({ where: { id: invitationId }, include: { restaurant: restaurantBrief } }));
}
/** Acceptance creates the active affiliation under the courier lock used by dispatch. */
export async function acceptInvitation(courierId: string, invitationId: string) {
  const affiliation = await changeCourierState(courierId, { id: courierId, role: 'COURIER' }, null, async (tx, out, courier) => {
    const invitation = await tx.courierInvitation.findFirst({ where: { id: invitationId, courierId } });
    assert(invitation, 404, 'NOT_FOUND', 'Приглашение не найдено');
    if (invitation.status === 'ACCEPTED') return tx.restaurantCourierAffiliation.findUniqueOrThrow({ where: { invitationId } });
    assert(courier.approvalStatus !== 'SUSPENDED', 403, 'COURIER_SUSPENDED', 'Аккаунт курьера заблокирован');
    if (invitation.status !== 'PENDING' || invitation.expiresAt <= new Date()) throw invalidCode();
    assert(!courier.affiliatedRestaurantIds.includes(invitation.restaurantId), 409, 'ALREADY_AFFILIATED', 'Вы уже работаете с этим рестораном');
    const accepted = await tx.courierInvitation.updateMany({ where: { id: invitationId, courierId, status: 'PENDING' }, data: { status: 'ACCEPTED', respondedAt: new Date() } });
    if (accepted.count !== 1) throw invalidCode();
    const created = await tx.restaurantCourierAffiliation.create({ data: { restaurantId: invitation.restaurantId, courierId, invitationId, invitedAt: invitation.createdAt } });
    out.emit([`courier:${courierId}`, `restaurant:${invitation.restaurantId}`], 'courier:affiliation_updated', { affiliationId: created.id, restaurantId: invitation.restaurantId, courierId, status: 'ACTIVE' });
    return created;
  });
  return courierAffiliation(affiliation.id);
}
export async function courierAffiliation(affiliationId: string): Promise<CourierAffiliationDto> {
  const affiliation = await db.restaurantCourierAffiliation.findUniqueOrThrow({ where: { id: affiliationId }, include: { restaurant: restaurantBrief } });
  return affiliationDto(affiliation);
}
function affiliationDto(affiliation: Prisma.RestaurantCourierAffiliationGetPayload<{ include: { restaurant: typeof restaurantBrief } }>): CourierAffiliationDto {
  return { id: affiliation.id, restaurant: affiliation.restaurant, status: affiliation.status, invitedAt: affiliation.invitedAt.toISOString(), confirmedAt: affiliation.confirmedAt.toISOString(), endedAt: affiliation.endedAt?.toISOString() ?? null };
}
export async function listCourierAffiliations(courierId: string) {
  const affiliations = await db.restaurantCourierAffiliation.findMany({ where: { courierId }, orderBy: [{ status: 'asc' }, { confirmedAt: 'desc' }], include: { restaurant: restaurantBrief } });
  return affiliations.map(affiliationDto);
}
