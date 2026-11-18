import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api, friendlyError } from '../lib/api';
import { nextCollectionPage, type PaginatedCollection } from '../lib/pagination';
import type { UserOrder } from './AccountTypes';
import { FormError, LoadingCards, secondaryClass, useCopy } from './AccountPrimitives';
import { Icon } from './icons/Icon';
import { OrderCard, OrderStatusModal } from './OrderCard';

export function OrderHistory() {
  const c = useCopy();
  const [selectedOrder, setSelectedOrder] = useState<UserOrder | null>(null);
  const orders = useInfiniteQuery({
    queryKey: ['orders', 'history'], initialPageParam: 1,
    queryFn: async ({ pageParam, signal }) => (await api.get<PaginatedCollection<UserOrder>>('/orders', { params: { scope: 'history', page: pageParam, pageSize: 12 }, signal })).data,
    getNextPageParam: nextCollectionPage,
  });
  const history = orders.data?.pages.flatMap(page => page.data) ?? [];
  return <>
    <section aria-label={c('Завершённые заказы', 'Tugallangan buyurtmalar', 'Completed orders')}>
      {orders.isPending ? <LoadingCards/> : !history.length && !orders.isError ? <div className="profile-history-empty"><span><Icon name="history" size={28}/></span><h3>{c('Пока нет завершённых заказов', 'Hali tugallangan buyurtmalar yo‘q', 'No completed orders yet')}</h3><p>{c('Доставленные и отменённые заказы будут появляться здесь.', 'Yetkazilgan va bekor qilingan buyurtmalar shu yerda ko‘rinadi.', 'Delivered and cancelled orders will appear here.')}</p></div> : <div className="space-y-4">{history.map(order => <OrderCard key={order.id} order={order} onOpen={setSelectedOrder}/>)}</div>}
      {orders.isError && <div className="mt-5 space-y-3"><FormError message={friendlyError(orders.error)}/><button type="button" className={secondaryClass} disabled={orders.isFetching} onClick={() => { if (orders.isFetchNextPageError) void orders.fetchNextPage(); else void orders.refetch(); }}>{c('Повторить', 'Qayta urinish', 'Retry')}</button></div>}
      {orders.hasNextPage && !orders.isFetchNextPageError && <button type="button" className={secondaryClass + ' mt-5 w-full'} disabled={orders.isFetching} onClick={() => void orders.fetchNextPage()}>{orders.isFetchingNextPage ? c('Загружаем…', 'Yuklanmoqda…', 'Loading…') : c('Показать ещё', 'Yana ko‘rsatish', 'Load more')}<Icon name="down" size={17}/></button>}
    </section>
    {selectedOrder && <OrderStatusModal order={selectedOrder} onClose={() => setSelectedOrder(null)}/>}
  </>;
}
