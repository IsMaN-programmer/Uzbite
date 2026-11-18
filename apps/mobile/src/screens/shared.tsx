import { useCallback, useMemo, useRef, useState } from 'react';
import { Image, Platform, Pressable, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PASSPORT_NUMBER_PATTERN, PASSPORT_SERIES_PATTERN, SERVICE_CITIES, type CourierAccount, type CourierAvailability, type CourierInvitationDto } from '@uzbite/shared';
import { courierApi, type PhotoInput } from '../api/courier';
import { usePrefs } from '../prefs';
import { useConnectivity } from '../realtime';
import { initials, passportNumberInput, passportSeriesInput } from '../lib/format';
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
  const { permissions } = account.profile;
  // Only a blocked account is announced. A missing restaurant link or UzBite approval shows no warning.
  return permissions.reason === 'SUSPENDED' ? <Banner tone="danger" icon="shield" text={t('permSUSPENDED')} /> : null;
}

/**
 * Restaurant invitation: enter the code, see which restaurant it is, then accept or decline.
 * `onAccepted` runs after an acceptance (the profile then switches to own-restaurant mode).
 */
export function InvitationPanel({ onAccepted }: { onAccepted?: () => Promise<void> } = {}) {
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
    if (accept && onAccepted) await onAccepted();
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

/** City of Uzbekistan for free deliveries. Matching is by city, never by GPS. Tashkent first. */
export function CityPicker({ value, onChange }: { value: string | null; onChange: (city: string) => void }) {
  const { t, colors, language } = usePrefs();
  const cities = useMemo(() => {
    const [capital, ...rest] = SERVICE_CITIES;
    return [capital, ...[...rest].sort((a, b) => a.name[language].localeCompare(b.name[language], language))];
  }, [language]);
  return (
    <View style={{ gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel={t('areaCity')}>
      <AppText variant="label" muted>{t('areaCity')}</AppText>
      {cities.map(city => {
        const active = city.code === value;
        return (
          <Pressable key={city.code} accessibilityRole="radio" accessibilityState={{ checked: active }} onPress={() => onChange(city.code)}
            style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, borderColor: active ? colors.accent : colors.border, backgroundColor: active ? colors.accentSoft : colors.surface }}>
            <Icon name={active ? 'check' : 'location'} color={active ? colors.accentText : colors.muted} size={18} />
            <AppText style={{ flex: 1 }}>{city.name[language]}</AppText>
          </Pressable>
        );
      })}
      <AppText variant="caption" muted>{t('areaHint')}</AppText>
    </View>
  );
}

export const validPassport = (series: string, number: string) => PASSPORT_SERIES_PATTERN.test(series) && PASSPORT_NUMBER_PATTERN.test(number);
/**
 * Passport series (2 letters, Cyrillic look-alikes converted) and number (7 digits) side by side.
 * No maxLength: the input filters cut the length, so a pasted "AA 1234567" keeps every digit.
 */
export function PassportFields({ series, number, onSeries, onNumber, editable = true }: { series: string; number: string; onSeries: (value: string) => void; onNumber: (value: string) => void; editable?: boolean }) {
  const { t } = usePrefs();
  const seriesError = series && !PASSPORT_SERIES_PATTERN.test(series) ? t('passportSeriesInvalid') : undefined;
  const numberError = number && !PASSPORT_NUMBER_PATTERN.test(number) ? t('passportNumberInvalid') : undefined;
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
        <View style={{ width: 104 }}>
          <Field label={t('passportSeries')} value={series} onChangeText={value => onSeries(passportSeriesInput(value))} editable={editable} error={seriesError}
            autoCapitalize="characters" autoCorrect={false} placeholder="AA" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label={t('passportNumber')} value={number} onChangeText={value => onNumber(passportNumberInput(value))} editable={editable} error={numberError}
            keyboardType="number-pad" autoCorrect={false} placeholder="1234567" />
        </View>
      </View>
      <AppText variant="caption" muted>{t('passportHint')}</AppText>
    </View>
  );
}

/**
 * Selfie for UzBite admission: front camera (a file picker in the browser) or the gallery.
 * Uploaded at once; the server keeps it private and the account says whether one is stored.
 */
export function FacePhotoField({ account }: { account: CourierAccount }) {
  const { t, colors } = usePrefs();
  const queryClient = useQueryClient();
  const { facePhoto, locked } = account.profile.identity;
  const [preview, setPreview] = useState<string | null>(null);
  const action = useAction();
  const send = (asset: ImagePicker.ImagePickerAsset) => action.run(async () => {
    const photo: PhotoInput = { uri: asset.uri, file: asset.file, fileName: asset.fileName, mimeType: asset.mimeType };
    queryClient.setQueryData(['me'], await courierApi.uploadFacePhoto(photo));
    setPreview(asset.uri);
  });
  const pick = async (source: 'camera' | 'gallery') => {
    action.setError('');
    try {
      if (source === 'camera' && Platform.OS !== 'web') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) { action.setError(t('cameraDenied')); return; }
      }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6, exif: false, allowsEditing: false };
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ ...options, cameraType: ImagePicker.CameraType.front })
        : await ImagePicker.launchImageLibraryAsync(options);
      const asset = result.canceled ? null : result.assets[0];
      if (asset) await send(asset);
    } catch { action.setError(t('cameraDenied')); }
  };
  return (
    <View style={{ gap: 10 }}>
      <AppText variant="label">{t('facePhoto')}</AppText>
      <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
        <View accessibilityLabel={facePhoto ? t('facePhotoReady') : t('facePhoto')}
          style={{ width: 96, height: 120, borderRadius: 16, overflow: 'hidden', borderWidth: 1.5, borderStyle: facePhoto ? 'solid' : 'dashed', borderColor: facePhoto ? colors.success : colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}>
          {preview ? <Image source={{ uri: preview }} style={{ width: '100%', height: '100%' }} resizeMode="cover" accessibilityIgnoresInvertColors />
            : <Icon name={facePhoto ? 'check' : 'user'} color={facePhoto ? colors.success : colors.muted} size={36} />}
        </View>
        <View style={{ flex: 1, gap: 6 }}>
          {facePhoto ? <Badge tone="success" text={t('facePhotoReady')} /> : null}
          <AppText variant="caption" muted>{locked ? t('identityLocked') : action.busy ? t('facePhotoUploading') : t('facePhotoHint')}</AppText>
        </View>
      </View>
      {action.error ? <Banner tone="danger" text={action.error} /> : null}
      {!locked ? <>
        <Button title={facePhoto ? t('facePhotoRetake') : t('facePhotoTake')} icon="camera" variant={facePhoto ? 'secondary' : 'primary'} loading={action.busy} onPress={() => void pick('camera')} />
        <Button title={t('facePhotoGallery')} icon="image" variant="ghost" disabled={action.busy} onPress={() => void pick('gallery')} />
      </> : null}
    </View>
  );
}
