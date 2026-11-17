import { useState } from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useInfiniteQuery } from '@tanstack/react-query';
import { courierApi, type HistoryFilter } from '../api/courier';
import { usePrefs } from '../prefs';
import { useEarnings } from '../hooks';
import { dateTime, money } from '../lib/format';
import { Icon } from '../ui/Icon';
import { AppText, Badge, Banner, Button, Card, EmptyState, QueryState, Screen, Segmented } from '../ui/kit';
import type { RootStackParams } from '../navigation';

/** Accepted deliveries with their outcome. No customer name, phone or address is kept here. */
export function HistoryScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const { t, colors, language } = usePrefs();
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const history = useInfiniteQuery({
    queryKey: ['history', filter], initialPageParam: 1,
    queryFn: ({ pageParam }) => courierApi.history(filter, pageParam),
    getNextPageParam: last => (last.hasMore ? last.page + 1 : undefined),
  });
  const items = history.data?.pages.flatMap(page => page.items) ?? [];
  const tone = { DELIVERED: 'success', CANCELLED: 'danger', FAILED: 'danger', IN_PROGRESS: 'accent' } as const;
  return (
    <Screen refreshing={history.isRefetching} onRefresh={() => void history.refetch()}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <AppText variant="title" style={{ flex: 1 }}>{t('historyTitle')}</AppText>
        <Button title={t('earningsTitle')} icon="wallet" variant="secondary" onPress={() => navigation.navigate('Earnings')} />
      </View>
      <Segmented value={filter} onChange={setFilter} options={[
        { value: 'all', label: t('fAll') }, { value: 'completed', label: t('fCompleted') }, { value: 'cancelled', label: t('fCancelled') },
        { value: 'restaurant', label: t('fRestaurant') }, { value: 'freelance', label: t('fFreelance') },
      ]} />
      <QueryState loading={history.isPending} error={history.isError && !history.data ? history.error : null} onRetry={() => void history.refetch()}>
        {!items.length ? <EmptyState icon="clock" text={t('historyEmpty')} /> : null}
        {items.map(item => (
          <Card key={item.offerId} onPress={item.outcome === 'IN_PROGRESS' ? () => navigation.navigate('Delivery', { id: item.deliveryId }) : undefined}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <AppText variant="heading" style={{ flex: 1 }} numberOfLines={2}>{item.restaurantName}</AppText>
              <Badge tone={tone[item.outcome]} text={t(`out${item.outcome}`)} />
            </View>
            <AppText muted>№{item.number} · {t(`offersMode${item.mode}`)}</AppText>
            <AppText variant="caption" muted>{dateTime(item.acceptedAt)}{item.finishedAt ? ` → ${dateTime(item.finishedAt)}` : ''}</AppText>
            {item.reward !== null ? <AppText>{item.rewardStatus === 'NONE' ? t('offersReward', { sum: money(item.reward, language) }) : t('rewardLine', { sum: money(item.reward, language), status: t(`reward${item.rewardStatus}`) })}</AppText> : null}
            {item.reason ? <View style={{ flexDirection: 'row', gap: 6 }}><Icon name="alert" color={colors.muted} size={16} /><AppText variant="caption" muted style={{ flex: 1 }}>{item.reason}</AppText></View> : null}
          </Card>
        ))}
        {history.isFetchNextPageError ? <Banner tone="danger" text={t('genericError')} /> : null}
        {history.hasNextPage ? <Button title={t('more')} variant="secondary" loading={history.isFetchingNextPage} onPress={() => void history.fetchNextPage()} /> : null}
      </QueryState>
    </Screen>
  );
}

export function EarningsScreen() {
  const { t, language } = usePrefs();
  const earnings = useEarnings();
  const data = earnings.data;
  const rows: [string, string][] = data ? [
    [t('eAccrued'), money(data.totals.accrued, language)], [t('eConfirmed'), money(data.totals.confirmed, language)],
    [t('ePaid'), money(data.totals.paid, language)], [t('ePending'), money(data.pending, language)],
    [t('eCompleted'), String(data.completedCount)], [t('eWithout'), String(data.withoutReward)],
  ] : [];
  return (
    <Screen edges={['bottom']} refreshing={earnings.isFetching} onRefresh={() => void earnings.refetch()}>
      <QueryState loading={earnings.isPending} error={earnings.error} onRetry={() => void earnings.refetch()}>
        {data ? <Card><AppText variant="heading">{t('eToday', { n: data.today.completed, sum: money(data.today.accrued, language) })}</AppText></Card> : null}
        <Card>
          {rows.map(([label, value]) => (
            <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', paddingVertical: 4 }}>
              <AppText muted style={{ flexShrink: 1 }}>{label}</AppText>
              <AppText variant="label">{value}</AppText>
            </View>
          ))}
        </Card>
        <Banner tone="info" text={t('eNote')} />
      </QueryState>
    </Screen>
  );
}
