import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { RestaurantSummary } from '@uzbite/shared';
import { useApp } from '../context/AppContext';
import { api, friendlyError } from '../lib/api';
import { cartLinePrice } from '../lib/cart-prices';
import { useDeliveryAddress } from '../lib/delivery';
import type { PaginatedCollection } from '../lib/pagination';
import { Icon } from '../components/icons/Icon';
import { CheckoutPanel } from '../components/CheckoutPanel';
import { DeliveryAddressPicker } from '../components/DeliveryAddressPicker';
import { OrderCard, OrderStatusModal } from '../components/OrderCard';
import { FormError, LoadingCards, Modal, money, primaryClass, secondaryClass, useCopy } from '../components/AccountPrimitives';
import type { Quote, UserOrder } from '../components/AccountTypes';

export function OrdersPage() {
  const { user, cart, updateQuantity, clearCart, language } = useApp();
  const c = useCopy();
  const [checkout, setCheckout] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<UserOrder | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [addressesOpen, setAddressesOpen] = useState(false);
  const orders = useQuery({
    queryKey: ['orders', 'active'],
    queryFn: async ({ signal }) => (await api.get<PaginatedCollection<UserOrder>>('/orders', { params: { scope: 'active', pageSize: 1 }, signal })).data,
    enabled: Boolean(user),
    refetchInterval: query => query.state.data?.data.length ? 15000 : false,
  });
  const quote = useQuery({
    queryKey: ['quote', cart.map(item => item.dishId + ':' + item.quantity).join(',')],
    queryFn: async () => (await api.post<{ data: Quote }>('/orders/quote', { items: cart.map(item => ({ dishId: item.dishId, quantity: item.quantity })) })).data.data,
    enabled: Boolean(user) && cart.length > 0, retry: false,
  });
  const delivery = useDeliveryAddress();
  const address = delivery.data?.address;
  const restaurantId = cart[0]?.restaurantId;
  const restaurant = useQuery({
    queryKey: ['restaurants', 'cart', restaurantId, address?.id, address?.latitude, address?.longitude],
    queryFn: async ({ signal }) => (await api.get<{ data: RestaurantSummary }>('/restaurants/' + restaurantId, { signal })).data.data,
    enabled: Boolean(user && restaurantId) && delivery.isSuccess,
  });
  const active = orders.data?.data[0];
  const total = cart.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0);
  const quantity = cart.reduce((sum, item) => sum + item.quantity, 0);
  const rule = new Intl.PluralRules('ru').select(quantity);
  const itemWord = c(rule === 'one' ? 'блюдо' : rule === 'few' ? 'блюда' : 'блюд', 'ta taom', quantity === 1 ? 'item' : 'items');
  const pricesUpdated = cart.some(item => cartLinePrice(item, quote.data?.items).updated);
  const quoteReady = quote.isSuccess && !quote.isFetching;
  const logo = quote.data?.restaurant.logoUrl ?? restaurant.data?.logoUrl;
  const estimate = restaurant.data?.deliveryEstimate;
  const timing = restaurant.data?.isOpen === false ? c('Сейчас закрыт', 'Hozir yopiq', 'Currently closed') : estimate ? '≈ ' + estimate.minMinutes + '–' + estimate.maxMinutes + ' ' + c('мин', 'daq', 'min') : address && restaurant.isPending ? c('Считаем время…', 'Vaqt hisoblanmoqda…', 'Estimating time…') : c('Выбрать адрес', 'Manzil tanlang', 'Choose address');
  const backTo = restaurantId ? '/restaurants/' + restaurantId : '/search';

  if (!user) return <div className="mx-auto max-w-lg py-20 text-center"><Icon name="orders"/><h1 className="mt-4 text-3xl font-semibold">{c('Ваши заказы', 'Buyurtmalaringiz', 'Your orders')}</h1><p className="my-5 text-sm text-[var(--muted)]">{c('Войдите, чтобы оформить заказ.', 'Buyurtma qilish uchun kiring.', 'Sign in to place an order.')}</p><Link className={primaryClass} to="/auth" state={{ from: '/orders' }}>{c('Войти', 'Kirish', 'Sign in')}</Link></div>;
  return <div className={'orders-page' + (active && cart.length === 0 ? ' orders-page--current' : '')}>
    <header className="cart-page-header"><Link to={backTo} aria-label={c('Вернуться в ресторан', 'Restoranga qaytish', 'Back to restaurant')}><Icon name="back" size={25}/></Link><h1>{cart.length ? c('Корзина', 'Savat', 'Your bag') : c('Заказы', 'Buyurtmalar', 'Orders')}</h1>{cart.length > 0 ? <button type="button" onClick={() => setConfirmClear(true)}>{c('Очистить', 'Tozalash', 'Clear')}</button> : <span aria-hidden="true"/>}</header>

    {orders.isPending ? <LoadingCards/> : orders.isError && !orders.data ? <div className="mb-6 space-y-3"><FormError message={friendlyError(orders.error)}/><button type="button" className={secondaryClass} onClick={() => void orders.refetch()}>{c('Повторить', 'Qayta urinish', 'Retry')}</button></div> : active && <section className="orders-current"><h2>{c('Текущий заказ', 'Joriy buyurtma', 'Current order')}</h2><OrderCard order={active} expanded onOpen={setSelectedOrder}/></section>}

    {(cart.length > 0 || (!active && !orders.isPending)) && <section className="cart-section" aria-label={c('Корзина', 'Savat', 'Your bag')}>
      {cart.length === 0 ? <div className="cart-empty"><span><Icon name="basket" size={35}/></span><h2>{c('Корзина пуста', 'Savat bo‘sh', 'Your bag is empty')}</h2><p>{c('Добавьте блюда из ленты или меню ресторана.', 'Tasma yoki restoran menyusidan taom qo‘shing.', 'Add dishes from the feed or a restaurant menu.')}</p><Link to="/search" className="food-primary">{c('Выбрать блюда', 'Taom tanlash', 'Explore food')}<Icon name="arrow" size={18}/></Link></div> : <>
        <div className="cart-restaurant-banner"><div className="cart-restaurant-logo">{logo ? <img src={logo} alt="" width="48" height="48"/> : <Icon name="restaurant" size={25}/>}</div><div><Link to={backTo}>{quote.data?.restaurant.name ?? restaurant.data?.name ?? c('Ваш ресторан', 'Restoraningiz', 'Your restaurant')}</Link><button type="button" onClick={() => { if (restaurant.isError) void restaurant.refetch(); else setAddressesOpen(true); }} aria-label={restaurant.isError ? c('Повторить расчёт времени', 'Vaqtni qayta hisoblash', 'Retry delivery estimate') : c('Выбрать адрес доставки', 'Yetkazish manzilini tanlash', 'Choose delivery address')} title={address?.addressText}><Icon name="clock" size={15}/>{restaurant.isError ? c('Повторить расчёт', 'Qayta hisoblash', 'Retry estimate') : timing}<Icon name="down" size={13}/></button></div></div>
        {pricesUpdated && quoteReady && <p role="status" className="cart-prices-notice">{c('Цены обновились. В корзине показана актуальная стоимость блюд.', 'Narxlar yangilandi. Savatda taomlarning joriy narxlari ko‘rsatilgan.', 'Prices have changed. Your bag shows the current dish prices.')}</p>}
        <div className="cart-layout"><div><div className="cart-items">{cart.map(item => {
          const price = cartLinePrice(item, quote.data?.items);
          return <article key={item.dishId} className="cart-item"><img src={item.imageUrl} alt="" width="78" height="78"/><div className="cart-item-description"><h2>{item.name}</h2><p>{money(price.unitPrice, language)} <span>{c('за шт.', 'dona uchun', 'each')}</span></p>{price.updated && <small>{money(item.price, language)}</small>}</div><div className="cart-item-right"><div className="cart-item-quantity"><button type="button" onClick={() => updateQuantity(item.dishId, item.quantity - 1)} aria-label={c('Уменьшить количество', 'Sonini kamaytirish', 'Decrease quantity') + ': ' + item.name}><Icon name="minus" size={17}/></button><span>{item.quantity}</span><button type="button" disabled={item.quantity >= 99} onClick={() => updateQuantity(item.dishId, item.quantity + 1)} aria-label={c('Увеличить количество', 'Sonini oshirish', 'Increase quantity') + ': ' + item.name}><Icon name="plus" size={17}/></button></div><strong>{money(price.total, language)}</strong></div></article>;
        })}</div><Link className="cart-add-more" to={backTo}><Icon name="plus" size={21}/>{c('Добавить ещё блюдо', 'Yana taom qo‘shish', 'Add another dish')}</Link></div>
        <aside className="cart-summary"><div className="cart-total-card"><div className="cart-total-meta"><span>{c('В корзине', 'Savatda', 'In your bag')}</span><span>{quantity} {itemWord}</span></div><div className="cart-total-line"><span>{quoteReady ? c('Итого', 'Jami', 'Total') : c('Предварительно', 'Taxminiy', 'Estimated total')}</span><strong>{money(quote.data?.total ?? total, language)}</strong></div></div>
          {quote.isPending && <p className="cart-calculation" role="status">{c('Рассчитываем итог…', 'Jami summa hisoblanmoqda…', 'Calculating total…')}</p>}
          {quote.isError && <div className="my-4 space-y-3"><FormError message={friendlyError(quote.error)}/><button type="button" className="order-details-button" onClick={() => void quote.refetch()}>{c('Обновить расчёт', 'Qayta hisoblash', 'Refresh total')}</button></div>}
          {active && <p className="cart-calculation">{c('Новый заказ можно оформить после завершения текущего. Корзина сохранена.', 'Joriy buyurtma tugagach, yangisini yaratish mumkin. Savat saqlangan.', 'You can place a new order after the current one is completed. Your bag is saved.')}</p>}
          <button type="button" className="food-primary cart-checkout-button" onClick={() => setCheckout(true)} disabled={Boolean(active) || !quoteReady || !quote.data || !quote.data.restaurant.isOpen || orders.isPending || orders.isError}>{c('Перейти к оформлению', 'Rasmiylashtirishga o‘tish', 'Continue to checkout')}</button>
          <p className="cart-restaurant-note">{c('Один заказ — один ресторан', 'Bir buyurtma — bitta restoran', 'One order · one restaurant')}</p>
        </aside></div>
      </>}
    </section>}

    {orders.data && orders.isError && <div className="mt-5 space-y-3"><FormError message={friendlyError(orders.error)}/><button type="button" className={secondaryClass} disabled={orders.isFetching} onClick={() => void orders.refetch()}>{c('Повторить', 'Qayta urinish', 'Retry')}</button></div>}
    {addressesOpen && <DeliveryAddressPicker onClose={() => setAddressesOpen(false)}/>}
    {checkout && quote.data && !quote.isError && !active && <CheckoutPanel quote={quote.data} onClose={() => setCheckout(false)} onComplete={created => { setCheckout(false); setSelectedOrder(created); }}/>}
    {selectedOrder && <OrderStatusModal order={selectedOrder} onClose={() => setSelectedOrder(null)}/>}
    {confirmClear && <Modal title={c('Очистить корзину?', 'Savatni tozalaysizmi?', 'Clear your bag?')} onClose={() => setConfirmClear(false)}><p className="mb-6 text-sm text-[var(--muted)]">{c('Все добавленные блюда будут удалены из корзины.', 'Qo‘shilgan barcha taomlar savatdan o‘chiriladi.', 'All items will be removed from your bag.')}</p><div className="flex gap-3"><button type="button" className={primaryClass + ' flex-1'} onClick={() => { clearCart(); setConfirmClear(false); }}>{c('Очистить', 'Tozalash', 'Clear bag')}</button><button type="button" className={secondaryClass} onClick={() => setConfirmClear(false)}>{c('Отмена', 'Bekor qilish', 'Cancel')}</button></div></Modal>}
  </div>;
}

export default OrdersPage;



