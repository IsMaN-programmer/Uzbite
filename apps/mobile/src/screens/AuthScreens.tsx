import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import axios from 'axios';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { Language } from '@uzbite/shared';
import { allowCustomServer, isValidServerUrl, normalizeServerUrl, saveServerOverride, serverConfig } from '../config';
import { AppError, asAppError } from '../api/client';
import { usePrefs } from '../prefs';
import { useSession } from '../session';
import { AppText, Banner, Button, Field, Screen } from '../ui/kit';
import type { RootStackParams } from '../navigation';

type Nav = NativeStackNavigationProp<RootStackParams>;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const validPhone = (value: string) => /^\+?[0-9\s()-]{7,22}$/.test(value.trim()) && (() => { const digits = value.replace(/\D/g, '').length; return digits >= 7 && digits <= 15; })();

export function Wordmark() {
  const { colors } = usePrefs();
  return <Text accessibilityRole="header" maxFontSizeMultiplier={1.4} style={{ fontSize: 34, fontWeight: '800', letterSpacing: -1.4, color: colors.text }}>Uz<Text style={{ color: colors.accent }}>Bite</Text></Text>;
}
export function LanguageSwitch() {
  const { language, setLanguage, colors } = usePrefs();
  return (
    <View style={{ flexDirection: 'row', gap: 6, alignSelf: 'flex-end' }}>
      {(['ru', 'uz', 'en'] as Language[]).map(item => (
        <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: item === language }} onPress={() => setLanguage(item)} hitSlop={6}
          style={{ minWidth: 44, minHeight: 36, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', borderColor: item === language ? colors.accent : colors.border, backgroundColor: item === language ? colors.accentSoft : colors.surface }}>
          <Text maxFontSizeMultiplier={1.4} style={{ fontWeight: '700', color: item === language ? colors.accentText : colors.muted }}>{item.toUpperCase()}</Text>
        </Pressable>
      ))}
    </View>
  );
}
function ServerLink() {
  const navigation = useNavigation<Nav>();
  const { t } = usePrefs();
  if (!allowCustomServer) return null;
  return <Button variant="ghost" icon="settings" title={t('serverLink', { url: serverConfig().apiUrl })} onPress={() => navigation.navigate('Server')} />;
}

export function LoginScreen() {
  const navigation = useNavigation<Nav>();
  const { t, errorText } = usePrefs();
  const session = useSession();
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const submit = async () => {
    if (busy) return;
    if (!emailPattern.test(email.trim()) || !password) { setError(t(emailPattern.test(email.trim()) ? 'required' : 'emailInvalid')); return; }
    setBusy(true); setError('');
    try { await session.signIn(email, password); } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); }
  };
  return (
    <Screen edges={['top', 'bottom']}>
      <LanguageSwitch />
      <View style={{ gap: 6, marginTop: 24 }}>
        <Wordmark />
        <AppText variant="title">{t('loginTitle')}</AppText>
        <AppText muted>{t('loginSubtitle')}</AppText>
      </View>
      {session.expired ? <Banner tone="warning" text={t('sessionExpired')} action={t('close')} onAction={session.dismissExpired} /> : null}
      <Field label={t('email')} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
      <Field label={t('password')} value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" textContentType="password" onSubmitEditing={() => void submit()} />
      {error ? <Banner tone="danger" text={error} /> : null}
      <Button title={t('loginSubmit')} onPress={() => void submit()} loading={busy} />
      <Button title={t('toRegister')} variant="ghost" onPress={() => navigation.navigate('Register')} />
      <ServerLink />
    </Screen>
  );
}

