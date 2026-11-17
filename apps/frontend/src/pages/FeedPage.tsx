import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { Page, Post, RestaurantSummary } from '@uzbite/shared';
import { api, friendlyError } from '../lib/api';
import { allowsNextVideoPreload, selectVisibleReel, type NetworkHint, type ReelVisibility } from '../lib/media';
import { useApp } from '../context/AppContext';
import { Icon } from '../components/icons/Icon';
import { ReelCard } from '../components/ReelCard';
import { RestaurantCard } from '../components/RestaurantCard';
import { useCopy } from '../components/AccountPrimitives';
import { EmptyState, ErrorState } from '../components/UI';

type Connection = EventTarget & NetworkHint;
function connectionHint() { return (navigator as Navigator & { connection?: Connection }).connection; }

export default function FeedPage() {
  const { t } = useApp();
  const c = useCopy();
  const [params, setParams] = useSearchParams();
  const following = params.get('following') === 'true';
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [mobile, setMobile] = useState(() => matchMedia('(max-width: 767px), (max-width: 1023px) and (max-height: 500px)').matches);
  const [activePostId, setActivePostId] = useState<string | null>(null);
  const [allowPreload, setAllowPreload] = useState(() => allowsNextVideoPreload(connectionHint()));
  const feedRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const postId = params.get('post');
  const feed = useInfiniteQuery({
    queryKey: ['feed', following],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => (await api.get('/feed', { params: { following, page: pageParam } })).data.data as Page<Post>,
    getNextPageParam: lastPage => lastPage.hasMore ? lastPage.page + 1 : undefined,
  });
  const selected = useQuery({ queryKey: ['post', postId], queryFn: async () => (await api.get(`/posts/${encodeURIComponent(postId!)}`)).data.data as Post, enabled: Boolean(postId), retry: false });
  const restaurants = useQuery({ queryKey: ['restaurants', 'suggested'], queryFn: async () => (await api.get('/restaurants')).data.data as Page<RestaurantSummary> });
  const posts = useMemo(() => {
    const items = [...new Map((feed.data?.pages.flatMap(page => page.items) ?? []).map(post => [post.id, post])).values()];
    return postId && selected.data ? [selected.data, ...items.filter(post => post.id !== postId)] : items;
  }, [feed.data, postId, selected.data]);
  const postKey = posts.map(post => post.id).join('|');
  const activeIndex = posts.findIndex(post => post.id === activePostId);
  const nextVideoId = activeIndex >= 0 ? posts.slice(activeIndex + 1).find(post => post.media.some(media => media.type === 'VIDEO'))?.id : undefined;

  useEffect(() => {
    const query = matchMedia('(max-width: 767px), (max-width: 1023px) and (max-height: 500px)');
    const update = () => setMobile(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => { feedRef.current?.scrollTo({ top: 0 }); }, [following, postId]);
  useEffect(() => {
    if (!mobile || typeof IntersectionObserver === 'undefined' || !feed.hasNextPage || feed.isFetchingNextPage || feed.isFetchNextPageError || !moreRef.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void feed.fetchNextPage();
    }, { root: feedRef.current, rootMargin: '100% 0px' });
    observer.observe(moreRef.current);
    return () => observer.disconnect();
  }, [mobile, feed.hasNextPage, feed.isFetchingNextPage, feed.isFetchNextPageError, feed.fetchNextPage]);

  useEffect(() => {
    const connection = connectionHint();
    const update = () => setAllowPreload(allowsNextVideoPreload(connection));
    connection?.addEventListener('change', update);
    return () => connection?.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const elements = Array.from(feedRef.current?.querySelectorAll<HTMLElement>('[data-reel-id]') ?? []);
    const visibility = new Map<string, ReelVisibility>();
    const updateActive = () => setActivePostId(selectVisibleReel([...visibility.values()]));
    if (!elements.length) return;
    if (typeof IntersectionObserver === 'undefined') {
      // Manual viewport measurements keep playback usable in browsers without observers.
      let frame = 0;
      const scrollRoot = feedRef.current;
      const measure = () => {
        frame = 0;
        elements.forEach(element => {
          const rect = element.getBoundingClientRect();
          const id = element.dataset.reelId!;
          visibility.set(id, { id, ratio: Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0)) / Math.max(1, rect.height), distance: Math.abs(rect.top + rect.height / 2 - innerHeight / 2) });
        });
        updateActive();
      };
      const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
      measure(); scrollRoot?.addEventListener('scroll', schedule, { passive: true }); window.addEventListener('scroll', schedule, { passive: true }); window.addEventListener('resize', schedule);
      return () => { cancelAnimationFrame(frame); scrollRoot?.removeEventListener('scroll', schedule); window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); };
    }
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const id = (entry.target as HTMLElement).dataset.reelId!;
        visibility.set(id, { id, ratio: entry.isIntersecting ? entry.intersectionRatio : 0, distance: Math.abs(entry.boundingClientRect.top + entry.boundingClientRect.height / 2 - innerHeight / 2) });
      });
      updateActive();
    }, { root: mobile ? feedRef.current : null, threshold: [0, 0.15, 0.25, 0.4, 0.55, 0.7, 0.85, 1] });
    elements.forEach(element => observer.observe(element));
    return () => observer.disconnect();
  }, [postKey, mobile]);

  function clearSharedPost() { const next = new URLSearchParams(params); next.delete('post'); setParams(next, { replace: true }); }
  function changeFeed(value: boolean) { const next = new URLSearchParams(params); next.delete('post'); if (value) next.set('following', 'true'); else next.delete('following'); setParams(next); }

  return <section className="feed-page mx-auto w-full max-w-[1040px]">
    <div className="mb-7 hidden items-center justify-between gap-5 md:flex"><h1 className="text-3xl font-bold tracking-tight">{t('home')}</h1><div className="inline-flex rounded-full border border-[var(--border)] bg-[var(--surface)] p-1" aria-label={c('Выбор ленты', 'Tasma tanlash', 'Choose a feed')}>{[false, true].map(value => <button key={String(value)} type="button" onClick={() => changeFeed(value)} aria-pressed={following === value} className={['rounded-full px-5 py-2.5 text-xs font-bold transition', following === value ? 'bg-[var(--text)] text-[var(--surface)]' : 'text-[var(--muted)] hover:text-[var(--text)]'].join(' ')}>{t(value ? 'following' : 'feed')}</button>)}</div></div>
    <div className={`feed-mobile-overlay ${posts.length ? '' : 'feed-mobile-overlay--empty'}`}>
      <Link to="/feed" aria-label="UzBite" className="feed-overlay-brand">Uz<span>Bite</span></Link>
      <div className="feed-overlay-tabs" aria-label={c('Выбор ленты', 'Tasma tanlash', 'Choose a feed')}>
        {[false, true].map(value => <button key={String(value)} type="button" onClick={() => changeFeed(value)} aria-pressed={following === value}>{t(value ? 'following' : 'feed')}</button>)}
      </div>
    </div>
    <div className="feed-layout grid items-start gap-8 xl:grid-cols-[minmax(320px,460px)_minmax(260px,1fr)] 2xl:gap-12">
      <div ref={feedRef} aria-label={t(following ? 'following' : 'feed')} tabIndex={0} className="feed-viewport mx-auto w-full max-w-[460px]">
        {postId && selected.isPending && <div aria-busy="true" className="feed-placeholder skeleton mb-6 aspect-[9/14.2] w-full rounded-[28px]" />}
        {postId && selected.isError && <div className="mb-6"><ErrorState message={friendlyError(selected.error)} retry={() => void selected.refetch()} /><button type="button" className="button-secondary mt-3 w-full" onClick={clearSharedPost}>{c('Вернуться в ленту', 'Tasmaga qaytish', 'Back to the feed')}<Icon name="back" size={16} /></button></div>}
        {posts.map((post, index) => <ReelCard key={post.id} post={post} first={index === 0} active={activePostId === post.id} preloadNext={allowPreload && post.id === nextVideoId} onActivate={setActivePostId} audioEnabled={audioEnabled} onEnableAudio={() => setAudioEnabled(true)} />)}
        {feed.isPending && !(postId && selected.isPending) && <div aria-busy="true" className="feed-placeholder skeleton aspect-[9/14.2] w-full rounded-[28px]" />}
        {feed.isError && <div className="feed-message"><ErrorState message={friendlyError(feed.error)} retry={() => void feed.refetch()} /></div>}
        {!feed.isPending && !feed.isError && !posts.length && !(postId && selected.isPending) && <div className="feed-message"><EmptyState icon={following ? 'follow' : 'video'} title={t('noPosts')} description={following ? t('noFollowing') : undefined}><Link to="/search" className="button-primary">{t('explore')}</Link></EmptyState></div>}
        {feed.hasNextPage && <div ref={moreRef} className="feed-load-more"><button type="button" className="button-secondary mb-5 w-full" disabled={feed.isFetchingNextPage} aria-busy={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()}>{feed.isFetchingNextPage ? c('Загружаем…', 'Yuklanmoqda…', 'Loading…') : t('loadMore')}<Icon name="down" size={16} /></button></div>}
      </div>
      <aside className="sticky top-28 hidden space-y-6 xl:block">
        <div className="surface p-5"><div className="mb-5 flex items-center justify-between"><h2 className="text-sm font-extrabold tracking-tight">{t('forYou')}</h2><Link to="/search" aria-label={t('viewAll')} className="text-brand"><Icon name="arrow" size={18} /></Link></div><div className="space-y-3">{restaurants.isPending ? [0, 1, 2].map(item => <div key={item} className="skeleton h-20 rounded-2xl" />) : restaurants.isError ? <ErrorState message={friendlyError(restaurants.error)} retry={() => void restaurants.refetch()} /> : restaurants.data?.items.length ? restaurants.data.items.slice(0, 4).map(restaurant => <RestaurantCard key={restaurant.id} restaurant={restaurant} compact />) : <p className="text-xs text-[var(--muted)]">{t('empty')}</p>}</div><Link to="/search" className="mt-5 flex items-center justify-center gap-2 border-t border-[var(--border)] pt-4 text-xs font-bold text-brand">{t('viewAll')}<Icon name="arrow" size={15} /></Link></div>
        <p className="px-2 text-[10px] leading-relaxed text-[var(--muted)]">UzBite · {t('footer')}<br />© {new Date().getFullYear()} UzBite</p>
      </aside>
    </div>
  </section>;
}
