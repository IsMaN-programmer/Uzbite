import { Linking, Platform } from 'react-native';
import type { ServiceCityCode } from '@uzbite/shared';

/**
 * Routes in Yandex Maps from coordinates stored in PostgreSQL (official URL scheme:
 * yandex.ru/dev/yandex-apps-launch-maps). `rtext` takes "latitude,longitude"; an empty start
 * (`~lat,lon`) lets Yandex Maps route from the phone's own position — the courier app itself
 * never reads or sends GPS. `rtt` is omitted so Maps keeps the courier's last travel mode.
 * The Yandex Maps app is tried first; without it the web version opens in the browser.
 */
export type Point = { latitude: number; longitude: number };
export function yandexRouteLinks({ latitude, longitude }: Point) {
  const target = `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
  return { app: `yandexmaps://maps.yandex.ru/?rtext=~${target}`, web: `https://yandex.ru/maps/?rtext=~${target}` };
}
/** A usable stored point, or null (then the screen shows the text address instead). */
export function pointOf(latitude: number | null | undefined, longitude: number | null | undefined): Point | null {
  if (typeof latitude !== 'number' || typeof longitude !== 'number' || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || (latitude === 0 && longitude === 0)) return null;
  return { latitude, longitude };
}
export async function openRoute(point: Point) {
  const links = yandexRouteLinks(point);
  if (Platform.OS === 'web') { await Linking.openURL(links.web); return; }
  try { await Linking.openURL(links.app); }
  catch { await Linking.openURL(links.web); }
}
/**
 * Yandex Maps JavaScript API 3.0 key («JavaScript API и HTTP Геокодер» at developer.tech.yandex.ru),
 * inlined by Expo at bundle time from apps/mobile/.env. Without it the map screen shows a list.
 */
export const YANDEX_MAPS_API_KEY = process.env.EXPO_PUBLIC_YANDEX_MAPS_API_KEY ?? '';
/** Address the in-app map page runs under (its HTTP Referer). Allow this host if the key is restricted by Referer. */
export const YANDEX_MAPS_REFERER = process.env.EXPO_PUBLIC_YANDEX_MAPS_REFERER ?? 'http://localhost/';
/** Approximate city centres: where the courier map opens before any restaurant is waiting. */
const CITY_CENTERS: Record<ServiceCityCode, Point> = {
  tashkent: { latitude: 41.2995, longitude: 69.2401 }, almalyk: { latitude: 40.8447, longitude: 69.5983 }, andijan: { latitude: 40.7821, longitude: 72.3442 },
  angren: { latitude: 41.0167, longitude: 70.1436 }, bukhara: { latitude: 39.7747, longitude: 64.4286 }, gulistan: { latitude: 40.4897, longitude: 68.7842 },
  jizzakh: { latitude: 40.1158, longitude: 67.8422 }, karshi: { latitude: 38.8606, longitude: 65.7891 }, kokand: { latitude: 40.5286, longitude: 70.9425 },
  margilan: { latitude: 40.4711, longitude: 71.7247 }, navoi: { latitude: 40.0844, longitude: 65.3792 }, namangan: { latitude: 40.9983, longitude: 71.6726 },
  nukus: { latitude: 42.4531, longitude: 59.6103 }, nurafshon: { latitude: 41.0397, longitude: 69.3586 }, samarkand: { latitude: 39.6542, longitude: 66.9597 },
  termez: { latitude: 37.2242, longitude: 67.2783 }, urgench: { latitude: 41.55, longitude: 60.6333 }, fergana: { latitude: 40.3864, longitude: 71.7864 },
  khiva: { latitude: 41.3783, longitude: 60.3639 }, chirchik: { latitude: 41.4689, longitude: 69.5822 }, shakhrisabz: { latitude: 39.0578, longitude: 66.8342 },
};
export function cityCenter(city: string | null | undefined): Point {
  return CITY_CENTERS[(city ?? 'tashkent') as ServiceCityCode] ?? CITY_CENTERS.tashkent;
}

export async function callPhone(phone: string) {
  await Linking.openURL(`tel:${phone.replace(/[^\d+]/g, '')}`);
}
