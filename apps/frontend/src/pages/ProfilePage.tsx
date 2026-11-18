import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '../context/AppContext';
import { api, friendlyError } from '../lib/api';
import { Icon } from '../components/icons/Icon';
import { AddressBook } from '../components/AddressBook';
import { ProfileEditor, type EditableProfile } from '../components/ProfileEditor';
import { ProfileFollowing, ProfileLikes } from '../components/ProfileCollections';
import { OrderHistory } from '../components/OrderHistory';
import { FormError, Modal, primaryClass, secondaryClass, useCopy } from '../components/AccountPrimitives';

interface Profile extends EditableProfile {
  id: string;
  avatarUrl: string | null;
  counts: { likes: number; follows: number; orders: number };
}

export function ProfilePage() {
  const { user, language, setLanguage, theme, setTheme, refreshUser } = useApp();
  const c = useCopy();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const avatarInput = useRef<HTMLInputElement>(null);
  const detailTitle = useRef<HTMLHeadingElement>(null);
  const [editing, setEditing] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const section = new URLSearchParams(location.search).get('section');
  const languages = { ru: 'Русский', uz: 'O‘zbekcha', en: 'English' };
  const light = c('Светлое', 'Yorug‘', 'Light');
  const dark = c('Тёмное', 'Tungi', 'Dark');
  const profile = useQuery({
    queryKey: ['profile'],
    queryFn: async ({ signal }) => (await api.get<{ data: Profile }>('/profile', { signal })).data.data,
    enabled: Boolean(user),
  });
  const person = profile.data ?? user;
  const entries = [
    { section: 'likes', icon: 'heart', label: c('Понравившиеся', 'Yoqtirilganlar', 'Liked posts'), value: profile.data?.counts.likes, screen: true },
    { section: 'follows', icon: 'restaurant', label: c('Подписки', 'Obunalar', 'Following'), value: profile.data?.counts.follows, screen: true },
    { section: 'orders', icon: 'history', label: c('История заказов', 'Buyurtmalar tarixi', 'Order history'), screen: true },
    { section: 'addresses', icon: 'location', label: c('Мои адреса', 'Manzillarim', 'My addresses') },
    { section: 'language', icon: 'globe', label: c('Язык', 'Til', 'Language'), value: languages[language], screen: true },
    { section: 'appearance', icon: theme === 'dark' ? 'moon' : 'sun', label: c('Оформление', 'Ko‘rinish', 'Appearance'), value: theme === 'dark' ? dark : light, screen: true },
  ];
  const detail = entries.find(entry => entry.section === section && entry.screen);

  useEffect(() => {
    window.scrollTo(0, 0);
    detailTitle.current?.focus({ preventScroll: true });
  }, [detail?.section]);

  const avatar = useMutation({
    mutationFn: (file: File) => {
      const data = new FormData();
      data.append('file', file);
      return api.post('/uploads/avatar', data);
    },
    onSuccess: async () => {
      await refreshUser();
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
  const logout = useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSuccess: async () => {
      queryClient.clear();
      await refreshUser();
      navigate('/auth', { replace: true });
    },
  });

  function backToProfile() {
    if (location.state?.fromProfileMenu === true) navigate(-1);
    else navigate('/profile', { replace: true });
  }

  if (!user) return <div className="mx-auto max-w-lg px-6 py-20 text-center">
    <h1 className="text-3xl font-semibold">{c('Ваш профиль', 'Profilingiz', 'Your profile')}</h1>
    <p className="my-5 text-sm text-[var(--muted)]">{c('Войдите, чтобы сохранять любимое и управлять заказами.', 'Sevimlilarni saqlash va buyurtmalarni boshqarish uchun kiring.', 'Sign in to save your favorites and manage your orders.')}</p>
    <Link className={primaryClass} to="/auth" state={{ from: '/profile' }}>{c('Войти', 'Kirish', 'Sign in')}</Link>
  </div>;

  if (detail) return <section className="profile-page" aria-labelledby="profile-detail-title">
    <header className="profile-detail-header">
      <button type="button" className="profile-back" onClick={backToProfile} aria-label={c('Вернуться в профиль', 'Profilga qaytish', 'Back to profile')}><Icon name="back" size={24}/></button>
      <h1 id="profile-detail-title" ref={detailTitle} tabIndex={-1}>{detail.label}</h1>
    </header>
    {section === 'likes' && <ProfileLikes/>}
    {section === 'follows' && <ProfileFollowing/>}
    {section === 'orders' && <OrderHistory/>}
    {section === 'language' && <div className="profile-options">
      {(['ru', 'uz', 'en'] as const).map(value => <button key={value} type="button" aria-pressed={language === value} onClick={() => setLanguage(value)}>
        <span>{languages[value]}</span>{language === value && <Icon name="check" size={21}/>}
      </button>)}
    </div>}
    {section === 'appearance' && <div className="profile-options">
      {([{ value: 'light', label: light, icon: 'sun' }, { value: 'dark', label: dark, icon: 'moon' }] as const).map(option => <button key={option.value} type="button" aria-pressed={theme === option.value} onClick={() => setTheme(option.value)}>
        <Icon name={option.icon} size={21}/><span>{option.label}</span>{theme === option.value && <Icon name="check" size={21}/>}
      </button>)}
    </div>}
  </section>;

  const fromMenu = { fromProfileMenu: true };
  return <div className="profile-page">
    <header className="profile-page-header"><h1>{c('Профиль', 'Profil', 'Profile')}</h1></header>
    <section className="profile-identity" aria-label={c('Аккаунт', 'Hisob', 'Account')}>
      <div className="profile-identity-top">
        <button type="button" className="profile-avatar" disabled={avatar.isPending} onClick={() => avatarInput.current?.click()} aria-label={c('Изменить фото', 'Rasmni o‘zgartirish', 'Change profile photo')}>
          {person?.avatarUrl ? <img src={person.avatarUrl} alt=""/> : person?.username?.slice(0, 1).toUpperCase()}
          <span><Icon name="camera" size={14}/></span>
        </button>
        <input ref={avatarInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={event => {
          const file = event.target.files?.[0];
          if (file) avatar.mutate(file);
          event.target.value = '';
        }}/>
        <button type="button" onClick={() => setEditing(true)} disabled={!profile.data} className={secondaryClass}><Icon name="edit" size={17}/>{c('Редактировать', 'Tahrirlash', 'Edit profile')}</button>
      </div>
      <h2>{person?.username}</h2>
      {person?.bio && <p className="profile-bio">{person.bio}</p>}
      {avatar.isPending && <p role="status" className="mt-3 text-xs text-[var(--muted)]">{c('Загружаем фото…', 'Rasm yuklanmoqda…', 'Uploading photo…')}</p>}
      <FormError message={avatar.error ? friendlyError(avatar.error) : ''}/>
    </section>
    {profile.isError && <div className="mb-5"><FormError message={friendlyError(profile.error)}/></div>}
    <nav className="profile-menu" aria-label={c('Разделы профиля', 'Profil bo‘limlari', 'Profile sections')}>
      {entries.map(entry => <Link key={entry.section} className="profile-menu-row" to={'/profile?section=' + entry.section} state={fromMenu}>
        <Icon name={entry.icon} size={21} className="profile-menu-icon"/>
        <span>{entry.label}</span><span className="profile-menu-value">{entry.value}</span>
        <Icon name="chevron" size={16} className="profile-menu-chevron"/>
      </Link>)}
      <a className="profile-menu-row" href="https://t.me/skillworkdiscussion" target="_blank" rel="noopener noreferrer">
        <Icon name="help" size={21} className="profile-menu-icon"/><span>{c('Поддержка', 'Yordam', 'Support')}</span>
        <Icon name="chevron" size={16} className="profile-menu-chevron"/>
      </a>
      <Link className="profile-menu-row" to="/profile?section=help" state={fromMenu}>
        <Icon name="shield" size={21} className="profile-menu-icon"/><span>{c('FAQ и документы', 'FAQ va hujjatlar', 'FAQ & documents')}</span>
        <Icon name="chevron" size={16} className="profile-menu-chevron"/>
      </Link>
      <button type="button" className="profile-menu-row profile-menu-row--logout" onClick={() => setLogoutOpen(true)}>
        <Icon name="logout" size={21}/><span>{c('Выйти', 'Chiqish', 'Sign out')}</span>
      </button>
    </nav>
    {editing && profile.data && <ProfileEditor profile={profile.data} onClose={() => setEditing(false)}/>}
    {section === 'addresses' && <AddressBook onClose={backToProfile}/>}
    {section === 'help' && <FaqDialog onClose={backToProfile}/>}
    {logoutOpen && <Modal title={c('Выйти из аккаунта?', 'Hisobdan chiqasizmi?', 'Sign out?')} onClose={() => setLogoutOpen(false)}>
      <p className="mb-6 text-sm text-[var(--muted)]">{c('Вы сможете войти снова с тем же email и паролем.', 'Shu email va parol bilan qayta kirishingiz mumkin.', 'You can sign back in with your email and password.')}</p>
      <FormError message={logout.error ? friendlyError(logout.error) : ''}/>
      <div className="mt-5 flex gap-3"><button type="button" className={`${primaryClass} flex-1`} disabled={logout.isPending} onClick={() => logout.mutate()}>{c('Выйти', 'Chiqish', 'Sign out')}</button><button type="button" className={secondaryClass} onClick={() => setLogoutOpen(false)}>{c('Остаться', 'Qolish', 'Stay here')}</button></div>
    </Modal>}
  </div>;
}

function FaqDialog({ onClose }: { onClose: () => void }) {
  const c = useCopy();
  const sections = [
    { title: c('Как оформить заказ?', 'Qanday buyurtma beraman?', 'How do I place an order?'), text: c('Добавьте блюда одного ресторана в корзину, выберите сохранённый адрес или отметьте точку на карте, укажите контакты и подтвердите заказ.', 'Bitta restoran taomlarini savatga qo‘shing, saqlangan manzilni yoki xaritadagi nuqtani tanlang, kontaktlarni kiriting va buyurtmani tasdiqlang.', 'Add dishes from one restaurant, choose a saved address or a map location, enter your contact details and confirm your order.') },
    { title: c('Почему заказ ожидает принятия?', 'Nega buyurtma qabul qilinishi kutilmoqda?', 'Why is my order awaiting acceptance?'), text: c('Это пользовательский этап UzBite. Заказ сохраняется в базе, а обработка рестораном будет подключена вместе с его рабочим кабинетом. Статусы не меняются по таймеру.', 'Bu UzBite’ning foydalanuvchi bosqichi. Buyurtma bazada saqlanadi, restoran ishlovi uning kabineti bilan birga ulanadi. Holatlar taymer bilan o‘zgarmaydi.', 'This is the customer stage of UzBite. Orders are saved to the database; restaurant processing will be connected with the restaurant workspace. Statuses do not change on a timer.') },
    { title: c('Кто может оставить отзыв?', 'Kim fikr qoldirishi mumkin?', 'Who can leave a review?'), text: c('Подтверждённый отзыв доступен владельцу доставленного заказа — один отзыв на заказ. Обычные комментарии не влияют на рейтинг.', 'Tasdiqlangan fikrni yetkazilgan buyurtma egasi qoldirishi mumkin — har buyurtmaga bitta. Oddiy izohlar reytingga ta’sir qilmaydi.', 'The owner of a delivered order can leave one verified review per order. Regular comments do not affect ratings.') },
    { title: c('Правила UzBite', 'UzBite qoidalari', 'UzBite rules'), text: c('Используйте свой аккаунт, указывайте верные контакты и адрес. Общайтесь уважительно, не публикуйте чужие личные данные. В одной корзине — блюда одного ресторана; одновременно доступен один активный заказ.', 'O‘z hisobingizdan foydalaning, to‘g‘ri kontakt va manzil kiriting. Hurmat bilan muloqot qiling, boshqalarning shaxsiy ma’lumotlarini joylamang. Bir savatda bitta restoran taomlari va bir vaqtda bitta faol buyurtma bo‘lishi mumkin.', 'Use your own account and accurate contact and address information. Be respectful and do not publish other people’s personal data. A bag contains dishes from one restaurant, and only one order can be active at a time.') },
    { title: c('Пользовательское соглашение — проект', 'Foydalanuvchi kelishuvi — loyiha', 'User agreement — draft'), text: c('Текущая версия предназначена для тестирования пользовательского сценария. Каталог содержит тестовые данные. Само сохранение заказа ещё не означает принятие рестораном или обещание доставки. Перед публичным запуском соглашение требует юридической проверки и утверждения.', 'Joriy versiya foydalanuvchi jarayonlarini sinash uchun. Katalogda test ma’lumotlari mavjud. Buyurtma saqlanishi restoran uni qabul qilganini yoki yetkazish kafolatini anglatmaydi. Ommaviy ishga tushirishdan oldin kelishuv huquqiy tekshiruv va tasdiqdan o‘tishi kerak.', 'This version is intended for testing customer workflows. The catalog contains test data. Saving an order does not mean a restaurant has accepted it or promised delivery. The agreement requires legal review and approval before public launch.') },
    { title: c('Конфиденциальность — проект', 'Maxfiylik — loyiha', 'Privacy policy — draft'), text: c('Приложение сохраняет данные аккаунта, адреса, заказы и социальные действия. Адреса и контакты доступны через защищённые API владельца. Чеки предназначены для приватного объектного хранилища. Итоговые сроки хранения, права пользователей и сведения об операторе должны быть утверждены до публичного запуска.', 'Ilova hisob, manzil, buyurtma va ijtimoiy harakatlarni saqlaydi. Manzil va kontaktlar egasining himoyalangan API’lari orqali ochiladi. Cheklar shaxsiy obyekt xotirasi uchun mo‘ljallangan. Saqlash muddatlari, foydalanuvchi huquqlari va operator ma’lumotlari ommaviy ishga tushirishgacha tasdiqlanishi kerak.', 'The app stores account data, addresses, orders and social activity. Addresses and contact details are accessed through owner-protected APIs. Receipts use private object storage. Retention periods, user rights and operator information must be approved before public launch.') },
  ];
  return <Modal title={c('FAQ и документы', 'FAQ va hujjatlar', 'FAQ & documents')} onClose={onClose}><div className="space-y-3">{sections.map((section) => <details key={section.title} className="rounded-2xl border border-[var(--border)] p-4"><summary className="cursor-pointer text-sm font-semibold">{section.title}</summary><p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">{section.text}</p></details>)}<p className="pt-2 text-[11px] leading-relaxed text-[var(--muted)]">{c('Юридические документы представлены как проекты и не утверждены для production.', 'Huquqiy hujjatlar loyiha holatida va production uchun tasdiqlanmagan.', 'Legal documents are drafts and have not been approved for production use.')}</p></div></Modal>;
}

export default ProfilePage;


