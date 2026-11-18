import { Pressable, Switch, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import { courierApi } from '../api/courier';
import { usePrefs } from '../prefs';
import { useConnectivity } from '../realtime';
import { useAccount, useActiveDelivery, useEarnings, useOffers } from '../hooks';
import { money } from '../lib/format';
import { Icon } from '../ui/Icon';
import { AppText, Badge, Banner, Button, Card, Screen } from '../ui/kit';
import { Avatar, ConnectionBanner, PermissionNotice, StatusPill, useAction } from './shared';
import type { RootStackParams } from '../navigation';

type Nav = NativeStackNavigationProp<RootStackParams>;

export function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const { t, colors, language } = usePrefs();
  const { online } = useConnectivity();
  const queryClient = useQueryClient();
  const account = useAccount(), active = useActiveDelivery(), offers = useOffers(), earnings = useEarnings();
  const toggle = useAction();
  const data = account.data!;
  const profile = data.profile;
  const offerCount = offers.data?.items.length ?? 0;
  const refreshing = account.isFetching || active.isFetching || offers.isFetching || earnings.isFetching;
  const refresh = () => { void Promise.all([account.refetch(), active.refetch(), offers.refetch(), earnings.refetch()]); };
  const setAvailable = (value: boolean) => void toggle.run(async () => {
    const next = await courierApi.setAvailability(value);
    queryClient.setQueryData(['me'], next);
    await Promise.all([queryClient.invalidateQueries({ queryKey: ['offers'] }), queryClient.invalidateQueries({ queryKey: ['map'] })]);
    // Going online (confirmed by the server) opens the map of restaurants waiting for a courier.
    if (value && next.profile.isAvailable) navigation.navigate('Map');
  });
  const canGoOnline = profile.workMode === 'RESTAURANT' ? profile.permissions.restaurantMode : profile.workMode === 'FREELANCE' ? profile.permissions.freelanceMode : false;

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Avatar first={profile.firstName} last={profile.lastName} />
        <View style={{ flex: 1, gap: 4 }}>
          <AppText variant="heading" numberOfLines={2}>{`${profile.firstName} ${profile.lastName}`.trim()}</AppText>
          <AppText variant="caption" muted>{profile.workMode ? t(`mode${profile.workMode}`) : '—'}</AppText>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={t('notifications')} hitSlop={10} onPress={() => navigation.navigate('Notifications')}
          style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="notifications" color={colors.text} />
        </Pressable>
      </View>
      <ConnectionBanner />
      <PermissionNotice account={data} />

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1, gap: 6 }}>
            <AppText variant="heading">{t('homeAvailability')}</AppText>
            <StatusPill availability={profile.availability} />
          </View>
          <Switch accessibilityLabel={t('homeAvailability')} value={profile.isAvailable} disabled={toggle.busy || !online || (!profile.isAvailable && !canGoOnline)} onValueChange={setAvailable}
            trackColor={{ true: colors.accent, false: colors.border }} thumbColor={colors.surface} ios_backgroundColor={colors.border} />
        </View>
        {profile.availability === 'BUSY' ? <AppText variant="caption" muted>{t('homeBusy')}</AppText> : null}
        {toggle.error ? <Banner tone="danger" text={toggle.error} /> : null}
        {profile.isAvailable ? <Button title={t('mapOpen')} icon="map" variant="secondary" onPress={() => navigation.navigate('Map')} /> : null}
      </Card>

      {active.data ? (
        <Card onPress={() => navigation.navigate('Delivery', { id: active.data!.id })} accessibilityLabel={t('homeActive')}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Icon name="delivery" color={colors.accentText} />
            <AppText variant="heading" style={{ flex: 1 }}>{t('homeActive')}</AppText>
            <Badge tone="accent" text={t(`ds${active.data.status}`)} />
          </View>
          <AppText>{t('deliveryTitle', { number: active.data.number })} · {active.data.restaurant.name}</AppText>
          <AppText variant="label" color={colors.accentText}>{t('open')}</AppText>
        </Card>
      ) : null}

      <Card onPress={() => navigation.navigate('Tabs', { screen: 'Offers' })} accessibilityLabel={t('homeOffers')}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Icon name="orders" color={colors.accentText} />
          <AppText variant="heading" style={{ flex: 1 }}>{t('homeOffers')}</AppText>
          {offerCount ? <Badge tone="accent" text={String(offerCount)} /> : null}
        </View>
        <AppText muted>{offerCount ? offers.data!.items.map(offer => offer.restaurant.name).slice(0, 3).join(', ') : t('homeNoOffers')}</AppText>
      </Card>

      <Card onPress={() => navigation.navigate('Earnings')} accessibilityLabel={t('homeEarnings')}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Icon name="wallet" color={colors.accentText} />
          <AppText variant="heading" style={{ flex: 1 }}>{t('homeToday')}</AppText>
          <Icon name="chevron" color={colors.muted} size={18} />
        </View>
        <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
          <View style={{ flex: 1, minWidth: 120 }}><AppText variant="caption" muted>{t('homeDelivered')}</AppText><AppText variant="title">{earnings.data ? String(earnings.data.today.completed) : '—'}</AppText></View>
          <View style={{ flex: 1, minWidth: 120 }}><AppText variant="caption" muted>{t('homeAccrued')}</AppText><AppText variant="heading">{earnings.data ? money(earnings.data.today.accrued, language) : '—'}</AppText></View>
        </View>
      </Card>
    </Screen>
  );
}
