import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import type { CourierOffer } from '@uzbite/shared';
import { AppError, asAppError } from '../api/client';
import { courierApi } from '../api/courier';
import { usePrefs } from '../prefs';
import { useConnectivity } from '../realtime';
import { useAccount, useNow, useOffers } from '../hooks';
import { countdown, money, zoneName } from '../lib/format';
import { Icon } from '../ui/Icon';
import { AppText, Badge, Banner, Button, Card, ConfirmDialog, EmptyState, QueryState, Screen } from '../ui/kit';
import { ConnectionBanner } from './shared';
import type { RootStackParams } from '../navigation';

type Nav = NativeStackNavigationProp<RootStackParams>;
/** accepting: request in flight · checking: the answer was lost, asking the server · unknown: still no server. */
type Pending = 'accepting' | 'checking' | 'unknown';

export function OffersScreen() {
  const navigation = useNavigation<Nav>();
  const { t, colors, language, errorText } = usePrefs();
  const { online, realtime } = useConnectivity();
  const queryClient = useQueryClient();
  const account = useAccount();
  const offers = useOffers();
  const now = useNow();
  const [pending, setPending] = useState<Record<string, Pending>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [rejecting, setRejecting] = useState<CourierOffer | null>(null);
  const [rejectBusy, setRejectBusy] = useState(false);
  const inFlight = useRef(new Set<string>());
  // Server clock: deadlines are compared with server time, not the phone's clock.
  const offset = offers.data ? Date.parse(offers.data.serverTime) - offers.data.receivedAt : 0;
  const mark = (id: string, state: Pending | null) => setPending(previous => { const next = { ...previous }; if (state) next[id] = state; else delete next[id]; return next; });
  const refreshAll = useCallback(() => Promise.all(['offers', 'active', 'me'].map(key => queryClient.invalidateQueries({ queryKey: [key] }))), [queryClient]);

  // Offers whose acceptance outcome is unknown, kept even if they drop out of the list meanwhile.
  const unresolved = useRef(new Map<string, CourierOffer>());
  /** After a lost answer the offer counts as accepted only if the server shows it as our delivery. */
  const verify = useCallback(async (offer: CourierOffer) => {
    mark(offer.id, 'checking');
    try {
      const active = await courierApi.activeDelivery();
      unresolved.current.delete(offer.id);
      if (active?.id === offer.deliveryId) { queryClient.setQueryData(['active'], active); mark(offer.id, null); await refreshAll(); navigation.navigate('Delivery', { id: active.id }); return; }
      const { offer: fresh } = await courierApi.offer(offer.id);
      mark(offer.id, null);
      if (fresh.status !== 'PENDING') setErrors(previous => ({ ...previous, [offer.id]: errorText(new AppError(`OFFER_${fresh.status}`, '')) }));
      await refreshAll();
    } catch (failure) {
      if (asAppError(failure).uncertain) { unresolved.current.set(offer.id, offer); mark(offer.id, 'unknown'); }
      else { unresolved.current.delete(offer.id); mark(offer.id, null); setErrors(previous => ({ ...previous, [offer.id]: errorText(failure) })); }
    }
  }, [errorText, navigation, queryClient, refreshAll]);

  const accept = async (offer: CourierOffer) => {
    if (inFlight.current.has(offer.id)) return;
    inFlight.current.add(offer.id);
    mark(offer.id, 'accepting');
    setErrors(previous => { const next = { ...previous }; delete next[offer.id]; return next; });
    try {
      const delivery = await courierApi.acceptOffer(offer.id);
      queryClient.setQueryData(['active'], delivery);
      mark(offer.id, null);
      await refreshAll();
      navigation.navigate('Delivery', { id: delivery.id });
    } catch (failure) {
      if (asAppError(failure).uncertain) await verify(offer);
      else { mark(offer.id, null); setErrors(previous => ({ ...previous, [offer.id]: errorText(failure) })); void refreshAll(); }
    } finally { inFlight.current.delete(offer.id); }
  };

  // Re-checked once when the server is reachable again (the live socket reconnects), not in a loop.
  useEffect(() => {
    if (!online || !realtime) return;
    for (const offer of [...unresolved.current.values()]) void verify(offer);
  }, [online, realtime, verify]);

  const items = offers.data?.items ?? [];
  return (
    <Screen refreshing={offers.isFetching} onRefresh={() => void offers.refetch()}>
      <AppText variant="title">{t('offersTitle')}</AppText>
      <ConnectionBanner />
      <QueryState loading={offers.isPending} error={offers.isError && !offers.data ? offers.error : null} onRetry={() => void offers.refetch()}>
        {!items.length ? <EmptyState icon="orders" text={account.data?.profile.isAvailable ? t('homeNoOffers') : t('offersEmpty')} /> : null}
        {items.map(offer => {
          const secondsLeft = Math.floor((Date.parse(offer.expiresAt) - (now + offset)) / 1000);
          const expired = secondsLeft <= 0;
          const state = pending[offer.id];
          return (
            <Card key={offer.id}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Badge tone={offer.mode === 'RESTAURANT_COURIER' ? 'accent' : 'neutral'} text={t(`offersMode${offer.mode}`)} />
                <View style={{ flex: 1 }} />
                <Icon name="clock" color={expired ? colors.danger : colors.accentText} size={18} />
                <AppText variant="label" color={expired ? colors.danger : colors.accentText}>{expired ? t('offersExpired') : t('offersLeft', { time: countdown(secondsLeft) })}</AppText>
              </View>
              <AppText variant="heading" numberOfLines={2}>{offer.restaurant.name}</AppText>
              <AppText muted>{offer.restaurant.addressText}</AppText>
              {offer.restaurant.zone ? <AppText variant="caption" muted>{t('offersZone', { zone: zoneName(offer.restaurant.zone, language) })}</AppText> : null}
              <View style={{ gap: 4 }}>
                {offer.straightLineKm !== null ? <AppText>{t('offersStraight', { km: language === 'en' ? String(offer.straightLineKm) : String(offer.straightLineKm).replace('.', ',') })}</AppText> : null}
                <AppText>{t('offersItems', { n: offer.order.itemCount })} · №{offer.order.number}</AppText>
                <AppText>{offer.order.cashToCollect !== null ? t('offersCash', { sum: money(offer.order.cashToCollect, language) }) : t('offersCard')}</AppText>
                <AppText variant="label">{offer.reward !== null ? t('offersReward', { sum: money(offer.reward, language) }) : t('offersNoReward')}</AppText>
              </View>
              {state === 'checking' ? <Banner tone="warning" icon="refresh" text={t('offersChecking')} /> : null}
              {state === 'unknown' ? <Banner tone="danger" icon="wifiOff" text={t('offersUnknown')} action={t('offersCheckAgain')} onAction={() => void verify(offer)} /> : null}
              {errors[offer.id] ? <Banner tone="danger" text={errors[offer.id]!} /> : null}
              <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
                <Button title={t('offersReject')} variant="secondary" disabled={Boolean(state) || expired} onPress={() => setRejecting(offer)} style={{ flex: 1, minWidth: 130 }} />
                <Button title={t('offersAccept')} loading={state === 'accepting' || state === 'checking'} disabled={Boolean(state) || expired || !online} onPress={() => void accept(offer)} style={{ flex: 1, minWidth: 130 }} />
              </View>
            </Card>
          );
        })}
      </QueryState>
      <ConfirmDialog visible={Boolean(rejecting)} title={t('offersRejectTitle')} reason reasonOptional destructive confirmLabel={t('offersReject')} busy={rejectBusy}
        onCancel={() => setRejecting(null)}
        onConfirm={reason => void (async () => {
          if (!rejecting) return;
          setRejectBusy(true);
          try { await courierApi.rejectOffer(rejecting.id, reason); } catch (failure) { setErrors(previous => ({ ...previous, [rejecting.id]: errorText(failure) })); }
          finally { setRejectBusy(false); setRejecting(null); void refreshAll(); }
        })()} />
    </Screen>
  );
}
