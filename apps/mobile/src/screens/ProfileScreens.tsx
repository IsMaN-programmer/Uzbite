import { useState } from 'react';
import { Linking, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CourierAffiliationDto, CourierWorkMode, Language, Theme } from '@uzbite/shared';
import { courierApi, type AppNotification } from '../api/courier';
import { allowCustomServer, appVersion, serverConfig } from '../config';
import { usePrefs } from '../prefs';
import { useSession } from '../session';
import { useAccount, useActiveDelivery } from '../hooks';
import { cityName, dateTime } from '../lib/format';
import { Icon } from '../ui/Icon';
import { AppText, Badge, Banner, Button, Card, ConfirmDialog, EmptyState, Field, QueryState, Row, Screen, Segmented } from '../ui/kit';
import { Avatar, CityPicker, FacePhotoField, InvitationPanel, PassportFields, PermissionNotice, useAction, validPassport } from './shared';
import { validPhone } from './AuthScreens';
import type { RootStackParams } from '../navigation';

type Nav = NativeStackNavigationProp<RootStackParams>;
const SUPPORT_URL = 'https://t.me/skillworkdiscussion';
const NOTICE_EVENTS = ['OFFER_CREATED', 'READY_FOR_PICKUP', 'RELEASED_BY_RESTAURANT', 'ISSUE_RESOLVED', 'CASH_SETTLED', 'REWARD_CONFIRMED', 'REWARD_PAID'] as const;

export function ProfileScreen() {
  const navigation = useNavigation<Nav>();
  const { t, colors, language, theme, setLanguage, setTheme } = usePrefs();
  const session = useSession();
  const queryClient = useQueryClient();
  const account = useAccount().data!;
  const active = useActiveDelivery();
  const profile = account.profile;
  const [confirm, setConfirm] = useState<null | { kind: 'logout' } | { kind: 'mode'; mode: CourierWorkMode }>(null);
  const action = useAction();
  // Preferences are applied at once and saved to the account so every device shows the same.
  const savePrefs = (next: { language?: Language; theme?: Theme }) => {
    if (next.language) setLanguage(next.language);
    if (next.theme) setTheme(next.theme);
    void action.run(async () => { await courierApi.updateSettings(next); await queryClient.invalidateQueries({ queryKey: ['me'] }); });
  };
  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <Avatar first={profile.firstName} last={profile.lastName} size={64} />
        <View style={{ flex: 1, gap: 4 }}>
          <AppText variant="heading">{`${profile.firstName} ${profile.lastName}`.trim()}</AppText>
          <AppText muted numberOfLines={1}>{account.email}</AppText>
          <AppText muted>{account.phone}</AppText>
        </View>
      </View>
      {/* No badge while admission is pending: the courier sees no "waiting for approval" warning. */}
      {profile.approvalStatus !== 'PENDING' ? <Badge tone={profile.approvalStatus === 'APPROVED' ? 'success' : 'danger'} text={t(`approval${profile.approvalStatus}`)} /> : null}
      <PermissionNotice account={account} />
      {action.error ? <Banner tone="danger" text={action.error} /> : null}

      <Card>
        <AppText variant="label" muted>{t('workMode')}</AppText>
        <Segmented value={profile.workMode ?? 'RESTAURANT'} onChange={mode => { if (mode !== profile.workMode) setConfirm({ kind: 'mode', mode }); }}
          options={[{ value: 'RESTAURANT', label: t('modeRESTAURANT') }, { value: 'FREELANCE', label: t('modeFREELANCE') }]} />
      </Card>

      <Card>
        <Row icon="user" label={t('personal')} value={`${profile.firstName} ${profile.lastName}`} onPress={() => navigation.navigate('Personal')} />
        <Row icon="restaurant" label={t('restaurants')} value={String(account.activeAffiliations)} onPress={() => navigation.navigate('Affiliations')} />
        <Row icon="location" label={t('workArea')} value={profile.city ? cityName(profile.city, language) : '—'} onPress={() => navigation.navigate('ServiceArea')} />
        <Row icon="notifications" label={t('notifications')} onPress={() => navigation.navigate('Notifications')} />
        <Row icon="wallet" label={t('earningsTitle')} onPress={() => navigation.navigate('Earnings')} />
        <Row icon="telegram" label={t('support')} value="t.me/skillworkdiscussion" onPress={() => void Linking.openURL(SUPPORT_URL)} />
        {allowCustomServer ? <Row icon="settings" label={t('server')} value={serverConfig().apiUrl} onPress={() => navigation.navigate('Server')} /> : null}
      </Card>

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><Icon name="globe" color={colors.accentText} /><AppText variant="label">{t('language')}</AppText></View>
        <Segmented value={language} onChange={value => savePrefs({ language: value })} options={[{ value: 'ru', label: 'Русский' }, { value: 'uz', label: 'O‘zbekcha' }, { value: 'en', label: 'English' }]} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><Icon name={theme === 'dark' ? 'moon' : 'sun'} color={colors.accentText} /><AppText variant="label">{t('theme')}</AppText></View>
        <Segmented value={theme} onChange={value => savePrefs({ theme: value })} options={[{ value: 'light', label: t('themeLight') }, { value: 'dark', label: t('themeDark') }]} />
      </Card>

      <Banner tone="info" icon="notifications" text={t('pushNote')} />
      <Button title={t('logout')} icon="logout" variant="danger" onPress={() => setConfirm({ kind: 'logout' })} />
      <AppText variant="caption" muted style={{ textAlign: 'center' }}>{t('version', { v: appVersion })}</AppText>

      <ConfirmDialog visible={confirm?.kind === 'logout'} title={t('logoutConfirm')} message={active.data ? t('logoutActive') : undefined} destructive confirmLabel={t('logout')}
        onCancel={() => setConfirm(null)} onConfirm={() => { setConfirm(null); void session.signOut(); }} />
      <ConfirmDialog visible={confirm?.kind === 'mode'} title={t('workMode')} message={t('modeConfirm')} busy={action.busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => void action.run(async () => { if (confirm?.kind === 'mode') queryClient.setQueryData(['me'], await courierApi.setWorkMode(confirm.mode)); setConfirm(null); await queryClient.invalidateQueries({ queryKey: ['offers'] }); }).then(() => setConfirm(null))} />
    </Screen>
  );
}

