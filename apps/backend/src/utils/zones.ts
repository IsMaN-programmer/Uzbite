import { z } from 'zod';
import type { ServiceCityCode } from '@uzbite/shared';

/**
 * Cities a free courier can work in. The backend imports only types from @uzbite/shared (the
 * package ships TypeScript sources), so the codes are listed here and checked against the shared
 * list at compile time: a city added on one side only fails typecheck.
 */
export const SERVICE_CITY_CODES = [
  'tashkent', 'almalyk', 'andijan', 'angren', 'bukhara', 'gulistan', 'jizzakh', 'karshi', 'kokand', 'margilan', 'navoi',
  'namangan', 'nukus', 'nurafshon', 'samarkand', 'termez', 'urgench', 'fergana', 'khiva', 'chirchik', 'shakhrisabz',
] as const satisfies readonly ServiceCityCode[];
type MissingCity = Exclude<ServiceCityCode, typeof SERVICE_CITY_CODES[number]>;
const citiesComplete: [MissingCity] extends [never] ? true : false = true;
void citiesComplete;

export const serviceAreaSchema = z.object({ city: z.enum(SERVICE_CITY_CODES) }).strict();
