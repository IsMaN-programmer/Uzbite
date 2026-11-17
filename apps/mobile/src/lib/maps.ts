import { Linking, Platform } from 'react-native';

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
export async function callPhone(phone: string) {
  await Linking.openURL(`tel:${phone.replace(/[^\d+]/g, '')}`);
}
