import type { CourierApprovalStatus, CourierWorkMode } from '@prisma/client';
import type { CourierMap, CourierMapRestaurant } from '@uzbite/shared';
import { db } from '../config/database.js';
import { assert } from '../utils/errors.js';

/**
 * Courier map: restaurants waiting for a courier right now. Nothing new for restaurants to call —
 * a restaurant appears when it uses the existing dispatch API:
 *   POST /api/restaurant/orders/:id/delivery/search  free search in the restaurant's city
 *   POST /api/restaurant/orders/:id/delivery/offer   personal offer to an own courier
 * and disappears when the search or offer ends (accepted, cancelled, expired).
 *
 * Live updates: every delivery change of a restaurant sends `courier:map_updated` { restaurantId }
 * to courier-map:{city} (see Outbox.courierMap). Couriers join that room with `courier-map:join`;
 * personal offers already reach the courier through courier:{id}.
 */
export const courierMapRoom = (city: string) => `courier-map:${city}`;

/**
 * The city whose free searches this courier may see — the same rule as free-search matching in
 * dispatch.ts (admitted, onboarded, FREELANCE mode, city chosen) — or null.
 */
export function freeSearchCity(profile: { workMode: CourierWorkMode | null; approvalStatus: CourierApprovalStatus; city: string | null; onboardingCompletedAt: Date | null }) {
  return profile.workMode === 'FREELANCE' && profile.approvalStatus === 'APPROVED' && profile.onboardingCompletedAt && profile.city ? profile.city : null;
}

export async function courierMap(courierId: string): Promise<CourierMap> {
  const profile = await db.courierProfile.findUnique({ where: { userId: courierId }, select: { workMode: true, approvalStatus: true, city: true, onboardingCompletedAt: true } });
  assert(profile, 404, 'NOT_FOUND', 'Профиль курьера не найден');
  if (profile.approvalStatus === 'SUSPENDED') return { city: profile.city, restaurants: [] };
  const now = new Date();
  const city = freeSearchCity(profile);
  const myOpenOffers = { courierId, status: 'PENDING' as const, expiresAt: { gt: now } };
  const deliveries = await db.delivery.findMany({
    where: { OR: [
      ...(city ? [{ status: 'SEARCHING' as const, searchExpiresAt: { gt: now }, restaurant: { city } }] : []),
      { status: { in: ['SEARCHING' as const, 'OFFERED' as const] }, offers: { some: myOpenOffers } },
    ] },
    select: {
      restaurant: { select: { id: true, name: true, logoUrl: true, addressText: true, latitude: true, longitude: true } },
      offers: { where: myOpenOffers, select: { id: true } },
    },
    orderBy: { createdAt: 'asc' }, take: 500,
  });
  const byRestaurant = new Map<string, CourierMapRestaurant>();
  for (const { restaurant, offers } of deliveries) {
    const entry = byRestaurant.get(restaurant.id) ?? { ...restaurant, waitingOrders: 0, offerIds: [] };
    entry.waitingOrders += 1;
    entry.offerIds.push(...offers.map(offer => offer.id));
    byRestaurant.set(restaurant.id, entry);
  }
  // Most waiting orders first; ties by name so the list does not jump between refreshes.
  const restaurants = [...byRestaurant.values()].sort((a, b) => b.waitingOrders - a.waitingOrders || a.name.localeCompare(b.name));
  return { city: profile.city, restaurants };
}
