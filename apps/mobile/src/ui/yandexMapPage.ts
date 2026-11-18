import type { Language } from '@uzbite/shared';
import type { Point } from '../lib/maps';

/**
 * The page behind the in-app Yandex map (JavaScript API 3.0). It runs in a WebView on phones and
 * in an iframe in the browser. The app talks to it only through messages:
 *   page → app  { type: 'select', id } when a pin is tapped, { type: 'failed' } when the API cannot load
 *   app → page  window.uzbiteSetPoints(points) (WebView) or postMessage { source: 'uzbite-map-host', points } (iframe)
 * Pins are positioned from the stored restaurant coordinates; the courier's own position is never read.
 */
export type MapPin = { id: string; latitude: number; longitude: number; label: string; count: number; selected: boolean };
/** Props of YandexMap (WebView on phones, iframe on the web). `onFailed`: the API could not load. */
export type YandexMapProps = { pins: MapPin[]; center: Point; onSelect: (id: string) => void; onFailed: () => void };
export type MapPageOptions ={ apiKey: string; language: Language; dark: boolean; center: Point; pins: MapPin[]; colors: { accent: string; onAccent: string; surface: string; text: string; bg: string } };

const LOCALES: Record<Language, string> = { ru: 'ru_RU', uz: 'uz_UZ', en: 'en_US' };
/** JSON safe to place inside a <script> element. */
const LINE_SEPARATORS = new RegExp(`[${String.fromCharCode(0x2028, 0x2029)}]`, 'g');
const BACKSLASH = String.fromCharCode(92);
export const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, `${BACKSLASH}u003c`).replace(LINE_SEPARATORS, char => `${BACKSLASH}u${char.charCodeAt(0).toString(16)}`);

export function yandexMapPage({ apiKey, language, dark, center, pins, colors }: MapPageOptions) {
  const api = `https://api-maps.yandex.ru/v3/?apikey=${encodeURIComponent(apiKey)}&lang=${LOCALES[language]}`;
  const css = (value: string) => value.replace(/[^#a-zA-Z0-9(),.% -]/g, '');
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>
  html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: ${css(colors.bg)}; overflow: hidden; }
  .pin { position: absolute; transform: translate(-50%, -100%); min-width: 34px; height: 34px; padding: 0 8px; box-sizing: border-box;
    border-radius: 17px 17px 17px 4px; border: 2px solid ${css(colors.surface)}; background: ${css(colors.accent)}; color: ${css(colors.onAccent)};
    font: 700 15px/30px -apple-system, system-ui, sans-serif; text-align: center; box-shadow: 0 2px 6px rgba(0,0,0,.35); cursor: pointer; }
  .pin.selected { transform: translate(-50%, -100%) scale(1.25); border-color: ${css(colors.text)}; z-index: 2; }
</style></head>
<body><div id="map"></div>
<script>
(function () {
  var send = function (message) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message));
    else if (window.parent !== window) window.parent.postMessage(Object.assign({ source: 'uzbite-map' }, message), '*');
  };
  var center = ${scriptJson([center.longitude, center.latitude])};
  var pending = ${scriptJson(pins)};
  var map = null, markers = [], shownIds = '';
  // Fits the pins when the set of restaurants changes, not on every refresh, so panning is kept.
  function fit(pins) {
    var ids = pins.map(function (pin) { return pin.id; }).sort().join(',');
    if (ids === shownIds) return;
    shownIds = ids;
    if (!pins.length) { map.update({ location: { center: center, zoom: 12, duration: 300 } }); return; }
    var lons = pins.map(function (pin) { return pin.longitude; }), lats = pins.map(function (pin) { return pin.latitude; });
    var minLon = Math.min.apply(null, lons), maxLon = Math.max.apply(null, lons), minLat = Math.min.apply(null, lats), maxLat = Math.max.apply(null, lats);
    var width = document.body.clientWidth || 360, height = document.body.clientHeight || 360;
    var lonSpan = Math.max(maxLon - minLon, 0.004) * 1.5, latSpan = Math.max(maxLat - minLat, 0.004) * 1.5;
    var cos = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
    var zoom = Math.min(Math.log2(width * 360 / (256 * lonSpan)), Math.log2(height * 360 * cos / (256 * latSpan)));
    map.update({ location: { center: [(minLon + maxLon) / 2, (minLat + maxLat) / 2], zoom: Math.max(5, Math.min(16, zoom)), duration: 300 } });
  }
  function render(pins) {
    pending = pins;
    if (!map) return;
    markers.forEach(function (marker) { map.removeChild(marker); });
    markers = pins.map(function (pin) {
      var element = document.createElement('div');
      element.className = 'pin' + (pin.selected ? ' selected' : '');
      element.textContent = pin.count > 1 ? String(pin.count) : '';
      element.setAttribute('role', 'button');
      element.setAttribute('aria-label', pin.label);
      element.addEventListener('click', function (event) { event.stopPropagation(); send({ type: 'select', id: pin.id }); });
      var marker = new ymaps3.YMapMarker({ coordinates: [pin.longitude, pin.latitude], zIndex: pin.selected ? 2 : 1 }, element);
      map.addChild(marker);
      return marker;
    });
    fit(pins);
  }
  window.uzbiteSetPoints = render;
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (data && data.source === 'uzbite-map-host' && Array.isArray(data.points)) render(data.points);
  });
  var failed = false;
  var fail = function () { if (!failed) { failed = true; send({ type: 'failed' }); } };
  var timer = setTimeout(fail, 20000);
  var script = document.createElement('script');
  script.src = ${scriptJson(api)};
  script.onerror = fail;
  script.onload = function () {
    if (!window.ymaps3) { fail(); return; }
    ymaps3.ready.then(function () {
      clearTimeout(timer);
      map = new ymaps3.YMap(document.getElementById('map'), { location: { center: center, zoom: 12 } });
      map.addChild(new ymaps3.YMapDefaultSchemeLayer({ theme: ${dark ? "'dark'" : "'light'"} }));
      map.addChild(new ymaps3.YMapDefaultFeaturesLayer());
      render(pending);
      send({ type: 'ready' });
    }).catch(fail);
  };
  document.head.appendChild(script);
})();
</script></body></html>`;
}
