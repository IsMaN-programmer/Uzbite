import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { Post, RestaurantSummary } from '@uzbite/shared';
import { api, friendlyError } from '../lib/api';
import { nextCollectionPage, type PaginatedCollection } from '../lib/pagination';
import { FormError, LoadingCards, secondaryClass, useCopy } from './AccountPrimitives';
import { Icon } from './icons/Icon';

type CollectionSection = 'likes' | 'follows';

function ProfileCollection<T>({ section, empty, children }: {
  section: CollectionSection;
  empty: ReactNode;
  children: (items: T[]) => ReactNode;
}) {
  const c = useCopy();
  const result = useInfiniteQuery({
    queryKey: ['profile', section],
    initialPageParam: 1,
    queryFn: async ({ pageParam, signal }) => (await api.get<PaginatedCollection<T>>(`/profile/${section}`, { signal, params: { page: pageParam, pageSize: 12 } })).data,
    getNextPageParam: nextCollectionPage,
  });
  const items = result.data?.pages.flatMap(page => page.data) ?? [];
  if (result.isPending) return <LoadingCards/>;
  return <>
    {items.length ? children(items) : !result.isError && empty}
    {result.isError && <div className="mt-5 space-y-3">
      <FormError message={friendlyError(result.error)}/>
      <button type="button" className={secondaryClass} disabled={result.isFetching} onClick={() => { if (result.isFetchNextPageError) void result.fetchNextPage(); else void result.refetch(); }}>
        {c('Повторить', 'Qayta urinish', 'Try again')}
      </button>
    </div>}
    {result.hasNextPage && !result.isFetchNextPageError && <button type="button" disabled={result.isFetching} onClick={() => void result.fetchNextPage()} className={`${secondaryClass} mt-5 w-full`}>
      {result.isFetchingNextPage ? c('Загружаем…', 'Yuklanmoqda…', 'Loading…') : c('Показать ещё', 'Yana ko‘rsatish', 'Load more')}
      <Icon name="down" size={16}/>
    </button>}
  </>;
}

export function ProfileLikes() {
  const c = useCopy();
  return <ProfileCollection<Post> section="likes" empty={<EmptyCollection icon="heart" title={c('Нет понравившихся публикаций', 'Yoqtirilgan postlar yo‘q', 'No liked posts')} text={c('Лайкайте публикации, чтобы возвращаться к ним здесь.', 'Postlarga layk bosing va ularga shu yerdan qayting.', 'Like posts to find them here later.')}/> }>
    {posts => <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {posts.map(post => {
        const thumbnail = post.media.find(media => media.posterUrl)?.posterUrl || post.dish?.imageUrl || post.restaurant.coverUrl;
        return <Link key={post.id} to={`/feed?post=${encodeURIComponent(post.id)}`} className="group relative aspect-[3/4] overflow-hidden rounded-2xl bg-[var(--surface)]">
          <img src={thumbnail} alt="" loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-105"/>
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent"/>
          {post.media.some(media => media.type === 'VIDEO') && <span className="absolute left-3 top-3 flex size-7 items-center justify-center rounded-full bg-black/20 text-white backdrop-blur-md"><Icon name="video" size={14}/></span>}
          <div className="absolute inset-x-3 bottom-3 text-white"><p className="truncate text-xs font-semibold">{post.dish?.name || post.caption}</p><p className="mt-1 truncate text-[10px] text-white/70">{post.restaurant.name}</p></div>
        </Link>;
      })}
    </div>}
  </ProfileCollection>;
}

export function ProfileFollowing() {
  const c = useCopy();
  return <ProfileCollection<RestaurantSummary> section="follows" empty={<EmptyCollection icon="restaurant" title={c('Пока нет подписок', 'Hozircha obunalar yo‘q', 'No subscriptions yet')} text={c('Подпишитесь на ресторан, чтобы видеть его новые публикации.', 'Yangi postlarni ko‘rish uchun restoranga obuna bo‘ling.', 'Follow a restaurant to see its latest posts.')}/> }>
    {restaurants => <>
      <Link to="/feed?following=true" className={`${secondaryClass} mb-4 w-full`}><Icon name="video" size={18}/>{c('Лента подписок', 'Obunalar tasmasi', 'Following feed')}</Link>
      <div className="profile-following-list">{restaurants.map(restaurant => <Link to={`/restaurants/${restaurant.id}`} key={restaurant.id}>
        <img src={restaurant.logoUrl || restaurant.coverUrl} alt="" width="52" height="52" loading="lazy"/>
        <div><h2>{restaurant.name}</h2><p>{restaurant.addressText}</p></div>
        <Icon name="chevron" size={17}/>
      </Link>)}</div>
    </>}
  </ProfileCollection>;
}

function EmptyCollection({ icon, title, text }: { icon: string; title: string; text: string }) {
  const c = useCopy();
  return <div className="profile-collection-empty">
    <Icon name={icon} size={32}/>
    <h2>{title}</h2>
    <p>{text}</p>
    <Link to="/search" className={secondaryClass}>{c('Открыть рестораны', 'Restoranlarni ochish', 'Explore restaurants')}<Icon name="arrow" size={17}/></Link>
  </div>;
}
