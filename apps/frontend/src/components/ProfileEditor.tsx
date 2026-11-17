import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, friendlyError } from '../lib/api';
import { useApp } from '../context/AppContext';
import { Field, FormError, inputClass, Modal, primaryClass, useCopy } from './AccountPrimitives';

export interface EditableProfile { name: string; email: string | null; username: string; nickname?: string; bio: string; phone?: string | null; usernameChangedAt?: string | null }
export function ProfileEditor({ profile, onClose }: { profile: EditableProfile; onClose: () => void }) {
  const c = useCopy();
  const { refreshUser } = useApp();
  const queryClient = useQueryClient();
  const [nickname, setNickname] = useState(profile.nickname || profile.username);
  const [bio, setBio] = useState(profile.bio || '');
  const [email, setEmail] = useState(profile.email || '');
  const [phone, setPhone] = useState(profile.phone || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const nicknameLocked = Boolean(profile.usernameChangedAt && Date.now() - new Date(profile.usernameChangedAt).getTime() < 30 * 86400000);
  const save = useMutation({ mutationFn: () => api.patch('/profile', { nickname, bio, ...(email.trim()?{email:email.trim()}:{}), phone: phone.trim() || null, ...(currentPassword ? { currentPassword } : {}), ...(newPassword ? { newPassword } : {}) }), onSuccess: async () => { await refreshUser(); await queryClient.invalidateQueries({ queryKey: ['profile'] }); onClose(); } });
  function submit(event: FormEvent) { event.preventDefault(); save.mutate(); }
  return <Modal title={c('Настроим ваш профиль', 'Profilingizni sozlaymiz', 'Make it your profile')} onClose={onClose}><form onSubmit={submit} className="space-y-4"><Field label={c('Никнейм', 'Taxallus', 'Username')}><input className={inputClass} autoComplete="username" required minLength={3} maxLength={30} pattern="[a-zA-Z0-9_]+" disabled={nicknameLocked} value={nickname} onChange={(event) => setNickname(event.target.value)} /><span className="text-xs font-normal text-[var(--muted)]">{nicknameLocked ? c('Никнейм уже изменён. Следующее изменение доступно через 30 дней после предыдущего.', 'Taxallus o‘zgartirilgan. Keyingi o‘zgarish avvalgisidan 30 kun o‘tgach mumkin.', 'Your username was changed recently. You can change it again 30 days after the last change.') : c('Никнейм можно менять один раз в 30 дней.', 'Taxallusni har 30 kunda bir marta o‘zgartirish mumkin.', 'You can change your username once every 30 days.')}</span></Field><Field label={c('О себе', 'O‘zim haqimda', 'About you')}><textarea className={`${inputClass} min-h-20`} maxLength={300} value={bio} onChange={(event) => setBio(event.target.value)} /></Field><Field label="Email"><input className={inputClass} type="email" autoComplete="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></Field><Field label={c('Телефон', 'Telefon', 'Phone')}><input className={inputClass} type="tel" autoComplete="tel" pattern="\+?[0-9 ()-]{7,22}" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+998 90 123 45 67" /></Field><div className="space-y-4 border-t border-[var(--border)] pt-4"><Field label={c('Текущий пароль', 'Joriy parol', 'Current password')}><input className={inputClass} type="password" autoComplete="current-password" required={email !== (profile.email || '') || Boolean(newPassword)} maxLength={72} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /><span className="text-xs font-normal text-[var(--muted)]">{c('Нужен для изменения email или пароля.', 'Email yoki parolni o‘zgartirish uchun kerak.', 'Required to change your email or password.')}</span></Field><Field label={c('Новый пароль', 'Yangi parol', 'New password')}><input className={inputClass} type="password" autoComplete="new-password" minLength={8} maxLength={72} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder={c('Оставьте пустым, чтобы не менять', 'O‘zgartirmaslik uchun bo‘sh qoldiring', 'Leave blank to keep your password')} /></Field></div><FormError message={save.error ? friendlyError(save.error) : ''} /><button className={`${primaryClass} w-full`} disabled={save.isPending}>{save.isPending ? c('Сохраняем…', 'Saqlanmoqda…', 'Saving…') : c('Сохранить изменения', 'O‘zgarishlarni saqlash', 'Save changes')}</button></form></Modal>;
}

