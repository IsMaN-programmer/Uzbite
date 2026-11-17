import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, friendlyError } from '../lib/api';
import { invalidateDeliveryContext } from '../lib/delivery';
import { Icon } from './icons/Icon';
import { AddressEditor } from './AddressEditor';
import { FormError, LoadingCards, Modal, primaryClass, secondaryClass, useCopy } from './AccountPrimitives';
import type { SavedAddress } from './AccountTypes';

export function AddressBook({ onClose }: { onClose: () => void }) {
  const c = useCopy();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<SavedAddress | 'new' | null>(null);
  const [deleting, setDeleting] = useState<SavedAddress | null>(null);
  const addresses = useQuery({ queryKey: ['addresses'], queryFn: async () => (await api.get<{ data: SavedAddress[] }>('/addresses')).data.data });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/addresses/${id}`), onSuccess: () => { setDeleting(null); void queryClient.invalidateQueries({ queryKey: ['addresses'] }); void invalidateDeliveryContext(queryClient); } });
  const makeDefault = useMutation({ mutationFn: (id: string) => api.patch(`/addresses/${id}`, { isDefault: true }), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['addresses'] }); void invalidateDeliveryContext(queryClient); } });
  if (editing) return <AddressEditor address={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={() => setEditing(null)} />;
  return <Modal title={c('Мои адреса', 'Manzillarim', 'My addresses')} onClose={onClose}>
    {deleting ? <div className="space-y-5"><p className="text-sm text-[var(--muted)]">{c('Удалить этот адрес?', 'Bu manzil o‘chirilsinmi?', 'Delete this address?')} <strong className="text-[var(--text)]">{deleting.addressText}</strong></p><FormError message={remove.error ? friendlyError(remove.error) : ''} /><div className="flex gap-3"><button className={`${primaryClass} flex-1`} disabled={remove.isPending} onClick={() => remove.mutate(deleting.id)}>{c('Удалить', 'O‘chirish', 'Delete')}</button><button className={secondaryClass} onClick={() => setDeleting(null)}>{c('Отмена', 'Bekor qilish', 'Cancel')}</button></div></div> : <div className="space-y-4">
      {addresses.isPending ? <LoadingCards /> : addresses.isError ? <FormError message={friendlyError(addresses.error)} /> : addresses.data?.length ? addresses.data.map((address) => <article key={address.id} className="rounded-2xl border border-[var(--border)] p-4"><div className="flex items-start justify-between gap-3"><div className="flex gap-3"><span className="mt-0.5 text-orange-600"><Icon name="location" /></span><div><h3 className="text-sm font-semibold">{address.label}{address.isDefault && <span className="ml-2 rounded-full bg-[var(--surface)] px-2 py-1 text-[9px] font-medium text-orange-600">{c('Основной', 'Asosiy', 'Default')}</span>}</h3><p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">{address.addressText}</p></div></div><button onClick={() => setEditing(address)} type="button" className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--bg)] text-[var(--muted)] hover:text-orange-600" aria-label={c('Изменить адрес', 'Manzilni tahrirlash', 'Edit address')}><Icon name="edit" /></button></div><div className="mt-4 flex items-center justify-between border-t border-[var(--border)] pt-3">{!address.isDefault ? <button className="text-[11px] font-medium text-orange-600 disabled:opacity-50" disabled={makeDefault.isPending} onClick={() => makeDefault.mutate(address.id)}>{c('Сделать основным', 'Asosiy qilish', 'Make default')}</button> : <span />}<button type="button" className="text-[11px] text-[var(--muted)] hover:text-red-500" onClick={() => { remove.reset(); setDeleting(address); }}>{c('Удалить', 'O‘chirish', 'Delete')}</button></div></article>) : <div className="rounded-2xl bg-[var(--bg)] p-8 text-center"><div className="mb-4 inline-flex text-orange-600"><Icon name="location" /></div><p className="text-sm text-[var(--muted)]">{c('Сохраните адрес один раз, и мы подставим его в следующий заказ.', 'Manzilni bir marta saqlang, keyingi buyurtmada u avtomatik kiritiladi.', 'Save your address once and we will use it for your next order.')}</p></div>}
      <FormError message={makeDefault.error ? friendlyError(makeDefault.error) : ''} /><button type="button" className={`${primaryClass} w-full`} onClick={() => setEditing('new')}><Icon name="plus" />{c('Добавить адрес', 'Manzil qo‘shish', 'Add address')}</button>
    </div>}
  </Modal>;
}
