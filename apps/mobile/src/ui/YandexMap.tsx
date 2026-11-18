import { useEffect, useMemo, useRef } from 'react';
import { Linking } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { usePrefs } from '../prefs';
import { YANDEX_MAPS_API_KEY, YANDEX_MAPS_REFERER } from '../lib/maps';
import { scriptJson, yandexMapPage, type MapPin, type YandexMapProps } from './yandexMapPage';

// The package declares `WebView<P = undefined>`, whose props `WebViewProps & undefined` collapse to never.
const MapWebView = WebView<object>;

/** Yandex map in a WebView (works in Expo Go). The browser build uses YandexMap.web.tsx. */
export function YandexMap({ pins, center, onSelect, onFailed }: YandexMapProps) {
  const { language, theme, colors } = usePrefs();
  const view = useRef<WebView<object>>(null);
  const latest = useRef<MapPin[]>(pins);
  latest.current = pins;
  // The page is rebuilt only for a new language, theme or city; pins are pushed into the open page.
  const html = useMemo(() => yandexMapPage({ apiKey: YANDEX_MAPS_API_KEY, language, dark: theme === 'dark', center, pins: latest.current, colors }),
    [language, theme, colors, center.latitude, center.longitude]);
  const push = () => view.current?.injectJavaScript(`window.uzbiteSetPoints && window.uzbiteSetPoints(${scriptJson(latest.current)}); true;`);
  useEffect(push, [pins]);
  const onMessage = (event: WebViewMessageEvent) => {
    let message: { type?: string; id?: string };
    try { message = JSON.parse(event.nativeEvent.data) as typeof message; } catch { return; }
    if (message.type === 'select' && typeof message.id === 'string') onSelect(message.id);
    if (message.type === 'failed') onFailed();
  };
  return (
    <MapWebView ref={view} source={{ html, baseUrl: YANDEX_MAPS_REFERER }} originWhitelist={['*']} onMessage={onMessage} onLoadEnd={push}
      onError={onFailed} onHttpError={onFailed} javaScriptEnabled domStorageEnabled setSupportMultipleWindows={false}
      style={{ flex: 1, backgroundColor: colors.bg }} containerStyle={{ backgroundColor: colors.bg }}
      // Links inside the map (Yandex logo, terms) open in the browser instead of replacing the map.
      onShouldStartLoadWithRequest={request => {
        if (request.isTopFrame === false || /^(about|data):/.test(request.url) || request.url.startsWith(YANDEX_MAPS_REFERER)) return true;
        void Linking.openURL(request.url).catch(() => {});
        return false;
      }} />
  );
}
