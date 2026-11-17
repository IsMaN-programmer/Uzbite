import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApp } from '../context/AppContext';
import { api, friendlyError } from '../lib/api';
import { Icon } from './icons/Icon';
import { Field, FormError, inputClass, Modal, money, primaryClass, useCopy } from './AccountPrimitives';
import type { UserOrder } from './AccountTypes';
import { RestaurantSupportDialog } from './RestaurantSupportDialog';
import { OrderNotificationsButton } from './OrderNotificationsButton';

const stages: UserOrder['status'][] = ['PENDING_ACCEPTANCE', 'ACCEPTED', 'PREPARING', 'DELIVERING', 'DELIVERED'];
export function isActiveOrder(order: UserOrder) { return stages.slice(0, 4).includes(order.status); }

function useOrderPresentation(order: UserOrder) {
  const c = useCopy();
  const { language } = useApp();
  const labels = [c('Ожидание', 'Kutilmoqda', 'Waiting'), c('Принят', 'Qabul qilindi', 'Accepted'), c('Готовится', 'Tayyorlash', 'Preparing'), c('В пути', 'Yo‘lda', 'On the way'), c('Доставлено', 'Yetkazildi', 'Delivered')];
  const stage = stages.indexOf(order.status);
  const label = order.status === 'CANCELLED' ? c('Отменён', 'Bekor qilindi', 'Cancelled') : stage === 0 ? c('Ожидает принятия', 'Qabul qilinishi kutilmoqda', 'Awaiting acceptance') : stage === 2 ? c('Готовится', 'Tayyorlanmoqda', 'Preparing') : stage === 3 ? c('Доставляется', 'Yetkazilmoqda', 'On the way') : labels[stage];
  const locale = language === 'en' ? 'en-GB' : language === 'uz' ? 'uz-UZ' : 'ru-RU';
  const updated = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(order.updatedAt));
  const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(order.createdAt));
  const restaurantName = order.restaurantName || order.restaurant?.name || c('Ресторан', 'Restoran', 'Restaurant');
  const paymentLabel = ({
    PENDING: c('Ожидает оплаты', 'To‘lov kutilmoqda', 'Awaiting payment'),
    AWAITING_PAYMENT: c('Ожидает оплаты', 'To‘lov kutilmoqda', 'Awaiting payment'),
    PENDING_CONFIRMATION: c('На проверке', 'Tekshirilmoqda', 'Being verified'),
    AWAITING_CONFIRMATION: c('На проверке', 'Tekshirilmoqda', 'Being verified'),
    PAID: c('Оплачено', 'To‘landi', 'Paid'),
    REJECTED: c('Оплата отклонена', 'To‘lov rad etildi', 'Payment rejected'),
  } as Record<string, string>)[order.payment?.status ?? ''] || c('Не указано', 'Ko‘rsatilmagan', 'Not specified');
  return { c, language, labels, stage, label, updated, date, restaurantName, paymentLabel };
}

function OrderStatusHero({ order }: { order: UserOrder }) {
  const { c, label, updated, restaurantName } = useOrderPresentation(order);
  return <div className={'order-status-hero ' + (order.status === 'DELIVERED' ? 'order-status-hero--delivered' : order.status === 'CANCELLED' ? 'order-status-hero--cancelled' : '')}>
    <p>{c('Текущий статус', 'Joriy holat', 'Current status')}</p><h3>{label}</h3><span>{c('Обновлено в', 'Yangilandi', 'Updated at')} {updated}</span>
    <div className="order-status-restaurant">{order.restaurant?.logoUrl ? <img src={order.restaurant.logoUrl} alt="" width="30" height="30"/> : <span><Icon name="restaurant" size={18}/></span>}<strong>{restaurantName}</strong></div>
  </div>;
}

function OrderTimeline({ order }: { order: UserOrder }) {
  const { c, labels, stage } = useOrderPresentation(order);
  if (order.status === 'CANCELLED') return <p className="order-cancelled-note"><Icon name="close" size={19}/>{c('Заказ отменён', 'Buyurtma bekor qilindi', 'This order was cancelled')}</p>;
  return <ol className="order-timeline" aria-label={c('Этапы заказа', 'Buyurtma bosqichlari', 'Order progress')}>{labels.map((label, index) => <li key={stages[index]} className={index < stage ? 'is-complete' : index === stage ? 'is-current' : ''} aria-current={index === stage ? 'step' : undefined}>
    <span className="order-step-dot">{index < stage && <Icon name="check" size={11}/>}</span><span className="order-step-label">{label}</span>
  </li>)}</ol>;
}

