import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, friendlyError } from '../lib/api';
import { invalidateDeliveryContext, useDeliveryAddress, useSelectDeliveryAddress } from '../lib/delivery';
import { useApp } from '../context/AppContext';
import { Icon } from './icons/Icon';
import { AddressEditor } from './AddressEditor';
import { Field, FormError, inputClass, Modal, money, secondaryClass, useCopy } from './AccountPrimitives';
import type { Quote, SavedAddress, UserOrder } from './AccountTypes';

export function CheckoutPanel({ quote, onClose, onComplete }: { quote: Quote; onClose: () => void; onComplete: (order: UserOrder) => void }) {
  const c = useCopy();
  const { user, cart, language, clearCart, refreshUser } = useApp();
  const queryClient = useQueryClient();
  const [addressId, setAddressId] = useState('');
  const [choosingAddress, setChoosingAddress] = useState(false);
  const [addressEditor, setAddressEditor] = useState(false);
  const [addressToEdit, setAddressToEdit] = useState<SavedAddress>();
  const [recipientName, setRecipientName] = useState(user?.recipientName || '');
  const [recipientPhone, setRecipientPhone] = useState(user?.phone || '');
  const [comment, setComment] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'CARD'>('CASH');
  const [receipt, setReceipt] = useState<{ id: string; name: string } | null>(null);
  const addresses = useQuery({ queryKey: ['addresses'], queryFn: async () => (await api.get<{ data: SavedAddress[] }>('/addresses')).data.data });
  const delivery = useDeliveryAddress();
  const deliverySelection = useSelectDeliveryAddress(() => setChoosingAddress(false));

  function selectAddress(id: string) { setAddressId(id); deliverySelection.mutate(id); }
  useEffect(() => {
    if (!delivery.isPending && addresses.data?.length && !addresses.data.some(item => item.id === addressId)) {
      setAddressId((addresses.data.find(item => item.id === delivery.data?.address?.id) || addresses.data.find(item => item.isDefault) || addresses.data[0]).id);
    }
  }, [addressId, addresses.data, delivery.data, delivery.isPending]);
  const selectedAddress = addresses.data?.find(item => item.id === addressId);
  const selectedId = selectedAddress?.id;
  const savedComment = selectedAddress?.comment ?? '';
  const [commentAddressId, setCommentAddressId] = useState<string>();
  useEffect(() => {
    if (selectedId !== commentAddressId) { setComment(savedComment); setCommentAddressId(selectedId); }
  }, [selectedId, savedComment, commentAddressId]);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const data = new FormData(); data.append('file', file);
      const result = await api.post<{ data: { id: string } }>('/uploads/receipt', data);
      return { id: result.data.data.id, name: file.name };
    },
    onSuccess: setReceipt,
  });
  const order = useMutation({
    mutationFn: () => api.post<{ data: UserOrder }>('/orders', {
      items: cart.map(item => ({ dishId: item.dishId, quantity: item.quantity })),
      addressId, recipientName, recipientPhone, paymentMethod, comment,
      ...(paymentMethod === 'CARD' ? { receiptId: receipt?.id } : {}),
    }),
    onSuccess: response => {
      const created = response.data.data;
      queryClient.setQueryData(['orders', 'detail', created.id], created);
      onComplete(created);
      clearCart();
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      void invalidateDeliveryContext(queryClient);
      void refreshUser();
    },
    onError: () => { void queryClient.invalidateQueries({ queryKey: ['orders'] }); },
  });
  const quantity = cart.reduce((sum, item) => sum + item.quantity, 0);
  const rule = new Intl.PluralRules('ru').select(quantity);
  const itemWord = c(rule === 'one' ? 'блюдо' : rule === 'few' ? 'блюда' : 'блюд', 'ta taom', quantity === 1 ? 'item' : 'items');
  function submit(event: FormEvent) { event.preventDefault(); if (!order.isPending) order.mutate(); }
  function openNewAddress() { setAddressToEdit(undefined); setAddressEditor(true); }
  function savedAddress(value: SavedAddress) {
    queryClient.setQueryData<SavedAddress[]>(['addresses'], previous => previous?.some(item => item.id === value.id) ? previous.map(item => item.id === value.id ? value : item) : [...(previous ?? []), value]);
    selectAddress(value.id);
    setComment(value.comment ?? '');
    setCommentAddressId(value.id);
    setAddressEditor(false);
  }

  if (addressEditor) return <AddressEditor address={addressToEdit} onClose={() => setAddressEditor(false)} onSaved={savedAddress}/>;
  return <>
    <Modal title={c('Оформление заказа', 'Buyurtmani rasmiylashtirish', 'Checkout')} onClose={onClose} presentation="screen">
      <form onSubmit={submit} className="checkout-form" aria-busy={order.isPending}>
        <div className="checkout-content">
          <section className="checkout-restaurant" aria-label={c('Ваш заказ', 'Buyurtmangiz', 'Your order')}>
            <div className="checkout-restaurant-logo">{quote.restaurant.logoUrl ? <img src={quote.restaurant.logoUrl} alt="" width="54" height="54"/> : <Icon name="restaurant" size={26}/>}</div>
            <div><h3>{quote.restaurant.name}</h3><p>{quantity} {itemWord} · {money(quote.total, language)}</p><button type="button" onClick={onClose}>{c('Изменить', 'O‘zgartirish', 'Edit')}</button></div>
          </section>

          <section className="checkout-section"><h3>{c('Адрес доставки', 'Yetkazish manzili', 'Delivery address')}</h3>
            {addresses.isPending ? <div className="skeleton h-20"/> : addresses.isError ? <><FormError message={friendlyError(addresses.error)}/><button type="button" className={secondaryClass} onClick={() => void addresses.refetch()}>{c('Повторить', 'Qayta urinish', 'Retry')}</button></> : selectedAddress ? <div className="checkout-address">
              <div className="checkout-address-art" aria-hidden="true"><svg viewBox="0 0 80 80"><rect width="80" height="80" fill="#f0f2ec"/><path d="M0 13 80 32M0 55 80 16M12 0l29 80M63 0 34 80" fill="none" stroke="white" strokeWidth="8"/><path d="m0 69 80-25M39 0l22 80" fill="none" stroke="#dde5d3" strokeWidth="6"/><path d="M49 32a9 9 0 1 0-18 0c0 8 9 17 9 17s9-9 9-17" fill="#f8781d"/><circle cx="40" cy="32" r="3" fill="white"/></svg></div>
              <div><p><strong>{selectedAddress.label}</strong> · {selectedAddress.addressText}</p><button type="button" className="food-primary" disabled={deliverySelection.isPending} onClick={() => setChoosingAddress(true)}>{c('Изменить', 'O‘zgartirish', 'Change')}</button></div>
            </div> : <button type="button" className="checkout-address-add" onClick={openNewAddress}><Icon name="location" size={23}/>{c('Добавить адрес', 'Manzil qo‘shish', 'Add an address')}<Icon name="plus" size={18}/></button>}
            <FormError message={deliverySelection.error ? friendlyError(deliverySelection.error) : ''}/>
          </section>

          <section className="checkout-section"><h3>{c('Получатель', 'Qabul qiluvchi', 'Recipient')}</h3><div className="checkout-recipient">
            <Field label={c('Имя получателя', 'Qabul qiluvchi ismi', 'Recipient name')}><input name="recipientName" autoComplete="name" required minLength={2} maxLength={80} value={recipientName} onChange={event => setRecipientName(event.target.value)} placeholder={c('Как к вам обращаться', 'Ismingiz', 'Your name')} disabled={order.isPending}/></Field>
            <Field label={c('Телефон', 'Telefon', 'Phone')}><input name="recipientPhone" type="tel" autoComplete="tel" required pattern="\+?[0-9 \(\)\-]{9,20}" maxLength={25} value={recipientPhone} onChange={event => setRecipientPhone(event.target.value)} placeholder="+998 90 123 45 67" disabled={order.isPending}/></Field>
          </div></section>

          <section className="checkout-section"><h3>{c('Оплата', 'To‘lov', 'Payment')}</h3>
            <div className="checkout-payment" role="group" aria-label={c('Способ оплаты', 'To‘lov usuli', 'Payment method')}>
              <button type="button" aria-pressed={paymentMethod === 'CASH'} disabled={order.isPending} onClick={() => setPaymentMethod('CASH')}>{c('Наличными', 'Naqd pul', 'Cash')}<Icon name="cash" size={24}/></button>
              <button type="button" aria-pressed={paymentMethod === 'CARD'} disabled={!quote.restaurant.cardPaymentAvailable || order.isPending} onClick={() => setPaymentMethod('CARD')}>{c('Картой', 'Karta', 'Card')}<Icon name="card" size={23}/></button>
            </div>
            <p className="checkout-hint">{quote.restaurant.cardPaymentAvailable ? c('Статус оплаты появится в заказе.', 'To‘lov holati buyurtmada ko‘rsatiladi.', 'Payment status will appear in your order.') : c('Оплата картой пока недоступна.', 'Karta orqali to‘lash hozircha mavjud emas.', 'Card payment is currently unavailable.')}</p>
            {paymentMethod === 'CARD' && quote.restaurant.cardPaymentAvailable && <div className="checkout-transfer">
              <p className="break-words text-sm font-semibold">{quote.restaurant.paymentDetails}</p>
              {quote.restaurant.paymentQrUrl && <img src={quote.restaurant.paymentQrUrl} alt={c('QR-код для оплаты', 'To‘lov QR kodi', 'Payment QR code')} className="mx-auto size-36 rounded-xl bg-white object-contain p-2"/>}
              <p className="text-xs leading-relaxed text-[var(--muted)]">{quote.restaurant.paymentInstructions || c('Оплатите в банковском приложении и приложите чек. Оплату подтвердит ресторан.', 'Bank ilovasida to‘lang va chekni yuklang. To‘lovni restoran tasdiqlaydi.', 'Pay in your banking app and upload a receipt. The restaurant will verify the payment.')}</p>
              <Field label={c('Чек об оплате', 'To‘lov cheki', 'Payment receipt')}><input className={inputClass} type="file" accept="image/jpeg,image/png,image/webp" disabled={upload.isPending || order.isPending} onChange={event => { const file = event.target.files?.[0]; setReceipt(null); if (file) upload.mutate(file); }}/></Field>
              {upload.isPending && <p role="status" className="checkout-hint">{c('Загружаем чек…', 'Chek yuklanmoqda…', 'Uploading receipt…')}</p>}
              {receipt && <p className="flex items-center gap-2 break-all text-xs text-emerald-600"><Icon name="check" size={16}/>{receipt.name}</p>}
              <FormError message={upload.error ? friendlyError(upload.error) : ''}/>
            </div>}
          </section>

          <section className="checkout-section"><h3>{c('Комментарий курьеру', 'Kuryerga izoh', 'Note for the courier')}</h3><textarea name="comment" maxLength={500} value={comment} onChange={event => setComment(event.target.value)} aria-label={c('Комментарий курьеру', 'Kuryerga izoh', 'Note for the courier')} placeholder={c('Например, позвонить у подъезда', 'Masalan, kirishda qo‘ng‘iroq qiling', 'For example, call at the entrance')} disabled={order.isPending}/></section>
          <FormError message={order.error ? friendlyError(order.error) : ''}/>
        </div>
        <footer className="checkout-footer"><div><span>{c('К оплате', 'To‘lash uchun', 'Total to pay')}</span><strong>{money(quote.total, language)}</strong></div><button type="submit" className="food-primary" disabled={order.isPending || !selectedAddress || !quote.restaurant.isOpen || deliverySelection.isPending || (paymentMethod === 'CARD' && !receipt) || upload.isPending}>{order.isPending ? c('Оформляем…', 'Yaratilmoqda…', 'Placing order…') : c('Подтвердить заказ', 'Buyurtmani tasdiqlash', 'Place order')}</button></footer>
      </form>
    </Modal>
    {choosingAddress && <Modal title={c('Адрес доставки', 'Yetkazish manzili', 'Delivery address')} onClose={() => setChoosingAddress(false)}>
      <div className="space-y-3">{addresses.data?.map(address => <button key={address.id} type="button" disabled={deliverySelection.isPending} aria-pressed={address.id === addressId} className="checkout-address-option" onClick={() => selectAddress(address.id)}><Icon name="location" size={21}/><span><strong>{address.label}</strong><span>{address.addressText}</span></span>{address.id === addressId && <Icon name="check" size={18}/>}</button>)}</div>
      <FormError message={deliverySelection.error ? friendlyError(deliverySelection.error) : ''}/>
      <div className="mt-5 flex flex-wrap gap-3"><button type="button" className={secondaryClass} onClick={() => { setChoosingAddress(false); openNewAddress(); }}><Icon name="plus" size={17}/>{c('Добавить адрес', 'Manzil qo‘shish', 'Add address')}</button>{selectedAddress && <button type="button" className={secondaryClass} onClick={() => { setAddressToEdit(selectedAddress); setAddressEditor(true); setChoosingAddress(false); }}><Icon name="edit" size={17}/>{c('Редактировать', 'Tahrirlash', 'Edit')}</button>}</div>
    </Modal>}
  </>;
}

