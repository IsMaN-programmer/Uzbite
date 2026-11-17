import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { Icon } from './icons/Icon';
import { FormError, Modal, primaryClass, secondaryClass, useCopy } from './AccountPrimitives';

type Coordinates = [number, number];
export type LocationPoint = { latitude: number; longitude: number };
type MapChild = { update: (props: Record<string, unknown>) => void };
type MapInstance = { addChild: (child: MapChild) => MapInstance; update: (props: Record<string, unknown>) => void; destroy: () => void };
type MapsApi = {
  ready: Promise<void>;
  YMap: new (element: HTMLElement, options: Record<string, unknown>) => MapInstance;
  YMapDefaultSchemeLayer: new (options?: Record<string, unknown>) => MapChild;
  YMapDefaultFeaturesLayer: new (options?: Record<string, unknown>) => MapChild;
  YMapMarker: new (options: { coordinates: Coordinates; draggable: boolean; onDragEnd: (coordinates: Coordinates) => void }, element: HTMLElement) => MapChild;
  YMapListener: new (options: { layer: string; onClick: (object: unknown, event: { coordinates: Coordinates }) => void }) => MapChild;
};

let apiPromise: Promise<MapsApi> | undefined;
function waitForReady(maps: MapsApi): Promise<MapsApi> {
  return new Promise((resolve,reject)=>{
    const timeout=window.setTimeout(()=>reject(new Error('MAP_TIMEOUT')),20000);
    maps.ready.then(()=>{window.clearTimeout(timeout);resolve(maps);}).catch(()=>{window.clearTimeout(timeout);reject(new Error('MAP_UNAVAILABLE'));});
  });
}
function loadYandex(language: string): Promise<MapsApi> {
  if (apiPromise) return apiPromise;
  const existing = (window as unknown as { ymaps3?: MapsApi }).ymaps3;
  if (existing) return waitForReady(existing);
  const key = import.meta.env.VITE_YANDEX_MAPS_API_KEY as string | undefined;
  if (!key) return Promise.reject(new Error('MAP_KEY_MISSING'));
  apiPromise = new Promise<MapsApi>((resolve, reject) => {
    const globals = window as unknown as { ymaps3?: MapsApi };
    const script = document.createElement('script');
    script.src = `https://api-maps.yandex.ru/v3/?apikey=${encodeURIComponent(key)}&lang=${language === 'en' ? 'en_US' : 'ru_RU'}`;
    script.async = true;
    const timeout = window.setTimeout(() => { script.remove(); reject(new Error('MAP_TIMEOUT')); }, 20000);
    script.onload = () => {
      const maps = globals.ymaps3;
      if (!maps) { window.clearTimeout(timeout); reject(new Error('MAP_UNAVAILABLE')); return; }
      maps.ready.then(() => { window.clearTimeout(timeout); resolve(maps); }).catch(() => { window.clearTimeout(timeout); reject(new Error('MAP_UNAVAILABLE')); });
    };
    script.onerror = () => { window.clearTimeout(timeout); script.remove(); reject(new Error('MAP_UNAVAILABLE')); };
    document.head.appendChild(script);
  }).catch((error: unknown) => { apiPromise = undefined; throw error; });
  return apiPromise;
}

