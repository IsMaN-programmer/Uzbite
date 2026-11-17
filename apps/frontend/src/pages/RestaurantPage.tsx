import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { RestaurantSummary, Dish, Post } from '@uzbite/shared';
import { api, friendlyError, money } from '../lib/api';
import { dishArtwork, restaurantPhotos } from '../lib/catalogArtwork';
import { categoryLabel } from '../lib/discovery';
import { useApp } from '../context/AppContext';
import { Icon } from '../components/icons/Icon';
import { MapLink } from '../components/RestaurantCard';
import { useCopy } from '../components/AccountPrimitives';
import { EmptyState, ErrorState, LoadingCards } from '../components/UI';

interface Review { id: string; rating: number; text: string; user: { name: string }; createdAt: string }
interface RestaurantDetail extends RestaurantSummary { categories: { id: string; name: string }[]; dishes: Dish[]; posts: Post[]; reviews: Review[] }

function russianCountWord(value: number, one: string, few: string, many: string) {
  const rule = new Intl.PluralRules('ru').select(value);
  return rule === 'one' ? one : rule === 'few' ? few : many;
}

export default function RestaurantPage() {
  const { id } = useParams();
  const { t, language, addItem, notify } = useApp();
  const c = useCopy();
  const client = useQueryClient();
  const [tab, setTab] = useState<'posts' | 'menu' | 'reviews'>('posts');
  const [category, setCategory] = useState('');
  const [photoIndex, setPhotoIndex] = useState(0);
  const galleryRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setTab('posts'); setCategory(''); setPhotoIndex(0); galleryRef.current?.scrollTo({ left: 0 }); }, [id]);
  const result = useQuery({ queryKey: ['restaurant', id], queryFn: async ({ signal }) => (await api.get('/restaurants/' + id, { signal })).data.data as RestaurantDetail });
  const follow = useMutation({
    mutationFn: () => api.put('/restaurants/' + result.data!.id + '/follow', { following: !result.data?.isFollowing }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['restaurant', id] });
      void client.invalidateQueries({ queryKey: ['restaurants'] });
      void client.invalidateQueries({ queryKey: ['feed'] });
      void client.invalidateQueries({ queryKey: ['profile'] });
    },
    onError: error => notify(friendlyError(error)),
  });

  if (result.isPending) return <LoadingCards/>;
  if (result.isError) return <ErrorState message={friendlyError(result.error)} retry={() => void result.refetch()}/>;
  const r = result.data;
  const photos = restaurantPhotos(r);
  function showPhoto(index: number) {
    const gallery = galleryRef.current;
    if (!gallery) return;
    gallery.scrollTo({ left: index * gallery.clientWidth, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }
  const dishes = r.dishes.filter(dish => !category || dish.categoryId === category);
  const posts = r.posts.filter(post => !category || post.dish?.categoryId === category);
  const currency = language === 'en' ? 'UZS' : language === 'uz' ? 'so‘m' : 'сум';
  const number = (value: number) => new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(value);
  const reviewWord = c(russianCountWord(r.reviewCount, 'отзыв', 'отзыва', 'отзывов'), 'ta sharh', r.reviewCount === 1 ? 'review' : 'reviews');
  const followerWord = c(russianCountWord(r.followerCount, 'подписчик', 'подписчика', 'подписчиков'), 'obunachi', r.followerCount === 1 ? 'follower' : 'followers');

  return <section className="restaurant-page animate-enter" aria-labelledby="restaurant-name">
    <header className="restaurant-topbar"><Link to="/search" className="restaurant-back" aria-label={c('Вернуться к поиску', 'Qidiruvga qaytish', 'Back to search')}><Icon name="back" size={22}/></Link><span>{c('Ресторан', 'Restoran', 'Restaurant')}</span></header>
    <div className="restaurant-cover" role="region" aria-label={c('Фотографии ресторана', 'Restoran rasmlari', 'Restaurant photos')}>
      <div className="restaurant-gallery hide-scrollbar" ref={galleryRef} onScroll={event => { const element = event.currentTarget; if (element.clientWidth) setPhotoIndex(Math.min(photos.length - 1, Math.max(0, Math.round(element.scrollLeft / element.clientWidth)))); }}>
        {photos.map((photo, index) => <div className="restaurant-gallery-slide" key={photo}><img src={photo} alt={r.name + ' · ' + c('фото', 'rasm', 'photo') + ' ' + (index + 1)} width="1000" height="500" loading={index === 0 ? 'eager' : 'lazy'} fetchPriority={index === 0 ? 'high' : 'auto'} draggable={false}/></div>)}
      </div>
      {photos.length > 1 && <><span className="restaurant-gallery-counter" aria-live="polite">{photoIndex + 1} / {photos.length}</span><button type="button" className="restaurant-gallery-arrow restaurant-gallery-arrow--previous" aria-label={c('Предыдущее фото', 'Oldingi rasm', 'Previous photo')} disabled={photoIndex === 0} onClick={() => showPhoto(photoIndex - 1)}><Icon name="back" size={22}/></button><button type="button" className="restaurant-gallery-arrow restaurant-gallery-arrow--next" aria-label={c('Следующее фото', 'Keyingi rasm', 'Next photo')} disabled={photoIndex === photos.length - 1} onClick={() => showPhoto(photoIndex + 1)}><Icon name="chevron" size={22}/></button><div className="restaurant-gallery-dots" role="group" aria-label={c('Выбор фотографии', 'Rasmni tanlash', 'Choose a photo')}>{photos.map((photo, index) => <button key={photo} type="button" aria-label={c('Фото', 'Rasm', 'Photo') + ' ' + (index + 1)} aria-pressed={index === photoIndex} onClick={() => showPhoto(index)}><span/></button>)}</div></>}
    </div>
    <div className="restaurant-summary">
      <img src={r.logoUrl} alt="" className="restaurant-avatar" width="88" height="88"/>
      <h1 id="restaurant-name">{r.name}</h1>
      <p className="restaurant-description">{r.description}</p>
      <div className="restaurant-stats">
        <button type="button" className="restaurant-reviews-link" onClick={() => { setTab('reviews'); setCategory(''); }} aria-label={c('Посмотреть отзывы', 'Sharhlarni ko‘rish', 'Read reviews')}><Icon name="star" size={20} filled/><strong>{r.rating !== null ? number(r.rating) : t('new')}</strong><span>· {r.reviewCount} {reviewWord}</span></button>
        <span className="restaurant-followers"><Icon name="followers" size={19}/>{number(r.followerCount)} {followerWord}</span>
        <span className={'food-status ' + (r.isOpen ? 'food-status--open' : '')}><span className="food-status-dot"/>{t(r.isOpen ? 'open' : 'closed')}</span>
      </div>
      <div className="restaurant-location"><p><Icon name="location" size={20}/><span>{r.addressText}</span></p><MapLink restaurant={r} className="restaurant-map"/></div>
      <button type="button" className={r.isFollowing ? 'restaurant-follow restaurant-follow--active' : 'food-primary restaurant-follow'} onClick={() => follow.mutate()} disabled={follow.isPending}>{follow.isPending ? c('Подождите…', 'Kuting…', 'Please wait…') : t(r.isFollowing ? 'unfollow' : 'follow')}</button>
      {r.phone && <a className="restaurant-contact" href={'tel:' + r.phone}>{r.phone}</a>}
    </div>

    <div className="restaurant-tabs" role="group" aria-label={c('Раздел ресторана', 'Restoran bo‘limi', 'Restaurant section')}>
      {(['posts', 'menu'] as const).map(value => <button key={value} type="button" aria-pressed={tab === value} onClick={() => { setTab(value); setCategory(''); }}>{t(value)}</button>)}
    </div>
    {tab !== 'reviews' && <div className="restaurant-categories hide-scrollbar" role="group" aria-label={c('Категории блюд', 'Taom toifalari', 'Dish categories')}><button type="button" className="food-chip" aria-pressed={!category} onClick={() => setCategory('')}>{t('all')}</button>{r.categories.map(item => <button key={item.id} type="button" className="food-chip" aria-pressed={category === item.id} onClick={() => setCategory(item.id)}>{categoryLabel(item.name, language)}</button>)}</div>}

    {tab === 'posts' && (posts.length === 0 ? <EmptyState icon="video" title={category ? t('noResults') : t('noPosts')}><button type="button" className="button-secondary" onClick={() => { setTab('menu'); setCategory(''); }}>{t('menu')}<Icon name="arrow" size={17}/></button></EmptyState> : <div className="restaurant-publications">{posts.map(post => {
      const media = post.media[0];
      const image = post.dish && (post.dish.id === 'dish-plov' || post.dish.id === 'dish-samsa') ? dishArtwork(post.dish) : media?.posterUrl ?? (media?.type === 'IMAGE' ? media.url : null) ?? post.dish?.imageUrl ?? r.coverUrl;
      return <Link key={post.id} to={'/feed?post=' + post.id} className="restaurant-publication" aria-label={post.dish ? post.dish.name + ', ' + money(post.dish.price, language) + ' ' + currency : post.caption}>
        <img src={image} alt="" loading="lazy" width="570" height="400"/>
        {media?.type === 'VIDEO' && <span className="restaurant-play"><Icon name="play" size={19} filled/></span>}
        <span className="restaurant-post-caption"><span>{post.dish?.name ?? post.caption}</span>{post.dish && <strong>{money(post.dish.price, language)} {currency}</strong>}</span>
      </Link>;
    })}</div>)}

    {tab === 'menu' && (dishes.length === 0 ? <EmptyState title={category ? t('noResults') : t('empty')}/> : <div className="restaurant-menu">{dishes.map(dish => <article key={dish.id} className="restaurant-dish">
      <img src={dishArtwork(dish)} alt="" className="restaurant-dish-photo" loading="lazy" width="570" height="400"/>
      <div className="restaurant-dish-body"><h2>{dish.name}</h2><p>{dish.description}</p><div className="restaurant-dish-order"><strong>{money(dish.price, language)} <span>{currency}</span></strong><button type="button" onClick={() => addItem({ ...dish, imageUrl: dishArtwork(dish) })} disabled={!dish.isAvailable || !r.isOpen} aria-label={t('add') + ': ' + dish.name}><Icon name="plus" size={21}/></button></div>{!dish.isAvailable && <p>{t('unavailable')}</p>}</div>
    </article>)}</div>)}

    {tab === 'reviews' && <div className="restaurant-review-section"><div className="mb-5 flex items-center justify-between gap-4"><h2 className="text-xl font-bold">{t('reviews')}</h2><button type="button" className="text-sm text-brand" onClick={() => setTab('posts')}>{t('posts')}</button></div>{r.reviews.length === 0 ? <EmptyState icon="star" title={t('noReviews')}/> : <div className="space-y-4">{r.reviews.map(review => <article key={review.id} className="surface p-5"><div className="flex items-center justify-between gap-3"><strong className="min-w-0 truncate text-sm">{review.user.name}</strong><span className="flex shrink-0 gap-1 text-brand" aria-label={review.rating + ' / 5'}>{Array.from({ length: review.rating }, (_, index) => <Icon key={index} name="star" size={14} filled/>)}</span></div><p className="mt-2 flex items-center gap-1 text-[10px] font-semibold text-[#5d875a]"><Icon name="shield" size={12}/>{t('verified')}</p><p className="mt-4 break-words text-sm leading-relaxed">{review.text}</p></article>)}</div>}</div>}
  </section>;
}

