import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, friendlyError } from '../lib/api';
import { invalidateDeliveryContext } from '../lib/delivery';
import { Icon } from './icons/Icon';
import { Field, FormError, inputClass, Modal, primaryClass, secondaryClass, useCopy } from './AccountPrimitives';
import { YandexLocationPicker, type LocationPoint } from './YandexLocationPicker';
import type { SavedAddress } from './AccountTypes';

export function AddressEditor({ address, onClose, onSaved }: { address?: SavedAddress; onClose: () => void; onSaved: (address: SavedAddress) => void }) {
  const c = useCopy();
  const queryClient = useQueryClient();
  const [mapOpen, setMapOpen] = useState(true);
  const [point, setPoint] = useState<LocationPoint | undefined>(address ? { latitude: Number(address.latitude), longitude: Number(address.longitude) } : undefined);
  const [label, setLabel] = useState(address?.label || '');
  const [addressText, setAddressText] = useState(address?.addressText || '');
  const [entrance, setEntrance] = useState(address?.entrance || '');
  const [floor, setFloor] = useState(address?.floor || '');
  const [apartment, setApartment] = useState(address?.apartment || '');
  const [comment, setComment] = useState(address?.comment || '');
  const [isDefault, setIsDefault] = useState(address?.isDefault || false);
  const save = useMutation({
    mutationFn: async () => {
      if (!point) throw new Error(c('Выберите точку на карте', 'Xaritadan nuqta tanlang', 'Select a point on the map'));
      const payload = { ...point, label: label.trim() || c('Мой адрес', 'Mening manzilim', 'My address'), addressText: addressText.trim(), entrance, floor, apartment, comment, isDefault };
      const response = address ? await api.patch<{ data: SavedAddress }>(`/addresses/${address.id}`, payload) : await api.post<{ data: SavedAddress }>('/addresses', payload);
      return response.data.data;
    },
    onSuccess: (saved) => { void queryClient.invalidateQueries({ queryKey: ['addresses'] }); void invalidateDeliveryContext(queryClient); onSaved(saved); },
  });
  function submit(event: FormEvent) { event.preventDefault(); save.mutate(); }
  if (mapOpen) return <YandexLocationPicker initial={point} onClose={() => point ? setMapOpen(false) : onClose()} onConfirm={(value) => { setPoint(value); setMapOpen(false); }} />;
  return <Modal title={address ? c('Изменить адрес', 'Manzilni tahrirlash', 'Edit address') : c('Новый адрес', 'Yangi manzil', 'New address')} onClose={onClose}>
    <form onSubmit={submit} className="space-y-4">
      <button type="button" onClick={() => setMapOpen(true)} className={`${secondaryClass} w-full justify-between`}><span className="flex items-center gap-2"><Icon name="location" />{point ? c('Изменить точку на карте', 'Xaritadagi nuqtani o‘zgartirish', 'Change map location') : c('Выбрать на карте', 'Xaritadan tanlash', 'Choose on map')}</span><Icon name="arrow" /></button>
      {point && <p className="text-xs tabular-nums text-[var(--muted)]">{point.latitude.toFixed(6)}, {point.longitude.toFixed(6)}</p>}
      <Field label={c('Название адреса', 'Manzil nomi', 'Address label')}><input className={inputClass} value={label} onChange={(event) => setLabel(event.target.value)} placeholder={c('Дом, работа…', 'Uy, ish…', 'Home, work…')} maxLength={80} /></Field>
      <Field label={c('Улица и номер дома', 'Ko‘cha va uy raqami', 'Street and building')}><input required minLength={5} maxLength={300} autoComplete="street-address" className={inputClass} value={addressText} onChange={(event) => setAddressText(event.target.value)} placeholder={c('Введите точный адрес', 'Aniq manzilni kiriting', 'Enter the exact address')} /></Field>
      <p className="text-xs leading-relaxed text-[var(--muted)]">{c('Укажите адрес самостоятельно: автоматическое определение адреса не подключено.', 'Manzilni o‘zingiz kiriting: avtomatik manzil aniqlash ulanmagan.', 'Enter your address manually; automatic address lookup is not connected.')}</p>
      <div className="grid grid-cols-3 gap-3"><Field label={c('Подъезд', 'Kirish', 'Entrance')}><input className={inputClass} value={entrance} onChange={(event) => setEntrance(event.target.value)} maxLength={30} /></Field><Field label={c('Этаж', 'Qavat', 'Floor')}><input className={inputClass} value={floor} onChange={(event) => setFloor(event.target.value)} maxLength={20} /></Field><Field label={c('Квартира', 'Xonadon', 'Apartment')}><input className={inputClass} value={apartment} onChange={(event) => setApartment(event.target.value)} maxLength={30} /></Field></div>
      <Field label={c('Комментарий к доставке', 'Yetkazish uchun izoh', 'Delivery instructions')}><textarea className={`${inputClass} min-h-24 resize-y`} value={comment} onChange={(event) => setComment(event.target.value)} maxLength={500} /></Field>
      <label className="flex items-center gap-3 text-sm"><input type="checkbox" className="size-4 accent-orange-600" checked={isDefault} onChange={(event) => setIsDefault(event.target.checked)} />{c('Основной адрес доставки', 'Asosiy yetkazish manzili', 'Default delivery address')}</label>
      <FormError message={save.error ? friendlyError(save.error) : ''} />
      <button type="submit" disabled={save.isPending || !point} className={`${primaryClass} w-full`}>{save.isPending ? c('Сохраняем…', 'Saqlanmoqda…', 'Saving…') : c('Сохранить адрес', 'Manzilni saqlash', 'Save address')}</button>
    </form>
  </Modal>;
}

