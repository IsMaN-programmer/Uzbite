import { useCallback, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SERVICE_ZONES, type CourierAccount, type CourierAvailability, type CourierInvitationDto } from '@uzbite/shared';
import { courierApi } from '../api/courier';
import { usePrefs } from '../prefs';
import { useConnectivity } from '../realtime';
import { initials } from '../lib/format';
import { Icon } from '../ui/Icon';
import { AppText, Badge, Banner, Button, Card, Field } from '../ui/kit';

/** One action at a time: a second tap while the first request runs is ignored (no double submit). */
export function useAction() {
  const { errorText } = usePrefs();
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = useCallback(async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
    if (running.current) return undefined;
    running.current = true; setBusy(true); setError('');
    try { return await work(); }
    catch (failure) { setError(errorText(failure)); return undefined; }
    finally { running.current = false; setBusy(false); }
  }, [errorText]);
  return { busy, error, setError, run };
}

export function Avatar({ first, last, size = 52 }: { first: string; last: string; size?: number }) {
  const { colors } = usePrefs();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
      <Text maxFontSizeMultiplier={1.3} style={{ color: colors.onAccent, fontWeight: '800', fontSize: size * 0.36 }}>{initials(first, last)}</Text>
    </View>
  );
}

export function StatusPill({ availability }: { availability: CourierAvailability }) {
  const { t } = usePrefs();
  const { online } = useConnectivity();
  if (!online) return <Badge tone="danger" text={t('statusOFFLINE')} />;
  return <Badge tone={availability === 'AVAILABLE' ? 'success' : availability === 'BUSY' ? 'accent' : 'neutral'} text={t(`status${availability}`)} />;
}

/** No internet, or the live connection is down (then data is polled and refreshed on reconnect). */
export function ConnectionBanner() {
  const { t } = usePrefs();
  const { online, realtime } = useConnectivity();
  if (!online) return <Banner tone="danger" icon="wifiOff" text={t('offline')} />;
  if (!realtime) return <Banner tone="warning" icon="refresh" text={t('realtimeDown')} />;
  return null;
}

export function PermissionNotice({ account }: { account: CourierAccount }) {
  const { t } = usePrefs();
  const { permissions, workMode } = account.profile;
  if (permissions.reason === 'SUSPENDED') return <Banner tone="danger" icon="shield" text={t('permSUSPENDED')} />;
  if (permissions.reason) return <Banner tone="warning" icon="shield" text={t('permNO_AFFILIATION_OR_APPROVAL')} />;
  if (workMode === 'RESTAURANT' && !permissions.restaurantMode) return <Banner tone="warning" text={t('permRestaurant')} />;
  if (workMode === 'FREELANCE' && !permissions.freelanceMode) return <Banner tone="warning" text={t('permFreelance')} />;
  return null;
}

/** Restaurant invitation: enter the code, see which restaurant it is, then accept or decline. */
export function InvitationPanel() {
  const { t, colors } = usePrefs();
  const queryClient = useQueryClient();
  const invitations = useQuery({ queryKey: ['invitations'], queryFn: courierApi.invitations });
  const [code, setCode] = useState('');
  const claim = useAction(), respond = useAction();
  const pending = (invitations.data ?? []).filter(item => item.status === 'PENDING');
  const refresh = async () => { await Promise.all(['me', 'invitations', 'affiliations'].map(key => queryClient.invalidateQueries({ queryKey: [key] }))); };
  const answer = (invitation: CourierInvitationDto, accept: boolean) => respond.run(async () => {
    if (accept) await courierApi.acceptInvitation(invitation.id); else await courierApi.rejectInvitation(invitation.id);
    await refresh();
  });
  return (
    <View style={{ gap: 12 }}>
      <Field label={t('inviteTitle')} hint={t('inviteHint')} value={code} onChangeText={value => setCode(value.toUpperCase())} autoCapitalize="characters" autoCorrect={false} maxLength={12} placeholder="XXXX-XXXX" />
      {claim.error ? <Banner tone="danger" text={claim.error} /> : null}
      <Button title={t('inviteClaim')} icon="key" variant="secondary" loading={claim.busy} disabled={code.replace(/[\s-]/g, '').length !== 8}
        onPress={() => void claim.run(async () => { await courierApi.claimInvitation(code); setCode(''); await refresh(); })} />
      {pending.map(invitation => (
        <Card key={invitation.id}>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <Icon name="restaurant" color={colors.accentText} />
            <AppText variant="heading" style={{ flex: 1 }}>{t('inviteFrom', { name: invitation.restaurant.name })}</AppText>
          </View>
          <AppText muted>{invitation.restaurant.addressText}</AppText>
          {respond.error ? <Banner tone="danger" text={respond.error} /> : null}
          <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
            <Button title={t('inviteReject')} variant="secondary" disabled={respond.busy} onPress={() => void answer(invitation, false)} style={{ flex: 1 }} />
            <Button title={t('inviteAccept')} loading={respond.busy} onPress={() => void answer(invitation, true)} style={{ flex: 1 }} />
          </View>
        </Card>
      ))}
    </View>
  );
}

/** City (only Tashkent today) and district from the shared contract. Matching never uses GPS. */
export function ZonePicker({ value, onChange }: { value: string | null; onChange: (zone: string) => void }) {
  const { t, colors, language } = usePrefs();
  return (
    <View style={{ gap: 8 }}>
      <AppText variant="label" muted>{t('areaCity')}</AppText>
      <Badge tone="accent" text={language === 'ru' ? 'Ташкент' : language === 'uz' ? 'Toshkent' : 'Tashkent'} />
      <AppText variant="label" muted>{t('areaZone')}</AppText>
      {SERVICE_ZONES.map(zone => {
        const active = zone.code === value;
        return (
          <Pressable key={zone.code} accessibilityRole="radio" accessibilityState={{ checked: active }} onPress={() => onChange(zone.code)}
            style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, borderColor: active ? colors.accent : colors.border, backgroundColor: active ? colors.accentSoft : colors.surface }}>
            <Icon name={active ? 'check' : 'location'} color={active ? colors.accentText : colors.muted} size={18} />
            <AppText style={{ flex: 1 }}>{zone.name[language]}</AppText>
          </Pressable>
        );
      })}
      <AppText variant="caption" muted>{t('areaHint')}</AppText>
    </View>
  );
}
