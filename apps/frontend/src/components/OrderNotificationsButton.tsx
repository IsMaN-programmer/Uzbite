import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Notification } from '@uzbite/shared';
import { useApp } from '../context/AppContext';
import { api, friendlyError } from '../lib/api';
import { nextCollectionPage, type PaginatedCollection } from '../lib/pagination';
import type { UserOrder } from './AccountTypes';
import { FormError, Modal, secondaryClass, useCopy } from './AccountPrimitives';
import { Icon } from './icons/Icon';

type OrderNotices = PaginatedCollection<Notification> & { unreadCount: number };

export function OrderNotificationsButton({ order }: { order: UserOrder }) {
  const { language } = useApp();
  const c = useCopy();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const notices = useInfiniteQuery({
    queryKey: ['notifications', 'order', order.id, language], initialPageParam: 1,
    queryFn: async ({ pageParam, signal }) => (await api.get<OrderNotices>('/notifications', { params: { orderId: order.id, page: pageParam, pageSize: 12 }, signal })).data,
    getNextPageParam: nextCollectionPage, refetchInterval: 15000,
  });
  const read = useMutation({
    mutationFn: () => api.patch('/notifications/read', { orderId: order.id }),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ['notifications'] }); },
  });
  const items = notices.data?.pages.flatMap(page => page.data) ?? [];
  const unread = notices.data?.pages[0]?.unreadCount ?? 0;
  const formatDate = (date: string) => new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : language === 'uz' ? 'uz-UZ' : 'ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(date));
  return <>
    <button type="button" className="order-notifications-button" aria-label={c('Уведомления заказа', 'Buyurtma bildirishnomalari', 'Order notifications') + (unread ? ` (${unread})` : '')} title={c('История статусов', 'Holatlar tarixi', 'Status history')} onClick={() => { setOpen(true); void notices.refetch(); void client.invalidateQueries({ queryKey: ['orders', 'detail', order.id] }); }}><Icon name="notifications" size={23}/>{unread > 0 && <span className="order-notifications-dot" aria-hidden="true"/>}</button>
    {open && <Modal title={c('Уведомления заказа', 'Buyurtma bildirishnomalari', 'Order notifications')} onClose={() => setOpen(false)}>
      <div className="order-notices-heading"><p>{order.restaurantName || order.restaurant?.name}</p>{unread > 0 && <button type="button" disabled={read.isPending} onClick={() => read.mutate()}>{read.isPending ? c('Сохраняем…', 'Saqlanmoqda…', 'Saving…') : c('Прочитать все', 'Barchasini o‘qish', 'Mark all read')}<Icon name="check" size={16}/></button>}</div>
      <FormError message={read.error ? friendlyError(read.error) : ''}/>
      {notices.isPending ? <div className="skeleton h-28"/> : notices.isError && !items.length ? <div className="space-y-3"><FormError message={friendlyError(notices.error)}/><button type="button" className={secondaryClass} onClick={() => void notices.refetch()}>{c('Повторить', 'Qayta urinish', 'Retry')}</button></div> : <ol className="order-notices-list">
        {items.length ? items.map(item => <li key={item.id} className={item.readAt ? 'is-read' : ''}><span className="order-notice-icon"><Icon name={item.type === 'PAYMENT_STATUS' ? 'card' : item.type === 'ORDER_CREATED' ? 'receipt' : 'check'} size={18}/></span><div><h3>{item.title}</h3><p>{item.body}</p><time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time></div>{!item.readAt && <span className="order-notice-unread" aria-label={c('Не прочитано', 'O‘qilmagan', 'Unread')}/>}</li>) : <li className="is-read"><span className="order-notice-icon"><Icon name="receipt" size={18}/></span><div><h3>{c('Заказ создан', 'Buyurtma yaratildi', 'Order placed')}</h3><time dateTime={order.createdAt}>{formatDate(order.createdAt)}</time><p>{c('Новые изменения статуса появятся здесь.', 'Yangi holat o‘zgarishlari shu yerda ko‘rinadi.', 'New status updates will appear here.')}</p></div></li>}
      </ol>}
      {notices.isError && items.length > 0 && <div className="mt-4 space-y-3"><FormError message={friendlyError(notices.error)}/><button type="button" className={secondaryClass} disabled={notices.isFetching} onClick={() => { if (notices.isFetchNextPageError) void notices.fetchNextPage(); else void notices.refetch(); }}>{c('Повторить', 'Qayta urinish', 'Retry')}</button></div>}
      {notices.hasNextPage && !notices.isFetchNextPageError && <button type="button" className={secondaryClass + ' mt-5 w-full'} disabled={notices.isFetching} onClick={() => void notices.fetchNextPage()}>{notices.isFetchingNextPage ? c('Загружаем…', 'Yuklanmoqda…', 'Loading…') : c('Ранее', 'Oldinroq', 'Earlier updates')}<Icon name="down" size={17}/></button>}
    </Modal>}
  </>;
}
