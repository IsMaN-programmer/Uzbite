import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CourierAccount, CourierWorkMode } from '@uzbite/shared';
import { courierApi } from '../api/courier';
import { usePrefs } from '../prefs';
import { useSession } from '../session';
import { useAccount } from '../hooks';
import { Icon } from '../ui/Icon';
import { AppText, Badge, Banner, Button, Field, Screen } from '../ui/kit';
import { CityPicker, FacePhotoField, InvitationPanel, PassportFields, PermissionNotice, useAction, validPassport } from './shared';
import { LanguageSwitch } from './AuthScreens';

/**
 * Four steps, progress stored on the server: name, passport and face photo → work mode →
 * restaurant code or city → finish. Phone and email were given at registration.
 */
export function OnboardingScreen() {
  const { t, colors } = usePrefs();
  const session = useSession();
  const queryClient = useQueryClient();
  const account = useAccount().data!;
  const profile = account.profile;
  const [step, setStep] = useState(Math.min(Math.max(profile.onboardingStep, 1), 4));
  const action = useAction();
  const { identity } = profile;
  const [first, setFirst] = useState(profile.firstName), [last, setLast] = useState(profile.lastName);
  const [series, setSeries] = useState(identity.passportSeries ?? ''), [number, setNumber] = useState(identity.passportNumber ?? '');
  const [city, setCity] = useState<string | null>(profile.city);
  const personalReady = Boolean(first.trim() && last.trim() && validPassport(series, number) && identity.facePhoto);
  const affiliations = useQuery({ queryKey: ['affiliations'], queryFn: courierApi.affiliations, enabled: step === 3 && profile.workMode === 'RESTAURANT' });
  const store = (next: CourierAccount) => queryClient.setQueryData(['me'], next);
  const go = (next: number) => action.run(async () => { store(await courierApi.onboarding({ step: next })); setStep(next); });

  const steps = [t('onbPersonal'), t('onbMode'), t('onbSetup'), t('onbDone')];
  return (
    <Screen edges={['top', 'bottom']} footer={
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {step > 1 ? <Button title={t('back')} variant="secondary" disabled={action.busy} onPress={() => void go(step - 1)} style={{ flex: 1 }} /> : null}
        {step === 1 ? <Button title={t('next')} loading={action.busy} style={{ flex: 2 }} disabled={!personalReady}
          onPress={() => void action.run(async () => {
            await courierApi.updateProfile({ firstName: first.trim(), lastName: last.trim(), ...(identity.locked ? {} : { passportSeries: series, passportNumber: number }) });
            store(await courierApi.onboarding({ step: 2 })); setStep(2);
          })} /> : null}
        {step === 3 ? <Button title={t('next')} loading={action.busy} style={{ flex: 2 }}
          disabled={profile.workMode === 'RESTAURANT' ? account.activeAffiliations === 0 : !city}
          onPress={() => void action.run(async () => { if (profile.workMode === 'FREELANCE' && city && city !== profile.city) await courierApi.setServiceArea(city); store(await courierApi.onboarding({ step: 4 })); setStep(4); })} /> : null}
        {step === 4 ? <Button title={t('onbFinish')} loading={action.busy} style={{ flex: 2 }} onPress={() => void action.run(async () => store(await courierApi.onboarding({ complete: true })))} /> : null}
      </View>
    }>
      <LanguageSwitch />
      <AppText variant="title">{t('onbTitle')}</AppText>
      <View style={{ flexDirection: 'row', gap: 6 }} accessibilityLabel={t('onbStep', { n: step })}>
        {steps.map((_, index) => <View key={index} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: index < step ? colors.accent : colors.border }} />)}
      </View>
      <AppText variant="label" muted>{t('onbStep', { n: step })} · {steps[step - 1]}</AppText>
      {action.error ? <Banner tone="danger" text={action.error} /> : null}

      {step === 1 ? <>
        <AppText muted>{t('onbPersonalText')}</AppText>
        <Field label={t('firstName')} value={first} onChangeText={setFirst} autoComplete="given-name" maxLength={60} />
        <Field label={t('lastName')} value={last} onChangeText={setLast} autoComplete="family-name" maxLength={60} />
        <PassportFields series={series} number={number} onSeries={setSeries} onNumber={setNumber} editable={!identity.locked} />
        <FacePhotoField account={account} />
      </> : null}

      {step === 2 ? (['RESTAURANT', 'FREELANCE'] as CourierWorkMode[]).map(mode => {
        const active = profile.workMode === mode;
        return (
          <Pressable key={mode} accessibilityRole="radio" accessibilityState={{ checked: active, busy: action.busy }} disabled={action.busy}
            onPress={() => void action.run(async () => { await courierApi.setWorkMode(mode); store(await courierApi.onboarding({ step: 3 })); setStep(3); })}
            style={{ borderRadius: 20, borderWidth: 1.5, padding: 18, gap: 8, borderColor: active ? colors.accent : colors.border, backgroundColor: active ? colors.accentSoft : colors.surface }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Icon name={mode === 'RESTAURANT' ? 'restaurant' : 'bicycle'} color={colors.accentText} size={26} />
              <AppText variant="heading" style={{ flex: 1 }}>{t(`mode${mode}`)}</AppText>
              {active ? <Icon name="check" color={colors.accentText} /> : null}
            </View>
            <AppText muted>{t(`mode${mode}Text`)}</AppText>
          </Pressable>
        );
      }) : null}

      {step === 3 && profile.workMode === 'RESTAURANT' ? <>
        <InvitationPanel />
        {(affiliations.data ?? []).filter(item => item.status === 'ACTIVE').map(item => <Banner key={item.id} tone="success" text={t('inviteLinked', { name: item.restaurant.name })} />)}
      </> : null}
      {step === 3 && profile.workMode === 'FREELANCE' ? <>
        {profile.approvalStatus === 'APPROVED' ? <Badge tone="success" text={t('approvalAPPROVED')} /> : null}
        <CityPicker value={city} onChange={setCity} />
      </> : null}

      {step === 4 ? <>
        <AppText>{t('onbDoneText')}</AppText>
        <AppText variant="label">{t('workMode')}: {profile.workMode ? t(`mode${profile.workMode}`) : '—'}</AppText>
        <PermissionNotice account={account} />
      </> : null}

      <Button title={t('logout')} variant="ghost" icon="logout" onPress={() => void session.signOut()} />
    </Screen>
  );
}