export function YandexLocationPicker({ initial, onConfirm, onClose }: { initial?: LocationPoint; onConfirm: (point: LocationPoint) => void; onClose: () => void }) {
  const { language, theme } = useApp();
  const c = useCopy();
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapInstance | null>(null);
  const chooseRef = useRef<((point: Coordinates) => void) | null>(null);
  const [selected, setSelected] = useState<LocationPoint | undefined>(initial);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [geoError, setGeoError] = useState('');
  const [locating, setLocating] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const selectedRef = useRef(initial);
  const geoRequest = useRef(0);
  useEffect(() => {
    let disposed = false;
    setLoaded(false); setError('');setLocating(false);
    loadYandex(language).then((maps) => {
      if (disposed || !container.current) return;
      const point = selectedRef.current;
      const center: Coordinates = point ? [point.longitude, point.latitude] : [69.2797, 41.3111];
      const map = new maps.YMap(container.current, { location: { center, zoom: 14 }, theme: theme === 'dark' ? 'dark' : 'light' });
      mapRef.current = map;
      map.addChild(new maps.YMapDefaultSchemeLayer()).addChild(new maps.YMapDefaultFeaturesLayer());
      const markerElement = document.createElement('div');
      markerElement.setAttribute('aria-label', 'UzBite');
      markerElement.style.cssText = 'width:30px;height:30px;border:5px solid white;border-radius:50% 50% 50% 0;background:#ea580c;box-shadow:0 5px 18px #0005;transform:translate(-50%,-100%) rotate(-45deg);cursor:grab';
      let marker: MapChild | null = null;
      const choose = (coordinates: Coordinates) => {
        const [longitude, latitude] = coordinates;
        if (disposed || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude)>90 || Math.abs(longitude)>180) return;
        selectedRef.current={latitude,longitude};
        setSelected(selectedRef.current);
        if (marker) marker.update({ coordinates });
        else { marker = new maps.YMapMarker({ coordinates, draggable: true, onDragEnd: choose }, markerElement); map.addChild(marker); }
      };
      chooseRef.current = choose;
      map.addChild(new maps.YMapListener({ layer: 'any', onClick: (_object, event) => choose(event.coordinates) }));
      if (point) choose([point.longitude, point.latitude]);
      setLoaded(true);
    }).catch((reason: unknown) => {
      if (!disposed) setError(reason instanceof Error && reason.message === 'MAP_KEY_MISSING' ? 'key' : 'load');
    });
    return () => { disposed = true;geoRequest.current+=1;chooseRef.current = null;mapRef.current?.destroy();mapRef.current = null; };
  }, [attempt, language, theme]);

  function locate() {
    setGeoError('');
    if (!navigator.geolocation || !window.isSecureContext) { setGeoError(c('Геолокация недоступна. Выберите точку на карте вручную.', 'Joylashuvni aniqlab bo‘lmaydi. Xaritadan nuqta tanlang.', 'Location is unavailable. Choose a point on the map.')); return; }
    setLocating(true);
    const request=++geoRequest.current;
    navigator.geolocation.getCurrentPosition((position) => {
      if(request!==geoRequest.current)return;
      const coordinates: Coordinates = [position.coords.longitude, position.coords.latitude];
      chooseRef.current?.(coordinates);
      mapRef.current?.update({ location: { center: coordinates, zoom: 16, duration: 400 } });
      setLocating(false);
    }, () => {
      if(request!==geoRequest.current)return;
      setLocating(false);
      setGeoError(c('Не удалось определить местоположение. Можно выбрать точку вручную.', 'Joylashuv aniqlanmadi. Nuqtani qo‘lda tanlashingiz mumkin.', 'Could not get your location. You can select a point manually.'));
    }, { timeout: 10000, maximumAge: 60000 });
  }

  return <Modal title={c('Куда доставить?', 'Qayerga yetkazamiz?', 'Where should we deliver?')} onClose={onClose} wide fullScreenOnMobile>
    <p className="mb-4 shrink-0 text-sm text-[var(--muted)]">{c('Нажмите на карту или переместите маркер. Адрес вы укажете на следующем шаге.', 'Xaritani bosing yoki belgini suring. Manzilni keyingi qadamda kiriting.', 'Tap the map or drag the marker. You can enter the address in the next step.')}</p>
    <div className="relative min-h-48 flex-1 overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--bg)] sm:h-[min(52dvh,440px)] sm:min-h-64 sm:flex-none">
      <div ref={container} className="h-full w-full" aria-label={c('Карта выбора адреса', 'Manzil tanlash xaritasi', 'Delivery location map')} />
      {!loaded && !error && <div role="status" className="absolute inset-0 flex items-center justify-center bg-[var(--bg)] text-sm text-[var(--muted)]"><span className="mr-3 size-5 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />{c('Загружаем карту', 'Xarita yuklanmoqda', 'Loading map')}</div>}
      {error && <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-8 text-center"><Icon name="location" /><p className="max-w-sm text-sm text-[var(--muted)]">{error === 'key' ? c('Для карты не настроен API-ключ. Добавьте его в локальные настройки проекта.', 'Xarita uchun API kaliti sozlanmagan.', 'The map API key has not been configured.') : c('Карта недоступна. Проверьте подключение и разрешённый домен API-ключа.', 'Xarita ochilmadi. Internet va API kaliti domenini tekshiring.', 'Map unavailable. Check your connection and the API key domain restrictions.')}</p><button className={secondaryClass} onClick={() => setAttempt((value) => value + 1)}>{c('Повторить', 'Qayta urinish', 'Try again')}</button></div>}
      {loaded && <button onClick={locate} disabled={locating} className="absolute bottom-16 right-4 flex min-h-12 items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-semibold text-[var(--text)] shadow-lg disabled:opacity-50"><Icon name="location" />{locating ? c('Определяем…', 'Aniqlanmoqda…', 'Locating…') : c('Я здесь', 'Men shu yerdaman', 'Locate me')}</button>}
    </div>
    <div className="mt-4 shrink-0 space-y-4"><FormError message={geoError} />{selected && <p className="text-xs tabular-nums text-[var(--muted)]">{c('Выбранная точка', 'Tanlangan nuqta', 'Selected point')}: {selected.latitude.toFixed(6)}, {selected.longitude.toFixed(6)}</p>}<div className="flex flex-wrap gap-3"><button className={`${primaryClass} flex-1`} disabled={!selected || !loaded} onClick={() => { if (selectedRef.current) onConfirm(selectedRef.current); }}><Icon name="check" />{c('Подтвердить точку', 'Nuqtani tasdiqlash', 'Confirm location')}</button><button className={secondaryClass} onClick={onClose}>{c('Отмена', 'Bekor qilish', 'Cancel')}</button></div></div>
  </Modal>;
}

export default YandexLocationPicker;

