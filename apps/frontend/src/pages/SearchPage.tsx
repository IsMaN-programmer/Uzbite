import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CATALOG_CATEGORIES, DISCOVERY_SORTS, type DiscoverySort, type Page, type RestaurantSummary } from '@uzbite/shared';
import { api, friendlyError } from '../lib/api';
import { catalogCategoryLabel } from '../lib/discovery';
import { useApp } from '../context/AppContext';
import { Icon } from '../components/icons/Icon';
import { Wordmark } from '../components/Wordmark';
import { EmptyState, ErrorState, LoadingCards } from '../components/UI';
import { Modal, primaryClass, secondaryClass, useCopy } from '../components/AccountPrimitives';
import { DeliveryAddressPicker } from '../components/DeliveryAddressPicker';
import { useDeliveryAddress } from '../lib/delivery';
import { DiscoveryRestaurantCard } from '../components/DiscoveryRestaurantCard';

export default function SearchPage() {
  const { t, language } = useApp();
  const c = useCopy();
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const category = CATALOG_CATEGORIES.find(value => value === params.get('category'));
  const openOnly = params.get('open') === 'true';
  const sort = DISCOVERY_SORTS.find(value => value === params.get('sort')) ?? 'all';
  const view = params.get('view') === 'list' ? 'list' : 'cards';
  const page = /^\d+$/.test(params.get('page') ?? '') ? Math.max(1, Math.min(10000, Number(params.get('page')))) : 1;
  const [debounced, setDebounced] = useState(query);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [addressesOpen, setAddressesOpen] = useState(false);
  useEffect(() => { const timer = setTimeout(() => setDebounced(query), 300); return () => clearTimeout(timer); }, [query]);

  function update(values: Record<string, string | null>, resetPage = true) {
    setParams(previous => {
      const next = new URLSearchParams(previous);
      next.delete('freeDelivery');
      if (resetPage) next.delete('page');
      for (const [key, value] of Object.entries(values)) { if (value) next.set(key, value); else next.delete(key); }
      return next;
    }, { replace: true });
  }
  const delivery = useDeliveryAddress();
  const address = delivery.data?.address;
  const addressKey = address ? [address.id, address.latitude, address.longitude] : null;
  const result = useQuery({
    queryKey: ['restaurants', 'discovery', debounced, category, openOnly, sort, page, addressKey],
    enabled: delivery.isSuccess,
    queryFn: async ({ signal }) => (await api.get('/restaurants', { signal, params: { q: debounced, category, open: openOnly, sort, page } })).data.data as Page<RestaurantSummary>,
  });
  const filterCount = Number(openOnly) + Number(Boolean(category)) + Number(sort !== 'all');
  function resetFilters() { update({ open: null, category: null, sort: null }); }
  const sortLabels: Record<DiscoverySort, string> = {
    all: t('all'),
    'price-asc': c('Самая низкая цена', 'Eng past narx', 'Lowest price'),
    'price-desc': c('Самая высокая цена', 'Eng yuqori narx', 'Highest price'),
    popular: c('По числу подписчиков', 'Obunachilar soni bo‘yicha', 'Most followed'),
    rating: c('По высокой оценке', 'Eng yuqori baho', 'Highest rated'),
  };

  return <section className="discovery-page" aria-labelledby="search-title">
    <header className="discovery-brand-row"><Wordmark withIcon/><h1 id="search-title">{t('search')}</h1></header>
    <button type="button" className="discovery-address" onClick={() => setAddressesOpen(true)} aria-label={c('Выбрать адрес доставки', 'Yetkazish manzilini tanlash', 'Choose delivery address')}>
      <Icon name="location" size={17}/><span>{address ? c('Доставка в', 'Yetkazish', 'Deliver to') : c('Доставка', 'Yetkazish', 'Delivery')}</span>
      <strong>{delivery.isPending ? c('Загружаем адрес…', 'Manzil yuklanmoqda…', 'Loading address…') : address?.addressText ?? c('Выбрать адрес', 'Manzilni tanlang', 'Choose address')}</strong><Icon name="down" size={14}/>
    </button>
    {delivery.isError && <button type="button" className="mb-4 text-xs text-brand" onClick={() => void delivery.refetch()}>{c('Не удалось загрузить адрес. Повторить', 'Manzil yuklanmadi. Qayta urinish', 'Could not load the address. Retry')}</button>}
    <div className="discovery-search" role="search">
      <Icon name="search" size={22}/><input type="search" aria-label={t('searchPlaceholder')} value={query} onChange={event => update({ q: event.target.value })} placeholder={t('searchPlaceholder')}/>
      {query && <button type="button" onClick={() => update({ q: null })} aria-label={c('Очистить поиск', 'Qidiruvni tozalash', 'Clear search')}><Icon name="close" size={18}/></button>}
    </div>
    <div className="discovery-results-header">
      <div><h2>{query || category ? c('Результаты поиска', 'Qidiruv natijalari', 'Search results') : c('Рестораны рядом', 'Yaqin restoranlar', 'Restaurants nearby')}</h2><p>{category ? catalogCategoryLabel(category, language) : c('Найдите свой любимый вкус', 'Sevimli ta’mingizni toping', 'Find your favorite taste')}</p></div>
      <button type="button" className="discovery-filter-button" aria-label={c('Фильтры и сортировка', 'Filtrlar va saralash', 'Filters and sorting')} aria-haspopup="dialog" onClick={() => setFiltersOpen(true)}><Icon name="filter" size={21}/>{filterCount > 0 && <span>{filterCount}</span>}</button>
    </div>
    <p className="sr-only" role="status">{c('Найдено ресторанов', 'Topilgan restoranlar', 'Restaurants found')}: {result.data?.total ?? '…'}</p>
    <div aria-busy={result.isFetching} className={view === 'cards' ? 'discovery-cards' : 'discovery-list'}>
      {result.isPending ? <LoadingCards/> : result.isError ? <ErrorState message={friendlyError(result.error)} retry={() => void result.refetch()}/> : !result.data.items.length ? <EmptyState icon="search" title={t('noResults')} description={filterCount > 0 ? c('Измените выбранные фильтры.', 'Tanlangan filtrlarni o‘zgartiring.', 'Try changing your filters.') : t('noResultsText')}>{filterCount > 0 && <button type="button" className={secondaryClass} onClick={resetFilters}>{c('Сбросить фильтры', 'Filtrlarni tozalash', 'Reset filters')}</button>}</EmptyState> : result.data.items.map(restaurant => <DiscoveryRestaurantCard key={restaurant.id} restaurant={restaurant} view={view}/>)}
    </div>
    {(page > 1 || result.data?.hasMore) && <div className="mt-7 flex justify-center gap-4">
      {page > 1 && <button type="button" className="button-secondary" onClick={() => { update({ page: String(page - 1) }, false); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><Icon name="back" size={17}/>{page - 1}</button>}
      {result.data?.hasMore && <button type="button" className="button-secondary" onClick={() => { update({ page: String(page + 1) }, false); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>{t('loadMore')}<Icon name="arrow" size={17}/></button>}
    </div>}
    {addressesOpen && <DeliveryAddressPicker onClose={() => setAddressesOpen(false)}/>}
    {filtersOpen && <Modal title={c('Фильтры и сортировка', 'Filtrlar va saralash', 'Filters and sorting')} onClose={() => setFiltersOpen(false)}>
      <div className="space-y-6">
        <label className="flex min-h-11 items-center justify-between gap-4 text-sm"><span>{c('Только открытые рестораны', 'Faqat ochiq restoranlar', 'Open restaurants only')}</span><input type="checkbox" checked={openOnly} onChange={event => update({ open: event.target.checked ? 'true' : null })} className="size-5 accent-brand"/></label>
        <fieldset><legend className="mb-3 text-sm font-semibold">{c('Категория', 'Toifa', 'Category')}</legend>
          <div className="flex flex-wrap gap-2"><button type="button" className="food-chip" aria-pressed={!category} onClick={() => update({ category: null })}>{t('all')}</button>{CATALOG_CATEGORIES.map(value => <button type="button" key={value} className="food-chip" aria-pressed={category === value} onClick={() => update({ category: value })}>{catalogCategoryLabel(value, language)}</button>)}</div>
        </fieldset>
        <label className="grid gap-3 text-sm font-semibold">{c('Сортировка', 'Saralash', 'Sort by')}<select className="input" value={sort} onChange={event => update({ sort: event.target.value === 'all' ? null : event.target.value })}>{DISCOVERY_SORTS.map(value => <option value={value} key={value}>{sortLabels[value]}</option>)}</select></label>
        <fieldset><legend className="mb-3 text-sm font-semibold">{c('Вид ресторанов', 'Restoran ko‘rinishi', 'Restaurant view')}</legend><div className="flex gap-3"><button type="button" className="food-chip" aria-pressed={view === 'cards'} onClick={() => update({ view: null }, false)}><Icon name="cardView" size={17}/>{c('Карточки', 'Kartochkalar', 'Cards')}</button><button type="button" className="food-chip" aria-pressed={view === 'list'} onClick={() => update({ view: 'list' }, false)}><Icon name="listView" size={17}/>{c('Список', 'Ro‘yxat', 'List')}</button></div></fieldset>
        <div className="flex gap-3 border-t border-[var(--border)] pt-5"><button type="button" className={secondaryClass} onClick={resetFilters}>{c('Сбросить', 'Tozalash', 'Reset')}</button><button type="button" className={primaryClass + ' flex-1'} onClick={() => setFiltersOpen(false)}>{c('Показать', 'Ko‘rsatish', 'Show')}{result.data && ' · ' + result.data.total}</button></div>
      </div>
    </Modal>}
  </section>;
}