type RegisterForm = { firstName: string; lastName: string; email: string; phone: string; password: string; passwordConfirmation: string };
export function RegisterScreen() {
  const navigation = useNavigation<Nav>();
  const { t, errorText } = usePrefs();
  const session = useSession();
  const [form, setForm] = useState<RegisterForm>({ firstName: '', lastName: '', email: '', phone: '+998 ', password: '', passwordConfirmation: '' });
  const [errors, setErrors] = useState<Partial<Record<keyof RegisterForm, string>>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const set = (key: keyof RegisterForm) => (value: string) => setForm(previous => ({ ...previous, [key]: value }));
  const validate = () => {
    const next: Partial<Record<keyof RegisterForm, string>> = {};
    if (!form.firstName.trim()) next.firstName = t('required');
    if (!form.lastName.trim()) next.lastName = t('required');
    if (!emailPattern.test(form.email.trim())) next.email = t('emailInvalid');
    if (!validPhone(form.phone)) next.phone = t('phoneInvalid');
    if (form.password.length < 8) next.password = t('passwordShort');
    if (form.password !== form.passwordConfirmation) next.passwordConfirmation = t('passwordMismatch');
    setErrors(next);
    return Object.keys(next).length === 0;
  };
  const submit = async () => {
    if (busy || !validate()) return;
    setBusy(true); setError('');
    try { await session.register({ ...form, firstName: form.firstName.trim(), lastName: form.lastName.trim(), email: form.email.trim(), phone: form.phone.trim() }); }
    catch (failure) {
      const fields = asAppError(failure).fields;
      if (fields) setErrors(Object.fromEntries(Object.keys(fields).map(key => [key, t('errVALIDATION')])));
      setError(errorText(failure));
    } finally { setBusy(false); }
  };
  return (
    <Screen edges={['bottom']}>
      <LanguageSwitch />
      <AppText variant="title">{t('registerTitle')}</AppText>
      <Field label={t('firstName')} value={form.firstName} onChangeText={set('firstName')} error={errors.firstName} autoComplete="given-name" maxLength={60} />
      <Field label={t('lastName')} value={form.lastName} onChangeText={set('lastName')} error={errors.lastName} autoComplete="family-name" maxLength={60} />
      <Field label={t('email')} value={form.email} onChangeText={set('email')} error={errors.email} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      <Field label={t('phone')} value={form.phone} onChangeText={set('phone')} error={errors.phone} keyboardType="phone-pad" autoComplete="tel" />
      <Field label={t('password')} value={form.password} onChangeText={set('password')} error={errors.password} secureTextEntry autoComplete="new-password" maxLength={72} />
      <Field label={t('passwordConfirmation')} value={form.passwordConfirmation} onChangeText={set('passwordConfirmation')} error={errors.passwordConfirmation} secureTextEntry maxLength={72} />
      {error ? <Banner tone="danger" text={error} /> : null}
      <Button title={t('registerSubmit')} onPress={() => void submit()} loading={busy} />
      <Button title={t('toLogin')} variant="ghost" onPress={() => navigation.goBack()} />
    </Screen>
  );
}

/** Development only: which computer on the Wi-Fi runs the API. */
export function ServerSettings({ onSaved }: { onSaved?: () => void }) {
  const { t, errorText } = usePrefs();
  const [url, setUrl] = useState(serverConfig().apiUrl);
  const [status, setStatus] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const check = async () => {
    if (!isValidServerUrl(url)) { setStatus({ tone: 'danger', text: t('serverInvalid') }); return false; }
    setBusy(true);
    try { await axios.get(`${normalizeServerUrl(url)}/api/health`, { timeout: 6000 }); setStatus({ tone: 'success', text: t('serverOk') }); return true; }
    catch (error) { setStatus({ tone: 'danger', text: errorText(axios.isAxiosError(error) && !error.response ? new AppError('NETWORK', '') : error) }); return false; }
    finally { setBusy(false); }
  };
  if (!allowCustomServer) return null;
  return (
    <View style={{ gap: 12 }}>
      <AppText muted>{t('serverHint')}</AppText>
      <Field label={t('serverTitle')} value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
      {status ? <Banner tone={status.tone} text={status.text} /> : null}
      <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
        <Button title={t('serverCheck')} variant="secondary" loading={busy} onPress={() => void check()} style={{ flex: 1 }} />
        <Button title={t('save')} onPress={() => void (async () => { if (await check()) { await saveServerOverride(url); onSaved?.(); } })()} style={{ flex: 1 }} />
      </View>
      <Button title={t('serverReset')} variant="ghost" onPress={() => void (async () => { await saveServerOverride(null); setUrl(serverConfig().apiUrl); setStatus(null); onSaved?.(); })()} />
    </View>
  );
}
export function ServerScreen() {
  const navigation = useNavigation<Nav>();
  const session = useSession();
  return <Screen edges={['bottom']}><ServerSettings onSaved={() => { if (navigation.canGoBack()) navigation.goBack(); session.restart(); }} /></Screen>;
}

/** The server could not be asked at start-up: say so, offer a retry — never an endless spinner. */
export function StartupProblem() {
  const { t, errorText } = usePrefs();
  const session = useSession();
  const notConfigured = session.startupError instanceof Error && session.startupError.message === 'SERVER_NOT_CONFIGURED';
  return (
    <Screen edges={['top', 'bottom']}>
      <Wordmark />
      <AppText variant="heading">{t('startupError')}</AppText>
      <Banner tone="danger" text={notConfigured ? t('serverDown') : errorText(session.startupError)} icon="wifiOff" />
      <Button title={t('retry')} icon="refresh" onPress={session.restart} />
      <ServerSettings onSaved={session.restart} />
    </Screen>
  );
}
