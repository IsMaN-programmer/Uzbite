import { Pressable, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { usePrefs } from '../prefs';
import { useAccount, useActiveDelivery, useEarnings, useOffers } from '../hooks';
import { money } from '../lib/format';
import { Icon } from '../ui/Icon';
import { AppText, Badge, Banner, Card, Screen } from '../ui/kit';
import { Avatar, ConnectionBanner, PermissionNotice, StatusPill } from './shared';
import type { RootStackParams } from '../navigation';

type Nav = NativeStackNavigationProp<RootStackParams>;

/**
 * No "accepting orders" switch: the server keeps a verified courier (restaurant link for own-restaurant
 * mode, UzBite approval for free deliveries) on duty, and offers simply arrive. A courier who is not
 * verified for the current mode sees one plain line instead of the map.
 */
export function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const { t, colors, language } = usePrefs();
  const account = useAccount(), active = useActiveDelivery(), offers = useOffers(), earnings = useEarnings();
  const data = account.data!;
  const profile = data.profile;
  const verified = profile.availability !== 'UNAVAILABLE';
  const offerCount = offers.data?.items.length ?? 0;
  const refreshing = account.isFetching || active.isFetching || offers.isFetching || earnings.isFetching;
  const refresh = () => { void Promise.all([account.refetch(), active.refetch(), offers.refetch(), earnings.refetch()]); };

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
      {!verified && profile.permissions.reason !== 'SUSPENDED' ? <Banner tone="info" icon="shield" text={t('verifiedOnly')} /> : null}

      {verified ? (
        <Card onPress={() => navigation.navigate('Map')} accessibilityLabel={t('mapTitle')}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Icon name="map" color={colors.accentText} />
            <AppText variant="heading" style={{ flex: 1 }}>{t('mapTitle')}</AppText>
            <StatusPill availability={profile.availability} />
          </View>
          <AppText muted>{profile.availability === 'BUSY' ? t('homeBusy') : t('mapHint')}</AppText>
          <AppText variant="label" color={colors.accentText}>{t('open')}</AppText>
        </Card>
      ) : null}

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

      {verified ? (
        <Card onPress={() => navigation.navigate('Tabs', { screen: 'Offers' })} accessibilityLabel={t('homeOffers')}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Icon name="orders" color={colors.accentText} />
            <AppText variant="heading" style={{ flex: 1 }}>{t('homeOffers')}</AppText>
            {offerCount ? <Badge tone="accent" text={String(offerCount)} /> : null}
          </View>
          <AppText muted>{offerCount ? offers.data!.items.map(offer => offer.restaurant.name).slice(0, 3).join(', ') : t('homeNoOffers')}</AppText>
        </Card>
      ) : null}

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
