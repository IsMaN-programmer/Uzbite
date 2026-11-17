import { Link } from 'react-router-dom';
import type { RestaurantSummary } from '@uzbite/shared';
import { useApp } from '../context/AppContext';
import { restaurantArtwork } from '../lib/catalogArtwork';
import { categoryLabel } from '../lib/discovery';
import { Icon } from './icons/Icon';
import { useCopy } from './AccountPrimitives';
import { MapLink } from './RestaurantCard';

export function DiscoveryRestaurantCard({ restaurant, view }: { restaurant: RestaurantSummary; view: 'cards' | 'list' }) {
  const { language, t } = useApp();
  const c = useCopy();
  const estimate = restaurant.deliveryEstimate;
  const cuisine = restaurant.cuisines?.slice(0, 2).map(name => categoryLabel(name, language)).join(' · ');
  const timing = !restaurant.isOpen ? t('closed') : estimate ? '≈ ' + estimate.minMinutes + '–' + estimate.maxMinutes + ' ' + c('мин', 'daq', 'min') : c('Укажите адрес', 'Manzil tanlang', 'Choose address');
  const estimateHint = estimate ? c('Примерное время с учётом приготовления и расстояния до выбранного адреса.', 'Tayyorlash va tanlangan manzilgacha masofaga asoslangan taxminiy vaqt.', 'Estimated time including preparation and distance to your selected address.') : undefined;
  const path = '/restaurants/' + restaurant.id;
  const rating = <span className="discovery-rating"><Icon name="star" size={15} filled/>{restaurant.rating !== null ? new Intl.NumberFormat(language === 'en' ? 'en-US' : language === 'uz' ? 'uz-UZ' : 'ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(restaurant.rating) : t('new')}</span>;

  if (view === 'list') return <Link to={path} className="discovery-list-card" aria-label={restaurant.name + ', ' + timing}>
    <img src={restaurantArtwork(restaurant)} alt="" loading="lazy" width="68" height="68"/>
    <div className="min-w-0 flex-1"><h3>{restaurant.name}</h3><div className="discovery-list-meta">{rating}<span className="truncate">{cuisine}</span></div></div>
    <div className="discovery-list-fee"><span title={estimateHint}>{timing}</span></div>
  </Link>;

  return <article className="discovery-restaurant-card">
    <Link to={path} className="discovery-restaurant-photo" aria-label={restaurant.name}><img src={restaurantArtwork(restaurant)} alt="" loading="lazy" width="564" height="560"/></Link>
    <div className="discovery-restaurant-info">
      <Link to={path} className="discovery-restaurant-name"><h3>{restaurant.name}</h3></Link>
      <div className="discovery-restaurant-status">{rating}<span className="discovery-status-divider"/><span className={'food-status ' + (restaurant.isOpen ? 'food-status--open' : '')}>{t(restaurant.isOpen ? 'open' : 'closed')}</span></div>
      {cuisine && <p className="discovery-restaurant-cuisine">{cuisine}</p>}
      <p className="discovery-restaurant-location"><Icon name="location" size={15}/><span>{c('Ташкент', 'Toshkent', 'Tashkent')}</span>{estimate && <span>· {new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(estimate.distanceKm)} {c('км', 'km', 'km')}</span>}</p>
      <p className="discovery-restaurant-delivery" title={estimateHint}><Icon name="clock" size={14}/><span>{timing}</span></p>
      <div className="discovery-restaurant-actions"><MapLink restaurant={restaurant} className="discovery-card-map" icon="location"/><Link to={path} className="food-primary discovery-card-view" aria-label={t('view') + ': ' + restaurant.name}><Icon name="eye" size={16}/>{t('view')}</Link></div>
    </div>
  </article>;
}