export function PersonalScreen() {
  const navigation = useNavigation<Nav>();
  const { t } = usePrefs();
  const queryClient = useQueryClient();
  const account = useAccount().data!;
  const { identity } = account.profile;
  const [first, setFirst] = useState(account.profile.firstName), [last, setLast] = useState(account.profile.lastName), [phone, setPhone] = useState(account.phone ?? '');
  const [series, setSeries] = useState(identity.passportSeries ?? ''), [number, setNumber] = useState(identity.passportNumber ?? '');
  const action = useAction();
  const passportTouched = Boolean(series || number);
  const valid = first.trim() && last.trim() && validPhone(phone) && (!passportTouched || validPassport(series, number));
  return (
    <Screen edges={['bottom']}>
      <Field label={t('firstName')} value={first} onChangeText={setFirst} maxLength={60} />
      <Field label={t('lastName')} value={last} onChangeText={setLast} maxLength={60} />
      <Field label={t('phone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" error={phone && !validPhone(phone) ? t('phoneInvalid') : undefined} />
      <Field label={t('email')} value={account.email ?? ''} editable={false} />
      <PassportFields series={series} number={number} onSeries={setSeries} onNumber={setNumber} editable={!identity.locked} />
      <FacePhotoField account={account} />
      {action.error ? <Banner tone="danger" text={action.error} /> : null}
      <Button title={t('save')} disabled={!valid} loading={action.busy} onPress={() => void action.run(async () => {
        const passport = !identity.locked && passportTouched ? { passportSeries: series, passportNumber: number } : {};
        queryClient.setQueryData(['me'], await courierApi.updateProfile({ firstName: first.trim(), lastName: last.trim(), phone: phone.trim(), ...passport }));
        navigation.goBack();
      })} />
    </Screen>
  );
}

export function AffiliationsScreen() {
  const { t } = usePrefs();
  const queryClient = useQueryClient();
  const affiliations = useQuery({ queryKey: ['affiliations'], queryFn: courierApi.affiliations });
  const [ending, setEnding] = useState<CourierAffiliationDto | null>(null);
  const action = useAction();
  return (
    <Screen edges={['bottom']} refreshing={affiliations.isFetching} onRefresh={() => void affiliations.refetch()}>
      <QueryState loading={affiliations.isPending} error={affiliations.error} onRetry={() => void affiliations.refetch()}>
        {!affiliations.data?.length ? <EmptyState icon="restaurant" text={t('affEmpty')} /> : null}
        {action.error ? <Banner tone="danger" text={action.error} /> : null}
        {affiliations.data?.map(item => (
          <Card key={item.id}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <AppText variant="heading" style={{ flex: 1 }}>{item.restaurant.name}</AppText>
              <Badge tone={item.status === 'ACTIVE' ? 'success' : 'neutral'} text={t(`aff${item.status}`)} />
            </View>
            <AppText muted>{item.restaurant.addressText}</AppText>
            <AppText variant="caption" muted>{dateTime(item.confirmedAt)}{item.endedAt ? ` → ${dateTime(item.endedAt)}` : ''}</AppText>
            {item.status === 'ACTIVE' ? <Button title={t('affEnd')} variant="danger" onPress={() => setEnding(item)} /> : null}
          </Card>
        ))}
      </QueryState>
      <AppText variant="heading">{t('affAdd')}</AppText>
      <InvitationPanel />
      <ConfirmDialog visible={Boolean(ending)} title={t('affEnd')} message={ending ? t('affEndConfirm', { name: ending.restaurant.name }) : undefined} destructive busy={action.busy}
        onCancel={() => setEnding(null)}
        onConfirm={() => void action.run(async () => {
          if (ending) await courierApi.endAffiliation(ending.id);
          await Promise.all(['affiliations', 'me', 'offers'].map(key => queryClient.invalidateQueries({ queryKey: [key] })));
        }).finally(() => setEnding(null))} />
    </Screen>
  );
}

export function ServiceAreaScreen() {
  const navigation = useNavigation<Nav>();
  const { t } = usePrefs();
  const queryClient = useQueryClient();
  const account = useAccount().data!;
  const [city, setCity] = useState<string | null>(account.profile.city);
  const action = useAction();
  return (
    <Screen edges={['bottom']} footer={
      <Button title={t('save')} disabled={!city || city === account.profile.city} loading={action.busy} onPress={() => void action.run(async () => {
        if (city) queryClient.setQueryData(['me'], await courierApi.setServiceArea(city));
        await queryClient.invalidateQueries({ queryKey: ['offers'] });
        navigation.goBack();
      })} />
    }>
      {action.error ? <Banner tone="danger" text={action.error} /> : null}
      <CityPicker value={city} onChange={setCity} />
    </Screen>
  );
}

/** Saved notifications; titles are localized from the stored event, with the server text as fallback. */
export function NotificationsScreen() {
  const navigation = useNavigation<Nav>();
  const { t, colors } = usePrefs();
  const queryClient = useQueryClient();
  const notices = useInfiniteQuery({
    queryKey: ['notifications'], initialPageParam: 1,
    queryFn: ({ pageParam }) => courierApi.notifications(pageParam),
    getNextPageParam: last => (last.hasMore ? last.page + 1 : undefined),
  });
  const action = useAction();
  const items = notices.data?.pages.flatMap(page => page.items) ?? [];
  const unread = notices.data?.pages[0]?.unread ?? 0;
  const title = (item: AppNotification) => {
    const event = typeof item.metadata?.event === 'string' ? item.metadata.event : '';
    return item.type === 'COURIER_DELIVERY' && (NOTICE_EVENTS as readonly string[]).includes(event) ? t(`n${event as typeof NOTICE_EVENTS[number]}`) : item.title;
  };
  const open = (item: AppNotification) => {
    void courierApi.readNotifications([item.id]).then(() => queryClient.invalidateQueries({ queryKey: ['notifications'] })).catch(() => {});
    const deliveryId = typeof item.metadata?.deliveryId === 'string' ? item.metadata.deliveryId : null;
    if (item.metadata?.event === 'OFFER_CREATED') navigation.navigate('Tabs', { screen: 'Offers' });
    else if (deliveryId) navigation.navigate('Delivery', { id: deliveryId });
  };
  return (
    <Screen edges={['bottom']} refreshing={notices.isRefetching} onRefresh={() => void notices.refetch()}>
      {unread ? <Button title={`${t('notifReadAll')} (${unread})`} icon="check" variant="secondary" loading={action.busy}
        onPress={() => void action.run(async () => { await courierApi.readNotifications(); await queryClient.invalidateQueries({ queryKey: ['notifications'] }); })} /> : null}
      <QueryState loading={notices.isPending} error={notices.isError && !notices.data ? notices.error : null} onRetry={() => void notices.refetch()}>
        {!items.length ? <EmptyState icon="notifications" text={t('notifEmpty')} /> : null}
        {items.map(item => (
          <Card key={item.id} onPress={() => open(item)} style={!item.readAt ? { borderColor: colors.accent } : undefined}>
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              <Icon name={item.readAt ? 'notifications' : 'alert'} color={item.readAt ? colors.muted : colors.accentText} size={18} />
              <AppText variant="label" style={{ flex: 1 }}>{title(item)}</AppText>
            </View>
            <AppText muted>{typeof item.metadata?.orderNumber === 'string' ? [item.metadata.restaurantName, t('nOrder', { number: item.metadata.orderNumber })].filter(Boolean).join(' · ') : item.body}</AppText>
            <AppText variant="caption" muted>{dateTime(item.createdAt)}</AppText>
          </Card>
        ))}
        {notices.hasNextPage ? <Button title={t('more')} variant="secondary" loading={notices.isFetchingNextPage} onPress={() => void notices.fetchNextPage()} /> : null}
      </QueryState>
      <Banner tone="info" text={t('pushNote')} />
    </Screen>
  );
}
