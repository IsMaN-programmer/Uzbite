import { useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import type { Language } from '@uzbite/shared';
import { courierApi } from '../api/courier';
import { usePrefs } from '../prefs';
import { useCourierLocation } from '../location';
import { useAccount, useActiveDelivery, useNearbyOrders } from '../hooks';
import { money } from '../lib/format';
import { Icon } from '../ui/Icon';
import { AppText, Badge, Banner, Button, Card, EmptyState, QueryState } from '../ui/kit';
import { useAction } from './shared';
import type { RootStackParams } from '../navigation';

const km = (value: number, language: Language) => (language === 'en' ? String(value) : String(value).replace('.', ','));

/**
 * MVP order flow: open orders within 5 km of the courier appear here (polled every 10 s);
 * «Взять заказ» gives the order to the first courier and opens it. Others get «уже принят».
 */
export function NearbyOrders() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const { t, colors, language } = usePrefs();
  const queryClient = useQueryClient();
  const account = useAccount(), active = useActiveDelivery();
  const verified = account.data?.profile.availability !== 'UNAVAILABLE';
  const location = useCourierLocation();
  const nearby = useNearbyOrders(verified);
  const take = useAction();
  const [taking, setTaking] = useState<string | null>(null);
  const items = nearby.data?.items ?? [];

  const takeOrder = (orderId: string) => void take.run(async () => {
    setTaking(orderId);
    try {
      const delivery = await courierApi.takeOrder(orderId);
      queryClient.setQueryData(['delivery', delivery.id], delivery);
      await Promise.all(['active', 'nearby', 'me', 'offers', 'history', 'map'].map(key => queryClient.invalidateQueries({ queryKey: [key] })));
      navigation.navigate('Delivery', { id: delivery.id });
    } catch (failure) {
      // Taken by someone else or gone: the list is re-read at once so the order disappears.
      void nearby.refetch();
      throw failure;
    } finally { setTaking(null); }
  });

  if (!verified) return <EmptyState icon="shield" text={t('verifiedOnly')} />;
  return (
    <View style={{ gap: 12 }}>
      {active.data ? (
        <Card onPress={() => navigation.navigate('Delivery', { id: active.data!.id })} accessibilityLabel={t('homeActive')} style={{ borderColor: colors.accent }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Icon name="delivery" color={colors.accentText} />
            <AppText variant="heading" style={{ flex: 1 }}>{t('homeActive')}</AppText>
            <Badge tone="accent" text={t(`ds${active.data.status}`)} />
          </View>
          <AppText>{t('deliveryTitle', { number: active.data.number })} · {active.data.restaurant.name}</AppText>
          <AppText variant="label" color={colors.accentText}>{t('open')}</AppText>
        </Card>
      ) : null}

      <AppText variant="heading">{t('nearbyTitle', { km: nearby.data?.radiusKm ?? 5 })}</AppText>
      {location.status === 'denied' || location.status === 'unavailable'
        ? <Banner tone="info" icon="location" text={t('locationNeeded')} action={t('locationAllow')} onAction={location.retry} /> : null}
      {take.error ? <Banner tone="danger" text={take.error} /> : null}
      {active.data ? <AppText muted>{t('homeBusy')}</AppText> : (
        <QueryState loading={nearby.isPending} error={nearby.isError && !nearby.data ? nearby.error : null} onRetry={() => void nearby.refetch()}>
          {nearby.data && !nearby.data.located && location.status !== 'denied' ? <AppText muted>{t('locating')}</AppText> : null}
          {nearby.data?.located && !items.length ? <EmptyState icon="orders" text={t('nearbyEmpty')} /> : null}
          {items.map(order => (
            <Card key={order.orderId}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Icon name="restaurant" color={colors.accentText} />
                <AppText variant="heading" style={{ flex: 1 }} numberOfLines={2}>{order.restaurant.name}</AppText>
                <Badge tone="accent" text={t('nearbyKm', { km: km(order.distanceKm, language) })} />
              </View>
              <AppText muted>{order.restaurant.addressText}</AppText>
              <AppText>{t('deliveryTitle', { number: order.number })} · {t('offersItems', { n: order.itemCount })}</AppText>
              {order.paymentMethod === 'CASH' ? <AppText muted>{t('offersCash', { sum: money(order.total, language) })}</AppText> : null}
              {order.paymentMethod === 'CARD' ? <AppText muted>{t('offersCard')}</AppText> : null}
              {order.reward !== null ? <AppText variant="label">{t('offersReward', { sum: money(order.reward, language) })}</AppText> : null}
              <Button title={t('takeOrder')} icon="check" loading={taking === order.orderId} disabled={Boolean(taking) && taking !== order.orderId} onPress={() => takeOrder(order.orderId)} />
            </Card>
          ))}
        </QueryState>
      )}
    </View>
  );
}
