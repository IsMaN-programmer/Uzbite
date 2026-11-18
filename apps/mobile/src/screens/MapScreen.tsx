import { useCallback, useMemo, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { usePrefs } from '../prefs';
import { useAccount, useCourierMap } from '../hooks';
import { cityCenter, openRoute, pointOf, YANDEX_MAPS_API_KEY } from '../lib/maps';
import { cityName } from '../lib/format';
import { Icon } from '../ui/Icon';
import { AppText, Badge, Banner, Button, Card, EmptyState, QueryState, Screen } from '../ui/kit';
import { YandexMap } from '../ui/YandexMap';
import type { MapPin } from '../ui/yandexMapPage';
import { ConnectionBanner, StatusPill } from './shared';
import type { RootStackParams } from '../navigation';

/**
 * Opens after «Принимаю заказы» is switched on: restaurants waiting for a courier, on a Yandex map
 * and as a list (the list is also the fallback without a map key or network to Yandex).
 */
export function MapScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const { t, colors, language } = usePrefs();
  const { height } = useWindowDimensions();
  const account = useAccount(), map = useCourierMap();
  const [selected, setSelected] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const restaurants = useMemo(() => map.data?.restaurants ?? [], [map.data]);
  const city = map.data?.city ?? account.data?.profile.city ?? null;
  const center = useMemo(() => cityCenter(city), [city]);
  const pins = useMemo<MapPin[]>(() => restaurants.flatMap(item => {
    const point = pointOf(item.latitude, item.longitude);
    return point ? [{ id: item.id, ...point, label: item.name, count: item.waitingOrders, selected: item.id === selected }] : [];
  }), [restaurants, selected]);
  // The selected restaurant (tapped on the map) comes first in the list.
  const ordered = useMemo(() => [...restaurants].sort((a, b) => Number(b.id === selected) - Number(a.id === selected)), [restaurants, selected]);
  const onFailed = useCallback(() => setFailed(true), []);
  const showMap = Boolean(YANDEX_MAPS_API_KEY) && !failed;
  const profile = account.data?.profile;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {showMap ? (
        <View style={{ height: Math.max(260, Math.round(height * 0.5)), borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <YandexMap pins={pins} center={center} onSelect={setSelected} onFailed={onFailed} />
        </View>
      ) : null}
      <Screen edges={['bottom']} refreshing={map.isRefetching} onRefresh={() => void map.refetch()}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {profile ? <StatusPill availability={profile.availability} /> : null}
          {city ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Icon name="location" color={colors.muted} size={16} /><AppText muted>{cityName(city, language)}</AppText></View> : null}
        </View>
        <ConnectionBanner />
        {failed ? <Banner tone="info" icon="map" text={t('mapFailed')} /> : null}
        {!YANDEX_MAPS_API_KEY && __DEV__ ? <Banner tone="info" icon="map" text={t('mapKeyMissing')} /> : null}
        <QueryState loading={map.isPending} error={map.isError && !map.data ? map.error : null} onRetry={() => void map.refetch()}>
          {!restaurants.length ? <EmptyState icon="map" text={t('mapEmpty')} /> : null}
          {ordered.map(item => {
            const point = pointOf(item.latitude, item.longitude);
            return (
              <Card key={item.id} onPress={() => setSelected(item.id)} accessibilityLabel={item.name}
                style={item.id === selected ? { borderColor: colors.accent, borderWidth: 2 } : undefined}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Icon name="restaurant" color={colors.accentText} />
                  <AppText variant="heading" style={{ flex: 1 }} numberOfLines={2}>{item.name}</AppText>
                  <Badge tone="accent" text={t('mapWaiting', { n: item.waitingOrders })} />
                </View>
                <AppText muted>{item.addressText}</AppText>
                <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
                  {point ? <Button title={t('routeRestaurant')} icon="map" variant="secondary" onPress={() => void openRoute(point)} style={{ flex: 1, minWidth: 150 }} /> : null}
                  {item.offerIds.length ? <Button title={t('mapOffers')} icon="orders" onPress={() => navigation.navigate('Tabs', { screen: 'Offers' })} style={{ flex: 1, minWidth: 150 }} /> : null}
                </View>
              </Card>
            );
          })}
        </QueryState>
      </Screen>
    </View>
  );
}
