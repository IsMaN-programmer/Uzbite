import { createElement, useEffect, useMemo, useRef } from 'react';
import { View } from 'react-native';
import { usePrefs } from '../prefs';
import { YANDEX_MAPS_API_KEY } from '../lib/maps';
import { yandexMapPage, type MapPin, type YandexMapProps } from './yandexMapPage';

/** Browser build: the same map page in an iframe (WebView has no web implementation). */
export function YandexMap({ pins, center, onSelect, onFailed }: YandexMapProps) {
  const { t, language, theme, colors } = usePrefs();
  const frame = useRef<HTMLIFrameElement | null>(null);
  const latest = useRef<MapPin[]>(pins);
  latest.current = pins;
  const html = useMemo(() => yandexMapPage({ apiKey: YANDEX_MAPS_API_KEY, language, dark: theme === 'dark', center, pins: latest.current, colors }),
    [language, theme, colors, center.latitude, center.longitude]);
  const push = () => frame.current?.contentWindow?.postMessage({ source: 'uzbite-map-host', points: latest.current }, '*');
  useEffect(push, [pins]);
  useEffect(() => {
    const listen = (event: MessageEvent) => {
      const data = event.data as { source?: string; type?: string; id?: unknown } | null;
      if (event.source !== frame.current?.contentWindow || data?.source !== 'uzbite-map') return;
      if (data.type === 'select' && typeof data.id === 'string') onSelect(data.id);
      if (data.type === 'failed') onFailed();
    };
    window.addEventListener('message', listen);
    return () => window.removeEventListener('message', listen);
  }, [onSelect, onFailed]);
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {createElement('iframe', { ref: frame, srcDoc: html, title: t('mapTitle'), onLoad: push, style: { border: 0, width: '100%', height: '100%', display: 'block' } })}
    </View>
  );
}
