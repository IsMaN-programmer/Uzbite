import { z } from 'zod';
import type { ServiceZoneCode } from '@uzbite/shared';

/**
 * Courier work areas. The backend imports only types from @uzbite/shared (the package ships
 * TypeScript sources), so the codes are listed here and checked against the shared list at
 * compile time: adding a zone to packages/shared without adding it here fails typecheck.
 */
export const SERVICE_ZONE_CODES = [
  'almazar', 'bektemir', 'chilanzar', 'mirabad', 'mirzo_ulugbek', 'sergeli',
  'shaykhantakhur', 'uchtepa', 'yakkasaray', 'yangihayot', 'yashnabad', 'yunusabad',
] as const satisfies readonly ServiceZoneCode[];
type MissingZone = Exclude<ServiceZoneCode, typeof SERVICE_ZONE_CODES[number]>;
const zonesComplete: [MissingZone] extends [never] ? true : false = true;
void zonesComplete;

export const SERVICE_CITY_CODES = ['tashkent'] as const;
export const serviceAreaSchema = z.object({ city: z.enum(SERVICE_CITY_CODES), zone: z.enum(SERVICE_ZONE_CODES) }).strict();
