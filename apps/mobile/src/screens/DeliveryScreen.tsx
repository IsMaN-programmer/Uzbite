import { useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CourierDelivery, DeliveryStatus } from '@uzbite/shared';
import { asAppError } from '../api/client';
import { courierApi } from '../api/courier';
import { usePrefs } from '../prefs';
import { useConnectivity } from '../realtime';
import { money, time } from '../lib/format';
import { callPhone, openRoute, pointOf } from '../lib/maps';
import { Icon } from '../ui/Icon';
import { AppText, Badge, Banner, Button, Card, ConfirmDialog, QueryState, Screen } from '../ui/kit';
import { ConnectionBanner, useAction } from './shared';
import type { RootStackParams } from '../navigation';

type Dialog = 'pickup' | 'start' | 'cash' | 'complete' | 'release' | 'requestCancel' | 'codeProblem';
const STEPS: DeliveryStatus[] = ['ASSIGNED', 'READY_FOR_PICKUP', 'PICKED_UP', 'ON_THE_WAY', 'DELIVERED'];
const ACTIVE: DeliveryStatus[] = ['ASSIGNED', 'READY_FOR_PICKUP', 'PICKED_UP', 'ON_THE_WAY'];

export function DeliveryScreen() {
  const { params } = useRoute<RouteProp<RootStackParams, 'Delivery'>>();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const { t, colors, language } = usePrefs();
  const { online, realtime } = useConnectivity();
  const queryClient = useQueryClient();
  const delivery = useQuery({ queryKey: ['delivery', params.id], queryFn: () => courierApi.delivery(params.id), refetchInterval: realtime ? false : 15000 });
  const action = useAction();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [code, setCode] = useState('');
  const data = delivery.data;
  useEffect(() => { if (data) navigation.setOptions({ title: t('deliveryTitle', { number: data.number }) }); }, [data, navigation, t]);

  const sync = async (next?: CourierDelivery) => {
    if (next) queryClient.setQueryData(['delivery', params.id], next);
    await Promise.all(['active', 'me', 'offers', 'history', 'earnings'].map(key => queryClient.invalidateQueries({ queryKey: [key] })));
  };
  /** Every action is idempotent on the server; after a lost answer the screen simply re-reads it. */
  const perform = (kind: Dialog, reason?: string) => void action.run(async () => {
    try {
      if (kind === 'pickup') await sync(await courierApi.pickup(params.id));
      else if (kind === 'start') await sync(await courierApi.start(params.id));
      else if (kind === 'cash') await sync(await courierApi.cashCollected(params.id));
      else if (kind === 'complete') { await sync(await courierApi.complete(params.id, code)); setCode(''); }
      else if (kind === 'codeProblem') await sync((await courierApi.handoffProblem(params.id, reason ?? '')).delivery);
      else {
        const result = await courierApi.requestCancellation(params.id, reason ?? '');
        await sync(result.delivery ?? undefined);
        if (result.outcome === 'RELEASED') { setDialog(null); navigation.goBack(); return; }
      }
      setDialog(null);
    } catch (failure) {
      setDialog(null);
      // A wrong code changes the attempts counter; a lost answer may have been applied — re-read both ways.
      if (asAppError(failure).uncertain || asAppError(failure).code.startsWith('HANDOFF')) void delivery.refetch();
      throw failure;
    }
  });

  if (!data) return <Screen edges={['bottom']}><QueryState loading={delivery.isPending} error={delivery.error} onRetry={() => void delivery.refetch()}>{null}</QueryState></Screen>;
  const active = ACTIVE.includes(data.status);
  const mine = Boolean(data.dropoff) || !active;
  const restaurantPoint = pointOf(data.restaurant.latitude, data.restaurant.longitude);
  const customerPoint = data.dropoff ? pointOf(data.dropoff.latitude, data.dropoff.longitude) : null;
  const cashPending = data.cash.status === 'PENDING';
  const stepIndex = STEPS.indexOf(data.status);
  const dialogs: Record<Dialog, { title: string; message?: string; label: string; reason?: boolean; destructive?: boolean }> = {
    pickup: { title: t('actPickup'), message: t('cfPickup'), label: t('actPickup') },
    start: { title: t('actStart'), message: t('cfStart'), label: t('actStart') },
    cash: { title: t('actCash'), message: t('cfCash', { sum: money(data.cash.amount, language) }), label: t('actCash') },
    complete: { title: t('actComplete'), message: t('cfComplete', { code }), label: t('actComplete') },
    release: { title: t('actRelease'), message: t('cfRelease'), label: t('actRelease'), reason: true, destructive: true },
    requestCancel: { title: t('actRequestCancel'), message: t('cfRequestCancel'), label: t('actRequestCancel'), reason: true, destructive: true },
    codeProblem: { title: t('actCodeProblem'), message: t('cfCodeProblem'), label: t('actCodeProblem'), reason: true },
  };
  const current = dialog ? dialogs[dialog] : null;
  const hasIssue = (type: string) => data.openIssues.some(issue => issue.type === type);

  return (
    <Screen edges={['bottom']} refreshing={delivery.isFetching} onRefresh={() => void delivery.refetch()}>
      <ConnectionBanner />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Badge tone={data.status === 'DELIVERED' ? 'success' : active ? 'accent' : 'danger'} text={t(`ds${data.status}`)} />
        {data.mode ? <Badge text={t(`offersMode${data.mode}`)} /> : null}
      </View>
      {stepIndex >= 0 ? (
        <View style={{ flexDirection: 'row', gap: 6 }} accessibilityLabel={t(`ds${data.status}`)}>
          {STEPS.map((step, index) => <View key={step} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: index <= stepIndex ? colors.accent : colors.border }} />)}
        </View>
      ) : null}
      {!mine ? <Banner tone="warning" text={t('deliveryReleased')} /> : null}
      {data.status === 'DELIVERED' ? <Banner tone="success" text={t('deliveryDone')} /> : null}
      {data.closeReason && !active && data.status !== 'DELIVERED' ? <Banner tone="danger" text={data.closeReason} /> : null}
      {data.openIssues.map(issue => <Banner key={issue.id} tone="warning" icon="alert" text={`${t(`issue${issue.type}`)}: ${t('issueOpen')}`} />)}
      {action.error ? <Banner tone="danger" text={action.error} /> : null}

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Icon name="restaurant" color={colors.accentText} />
          <AppText variant="heading" style={{ flex: 1 }}>{t('pickupSection')}</AppText>
        </View>
        <AppText variant="heading">{data.restaurant.name}</AppText>
        <AppText selectable>{data.restaurant.addressText}</AppText>
        {active ? <Badge tone={data.readyAt ? 'success' : 'warning'} text={data.readyAt ? t('isReady') : t('waitReady')} /> : null}
        {active ? (restaurantPoint
          ? <Button title={t('routeRestaurant')} icon="map" variant="secondary" onPress={() => void openRoute(restaurantPoint)} />
          : <AppText variant="caption" muted>{t('noCoordinates')}</AppText>) : null}
        {active && data.restaurant.phone ? <Button title={`${t('call')} · ${data.restaurant.phone}`} icon="phone" variant="ghost" onPress={() => void callPhone(data.restaurant.phone!)} /> : null}
      </Card>

      {data.dropoff ? (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Icon name="location" color={colors.accentText} />
            <AppText variant="heading" style={{ flex: 1 }}>{t('dropoffSection')}</AppText>
          </View>
          <AppText selectable>{data.dropoff.addressText}</AppText>
          <AppText muted>{[data.dropoff.entrance && t('entrance', { v: data.dropoff.entrance }), data.dropoff.floor && t('floor', { v: data.dropoff.floor }), data.dropoff.apartment && t('apartment', { v: data.dropoff.apartment })].filter(Boolean).join(' · ')}</AppText>
          {data.dropoff.comment ? <AppText>{t('comment', { v: data.dropoff.comment })}</AppText> : null}
          <AppText variant="label">{data.dropoff.recipientName}</AppText>
          {customerPoint
            ? <Button title={t('routeCustomer')} icon="map" variant="secondary" onPress={() => void openRoute(customerPoint)} />
            : <AppText variant="caption" muted>{t('noCoordinates')}</AppText>}
          {data.dropoff.recipientPhone ? <Button title={`${t('call')} · ${data.dropoff.recipientPhone}`} icon="phone" variant="ghost" onPress={() => void callPhone(data.dropoff!.recipientPhone)} /> : null}
        </Card>
      ) : null}

      <Card>
        <AppText variant="heading">{t('items')}</AppText>
        {data.order.items.map((item, index) => <AppText key={`${item.name}-${index}`}>{item.quantity} × {item.name}</AppText>)}
        <AppText variant="label">{data.order.paymentMethod ? t(`pay${data.order.paymentMethod}`) : ''} · {money(data.order.total, language)}</AppText>
        {data.cash.status !== 'NOT_APPLICABLE' ? <Badge tone={cashPending ? 'warning' : 'success'} text={cashPending ? t('cashToCollect', { sum: money(data.cash.amount, language) }) : t('cashDone')} /> : null}
        {data.reward !== null ? <AppText muted>{data.rewardStatus === 'NONE' ? t('offersReward', { sum: money(data.reward, language) }) : t('rewardLine', { sum: money(data.reward, language), status: t(`reward${data.rewardStatus}`) })}</AppText> : null}
        {data.assignedAt ? <AppText variant="caption" muted>{t('dsASSIGNED')}: {time(data.assignedAt)}{data.deliveredAt ? ` · ${t('dsDELIVERED')}: ${time(data.deliveredAt)}` : ''}</AppText> : null}
      </Card>

      {mine && active ? (
        <View style={{ gap: 10 }}>
          {data.status === 'ASSIGNED' || data.status === 'READY_FOR_PICKUP'
            ? <Button title={t('actPickup')} icon="check" disabled={data.status !== 'READY_FOR_PICKUP' || !online} loading={action.busy && dialog === 'pickup'} onPress={() => setDialog('pickup')} /> : null}
          {data.status === 'PICKED_UP' ? <Button title={t('actStart')} icon="arrow" disabled={!online} onPress={() => setDialog('start')} /> : null}
          {data.status === 'ON_THE_WAY' && cashPending ? <Button title={t('actCash')} icon="cash" disabled={!online} onPress={() => setDialog('cash')} /> : null}
          {data.status === 'ON_THE_WAY' && !cashPending ? (
            <Card>
              <AppText variant="label" muted>{t('codeLabel')}</AppText>
              <TextInput value={code} onChangeText={value => setCode(value.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" maxLength={4} accessibilityLabel={t('codeLabel')} placeholder="••••" placeholderTextColor={colors.muted}
                style={{ minHeight: 64, borderRadius: 16, borderWidth: 1, borderColor: colors.border, color: colors.text, fontSize: 30, letterSpacing: 12, textAlign: 'center', fontWeight: '800' }} />
              <AppText variant="caption" muted>{t('attemptsLeft', { n: data.handoffAttemptsLeft })}</AppText>
              <Button title={t('actComplete')} icon="check" disabled={code.length !== 4 || data.handoffAttemptsLeft === 0 || !online} onPress={() => setDialog('complete')} />
            </Card>
          ) : null}
          {data.status === 'ON_THE_WAY' && !hasIssue('HANDOFF_CODE_UNAVAILABLE') ? <Button title={t('actCodeProblem')} icon="help" variant="secondary" disabled={!online} onPress={() => setDialog('codeProblem')} /> : null}
          {data.status === 'ASSIGNED' || data.status === 'READY_FOR_PICKUP'
            ? <Button title={t('actRelease')} variant="danger" disabled={!online} onPress={() => setDialog('release')} />
            : !hasIssue('CANCELLATION_REQUEST') ? <Button title={t('actRequestCancel')} variant="danger" disabled={!online} onPress={() => setDialog('requestCancel')} /> : null}
        </View>
      ) : null}

      <ConfirmDialog visible={Boolean(current)} title={current?.title ?? ''} message={current?.message} confirmLabel={current?.label} reason={current?.reason} destructive={current?.destructive} busy={action.busy}
        onCancel={() => setDialog(null)} onConfirm={reason => { if (dialog) perform(dialog, reason); }} />
    </Screen>
  );
}
