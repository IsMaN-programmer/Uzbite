import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, friendlyError } from '../lib/api';
import { useDeliveryAddress, useSelectDeliveryAddress } from '../lib/delivery';
import { AddressEditor } from './AddressEditor';
import { FormError, LoadingCards, Modal, primaryClass, useCopy } from './AccountPrimitives';
import { Icon } from './icons/Icon';
import type { SavedAddress } from './AccountTypes';

export function DeliveryAddressPicker({ onClose }: { onClose: () => void }) {
  const c = useCopy();
  const [adding, setAdding] = useState(false);
  const current = useDeliveryAddress();
  const select = useSelectDeliveryAddress(onClose);
  const addresses = useQuery({ queryKey: ['addresses'], queryFn: async () => (await api.get<{ data: SavedAddress[] }>('/addresses')).data.data });
  if (adding) return <AddressEditor onClose={() => setAdding(false)} onSaved={address => { setAdding(false); select.mutate(address.id); }}/>;
  return <Modal title={c('Адрес доставки', 'Yetkazish manzili', 'Delivery address')} onClose={onClose}>
    <div className="space-y-3">
      {addresses.isPending ? <LoadingCards/> : addresses.isError ? <><FormError message={friendlyError(addresses.error)}/><button type="button" className="button-secondary w-full" onClick={() => void addresses.refetch()}>{c('Повторить', 'Qayta urinish', 'Try again')}</button></> : addresses.data?.length ? addresses.data.map(address => <button key={address.id} type="button" disabled={select.isPending} onClick={() => select.mutate(address.id)} aria-pressed={current.data?.address?.id === address.id} className={'flex min-h-20 w-full items-center gap-3 rounded-2xl border p-4 text-left transition ' + (current.data?.address?.id === address.id ? 'border-brand' : 'border-[var(--border)]')}>
        <Icon name="location" size={21} className="shrink-0 text-brand"/><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{address.label}</span><span className="mt-1 block text-xs leading-relaxed text-[var(--muted)] [overflow-wrap:anywhere]">{address.addressText}</span></span>{current.data?.address?.id === address.id && <Icon name="check" size={19} className="shrink-0 text-brand"/>}
      </button>) : <p className="py-5 text-sm text-[var(--muted)]">{c('Добавьте адрес, чтобы рассчитать время доставки.', 'Yetkazish vaqtini hisoblash uchun manzil qo‘shing.', 'Add an address to estimate delivery time.')}</p>}
      <FormError message={select.error ? friendlyError(select.error) : ''}/>
      <button type="button" className={primaryClass + ' w-full'} disabled={select.isPending} onClick={() => setAdding(true)}><Icon name="plus" size={19}/>{c('Добавить адрес', 'Manzil qo‘shish', 'Add address')}</button>
    </div>
  </Modal>;
}
