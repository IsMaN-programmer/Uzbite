import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { api, friendlyError } from '../lib/api';
import { useApp } from '../context/AppContext';
import { Icon } from '../components/icons/Icon';
import { Wordmark } from '../components/Wordmark';
import { Field, FormError, useCopy } from '../components/AccountPrimitives';

export function AuthPage() {
  const { language, theme, setLanguage, refreshUser } = useApp();
  const c = useCopy();
  const navigate = useNavigate();
  const location = useLocation();
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const auth = useMutation({
    mutationFn: () => api.post(register ? '/auth/register' : '/auth/login', register ? { email: email.trim(), password, language, theme } : { email: email.trim(), password }),
    onSuccess: async () => {
      await refreshUser();
      const state = location.state as { from?: string } | null;
      navigate(state?.from?.startsWith('/') ? state.from : '/feed', { replace: true });
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!auth.isPending) auth.mutate();
  }

  const roles = [
    { icon: 'user', label: c('Пользователь', 'Foydalanuvchi', 'Customer'), active: true },
    { icon: 'restaurant', label: c('Ресторан', 'Restoran', 'Restaurant'), active: false },
    { icon: 'bicycle', label: c('Курьер', 'Kuryer', 'Courier'), active: false },
  ];

  return <main className="auth-page">
    <header className="auth-topbar">
      <div className="auth-languages" role="group" aria-label={c('Язык интерфейса', 'Interfeys tili', 'Interface language')}>
        {(['ru', 'uz', 'en'] as const).map(value => <button key={value} type="button" onClick={() => setLanguage(value)} aria-pressed={language === value}>{value.toUpperCase()}</button>)}
      </div>
    </header>
    <div className="auth-layout">
      <section className="auth-intro" aria-labelledby="auth-welcome">
        <Wordmark withIcon className="auth-brand"/>
        <h1 id="auth-welcome">{c('Вкусное начинается здесь', 'Mazali lahzalar shu yerdan boshlanadi', 'Good food starts here')}</h1>
        <p>{c('Смотрите. Выбирайте. Заказывайте.', 'Tomosha qiling. Tanlang. Buyurtma bering.', 'Watch. Choose. Order.')}</p>
        <img className="auth-hero" src="/images/uzbite/plov-samsa.jpg" width="1000" height="401" alt={c('Узбекский плов с чесноком и золотистая самса', 'Sarimsoqli o‘zbek palovi va tillarang somsa', 'Uzbek plov with garlic and golden samsa')} fetchPriority="high"/>
      </section>

      <section className="auth-account" aria-labelledby="auth-title">
        <div className="auth-roles" role="group" aria-label={c('Тип аккаунта', 'Hisob turi', 'Account type')}>
          {roles.map(role => <button key={role.icon} type="button" disabled={!role.active} aria-pressed={role.active} className="auth-role">
            {!role.active && <span className="auth-role-soon">{c('Скоро', 'Tez kunda', 'Soon')}</span>}
            <Icon name={role.icon} size={28}/><span>{role.label}</span>
          </button>)}
        </div>
        <h2 id="auth-title">{register ? c('Создать аккаунт', 'Hisob yaratish', 'Create an account') : c('Вход в аккаунт', 'Hisobga kirish', 'Sign in to your account')}</h2>
        <form onSubmit={submit} className="auth-form">
          <Field label="Email"><input type="email" name="email" autoComplete="email" autoCapitalize="none" spellCheck={false} className="auth-input" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} placeholder="user@example.com" disabled={auth.isPending}/></Field>
          <Field label={c('Пароль', 'Parol', 'Password')}>
            <span className="auth-password"><input type={showPassword ? 'text' : 'password'} name="password" aria-label={c('Пароль', 'Parol', 'Password')} autoComplete={register ? 'new-password' : 'current-password'} className="auth-input" required minLength={register ? 8 : 1} maxLength={72} value={password} onChange={event => setPassword(event.target.value)} placeholder={register ? c('Не менее 8 символов', 'Kamida 8 ta belgi', 'At least 8 characters') : '••••••••'} disabled={auth.isPending}/>
              <button type="button" onClick={() => setShowPassword(value => !value)} aria-pressed={showPassword} aria-label={showPassword ? c('Скрыть пароль', 'Parolni yashirish', 'Hide password') : c('Показать пароль', 'Parolni ko‘rsatish', 'Show password')}><Icon name={showPassword ? 'eyeOff' : 'eye'} size={23}/></button>
            </span>
          </Field>
          {register && <p className="auth-password-hint">{c('Никнейм можно выбрать позже в настройках.', 'Taxallusni keyinroq sozlamalarda tanlashingiz mumkin.', 'You can choose a nickname later in settings.')}</p>}
          <FormError message={auth.error ? friendlyError(auth.error) : ''}/>
          <button className="food-primary auth-submit" type="submit" disabled={auth.isPending}>{auth.isPending ? c('Подождите…', 'Kuting…', 'Please wait…') : register ? c('Создать аккаунт', 'Hisob yaratish', 'Create account') : c('Войти', 'Kirish', 'Sign in')}</button>
        </form>
        <p className="auth-switch">{register ? c('Уже есть аккаунт?', 'Hisobingiz bormi?', 'Already have an account?') : c('Нет аккаунта?', 'Hisobingiz yo‘qmi?', 'No account yet?')} <button type="button" disabled={auth.isPending} onClick={() => { setRegister(value => !value); auth.reset(); setPassword(''); setShowPassword(false); }}>{register ? c('Войти', 'Kirish', 'Sign in') : c('Создать аккаунт', 'Hisob yaratish', 'Create an account')}</button></p>
        <footer className="auth-footer">UzBite · {c('Ташкент, Узбекистан', 'Toshkent, O‘zbekiston', 'Tashkent, Uzbekistan')}</footer>
      </section>
    </div>
  </main>;
}

export default AuthPage;