export function OrderCard({ order, expanded = false, onOpen }: { order: UserOrder; expanded?: boolean; onOpen: (order: UserOrder) => void }) {
  const { c, language, label, date, restaurantName } = useOrderPresentation(order);
  const [reviewOpen, setReviewOpen] = useState(false);
  const active = isActiveOrder(order);
  return <>
    <article className={'order-card ' + (expanded && active ? 'order-card--active' : '')}>
      {expanded && active ? <><OrderStatusHero order={order}/><OrderTimeline order={order}/></> : <header className="order-history-header"><div><p>#{order.number || order.id.slice(-8).toUpperCase()} · {date}</p><Link to={'/restaurants/' + order.restaurantId}>{restaurantName}</Link></div><span className={'order-status-badge ' + (order.status === 'DELIVERED' ? 'is-delivered' : '')}>{label}</span></header>}
      <div className="order-card-bottom"><strong>{money(order.total, language)}</strong><button type="button" className={active ? 'food-primary' : 'order-details-button'} onClick={() => onOpen(order)}>{active ? c('Мой заказ', 'Buyurtmam', 'My order') : c('Подробнее', 'Batafsil', 'View details')}<Icon name="chevron" size={17}/></button></div>
      {order.status === 'DELIVERED' && !order.review && <button type="button" className="order-review-button" onClick={() => setReviewOpen(true)}><Icon name="star" size={17}/>{c('Оценить заказ', 'Buyurtmani baholash', 'Rate your order')}</button>}
      {order.review && <p className="order-review-published"><Icon name="check" size={15}/>{c('Отзыв опубликован', 'Fikr joylandi', 'Review published')}</p>}
    </article>
    {reviewOpen && <ReviewEditor order={order} onClose={() => setReviewOpen(false)}/>}
  </>;
}

export function OrderStatusModal({ order, onClose }: { order: UserOrder; onClose: () => void }) {
  const result = useQuery({ queryKey: ['orders', 'detail', order.id], initialData: order, queryFn: async ({ signal }) => (await api.get<{ data: UserOrder }>('/orders/' + order.id, { signal })).data.data, refetchInterval: query => isActiveOrder(query.state.data ?? order) ? 15000 : false });
  const current = result.data;
  const { c, language, date, paymentLabel } = useOrderPresentation(current);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const address = current.addressSnapshot;
  const content = <div className="order-status-screen"><div className="order-status-content">
        {result.isError && <div className="mb-4 space-y-2"><FormError message={friendlyError(result.error)}/><button type="button" className="order-details-button" onClick={() => void result.refetch()}>{c('Обновить статус', 'Holatni yangilash', 'Refresh status')}</button></div>}
        <OrderStatusHero order={current}/><OrderTimeline order={current}/>
        <section className="order-composition"><h3>{c('Состав заказа', 'Buyurtma tarkibi', 'Order items')}</h3><ul>{current.items.map(item => <li key={item.id}><span>{item.dishName || item.nameSnapshot || item.name} <small>× {item.quantity}</small></span><strong>{money(item.total ?? Number(item.unitPrice) * item.quantity, language)}</strong></li>)}</ul></section>
        <dl className="order-status-details">
          <div><dt><Icon name="card" size={18}/>{c('Оплата', 'To‘lov', 'Payment')}</dt><dd>{current.payment ? current.payment.method === 'CASH' ? c('Наличными', 'Naqd pul', 'Cash') : c('Картой', 'Karta', 'Card') : c('Не указано', 'Ko‘rsatilmagan', 'Not specified')}<span className={'order-payment-state ' + (current.payment?.status === 'PAID' ? 'is-paid' : current.payment?.status === 'REJECTED' ? 'is-rejected' : '')}>{paymentLabel}</span></dd></div>
          {current.payment?.rejectionReason && <div className="order-payment-reason">{current.payment.rejectionReason}</div>}
          <div><dt><Icon name="location" size={18}/>{c('Адрес', 'Manzil', 'Address')}</dt><dd>{address?.addressText}<small>{[address?.entrance && c('Подъезд ', 'Kirish ', 'Entrance ') + address.entrance, address?.floor && c('Этаж ', 'Qavat ', 'Floor ') + address.floor, address?.apartment && c('Кв. ', 'Xon. ', 'Apt. ') + address.apartment].filter(Boolean).join(' · ')}</small></dd></div>
          <div><dt><Icon name="user" size={18}/>{c('Получатель', 'Qabul qiluvchi', 'Recipient')}</dt><dd>{current.recipientName}<small>{current.recipientPhone}</small></dd></div>
          {address?.comment && <div><dt><Icon name="comments" size={18}/>{c('Курьеру', 'Kuryerga', 'Courier note')}</dt><dd>{address.comment}</dd></div>}
        </dl>
        <p className="order-number">{c('Заказ', 'Buyurtma', 'Order')} #{current.number || current.id.slice(-8).toUpperCase()} · {date}</p>
        {current.status === 'PENDING_ACCEPTANCE' && <p className="order-awaiting-note">{c('Заказ оформлен и ожидает подтверждения ресторана.', 'Buyurtma yaratildi. Restoran tasdig‘i kutilmoqda.', 'Your order is placed and awaiting restaurant confirmation.')}</p>}
        {current.status === 'DELIVERED' && !current.review && <button type="button" className="order-review-button" onClick={() => setReviewOpen(true)}><Icon name="star" size={18}/>{c('Оценить заказ', 'Buyurtmani baholash', 'Rate your order')}</button>}
        {current.review && <p className="order-review-published"><Icon name="check" size={16}/>{c('Отзыв опубликован', 'Fikr joylandi', 'Review published')}</p>}
      </div><footer className="order-status-footer"><div><span>{c('Итого', 'Jami', 'Total')}</span><strong>{money(current.total, language)}</strong></div><button type="button" className="order-support-button" onClick={() => setSupportOpen(true)}>{c('Поддержка', 'Yordam', 'Support')}<Icon name="help" size={17} className="shrink-0"/></button></footer></div>;
  const notifications = <OrderNotificationsButton key={current.id} order={current}/>;
  return <>
    <Modal title={c('Мой заказ', 'Buyurtmam', 'My order')} onClose={onClose} presentation="screen" compactHeader headerAction={notifications}>{content}</Modal>
    {reviewOpen && <ReviewEditor order={current} onClose={() => setReviewOpen(false)}/>}
    {supportOpen && <RestaurantSupportDialog order={current} onClose={() => setSupportOpen(false)}/>}
  </>;
}

function ReviewEditor({ order, onClose }: { order: UserOrder; onClose: () => void }) {
  const c = useCopy();
  const queryClient = useQueryClient();
  const [rating, setRating] = useState(5);
  const [text, setText] = useState('');
  const review = useMutation({ mutationFn: () => api.post(`/restaurants/${order.restaurantId}/reviews`, { orderId: order.id, rating, text }), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['orders'] }); void queryClient.invalidateQueries({ queryKey: ['restaurant', order.restaurantId] }); onClose(); } });
  function submit(event: FormEvent) { event.preventDefault(); review.mutate(); }
  return <Modal title={c('Как вам заказ?', 'Buyurtma yoqdimi?', 'How was your order?')} onClose={onClose}><form onSubmit={submit} className="space-y-5"><p className="flex items-center gap-2 text-xs text-emerald-600"><Icon name="check" />{c('Подтверждённый заказ', 'Tasdiqlangan buyurtma', 'Verified order')}</p><div className="flex gap-2" role="group" aria-label={c('Оценка', 'Baho', 'Rating')}>{[1, 2, 3, 4, 5].map((value) => <button type="button" key={value} onClick={() => setRating(value)} aria-label={`${value} / 5`} aria-pressed={rating === value} className={`flex size-12 items-center justify-center rounded-xl border ${value <= rating ? 'border-orange-500 bg-[var(--surface)] text-orange-600' : 'border-[var(--border)] text-[var(--muted)]'}`}><Icon name="star" /></button>)}</div><Field label={c('Ваш отзыв', 'Fikringiz', 'Your review')}><textarea required minLength={3} maxLength={2000} className={`${inputClass} min-h-32`} value={text} onChange={(event) => setText(event.target.value)} /></Field><FormError message={review.error ? friendlyError(review.error) : ''} /><button className={`${primaryClass} w-full`} disabled={review.isPending}>{review.isPending ? c('Публикуем…', 'Joylanmoqda…', 'Publishing…') : c('Опубликовать отзыв', 'Fikrni joylash', 'Publish review')}</button></form></Modal>;
}
