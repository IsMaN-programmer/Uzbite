import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Post } from '@uzbite/shared';
import { api, friendlyError, money } from '../lib/api';
import { dishArtwork } from '../lib/catalogArtwork';
import { playbackFailure } from '../lib/media';
import { copyShareLink, shareLink } from '../lib/share';
import { useApp } from '../context/AppContext';
import { Icon } from './icons/Icon';
import { CommentsSheet } from './CommentsSheet';
import { inputClass, Modal, useCopy } from './AccountPrimitives';
import { ReelDishDetails } from './ReelDishDetails';

interface ReelCardProps {
  post: Post;
  first?: boolean;
  active?: boolean;
  preloadNext?: boolean;
  onActivate?: (postId: string) => void;
  audioEnabled: boolean;
  onEnableAudio: () => void;
}

export function ReelCard({ post, first = false, active = false, preloadNext = false, onActivate, audioEnabled, onEnableAudio }: ReelCardProps) {
  const { t, language, addItem, notify } = useApp();
  const c = useCopy();
  const client = useQueryClient();
  const video = useRef<HTMLVideoElement>(null);
  const gallery = useRef<HTMLDivElement>(null);
  const detailsId = useId();
  const playAttempt = useRef(0);
  const mayPlay = useRef(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const muted = !audioEnabled || audioBlocked;
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [sourceLoaded, setSourceLoaded] = useState(first);
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);
  const [pausedByUser, setPausedByUser] = useState(false);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [failed, setFailed] = useState(false);
  const [comments, setComments] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [showingPhoto, setShowingPhoto] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [copying, setCopying] = useState(false);
  const media = post.media.find(item => item.type === 'VIDEO');
  const dish = post.dish;
  const canOrder = Boolean(dish?.isAvailable && post.restaurant.isOpen);
  const dishPhoto = dish ? dishArtwork(dish) : undefined;
  const image = media?.posterUrl || post.media.find(item => item.type === 'IMAGE')?.url || dishPhoto || post.restaurant.coverUrl;
  const hasGallery = Boolean(media && dishPhoto);
  const photoSelected = hasGallery && showingPhoto;
  const title = dish?.name ?? post.caption;
  const description = dish?.description.trim();
  const loadSource = sourceLoaded || active || preloadNext || first;
  const canPlay = active && pageVisible && !pausedByUser && !comments && !photoSelected && !sharing && !shareOpen && !failed;
  mayPlay.current = canPlay;
  const shareUrl = `${location.origin}/feed?post=${encodeURIComponent(post.id)}`;
  const landscape = Boolean(media?.width && media.height && media.width > media.height);

  useEffect(() => { if (active || preloadNext || first) setSourceLoaded(true); }, [active, preloadNext, first]);
  useEffect(() => { setFailed(false); setNeedsGesture(false); }, [media?.url]);

  const requestPlay = useCallback(async () => {
    const element = video.current;
    if (!element) return;
    const attempt = ++playAttempt.current;
    setBuffering(element.readyState < HTMLMediaElement.HAVE_FUTURE_DATA);
    try {
      try { await element.play(); }
      catch (error) {
        // Autoplay can require silence; a tap on the video enables audio.
        if (playbackFailure(error) !== 'permission' || element.muted) throw error;
        element.muted = true;
        setAudioBlocked(true);
        await element.play();
      }
      if (attempt !== playAttempt.current) return;
      if (!mayPlay.current) { element.pause(); return; }
      setNeedsGesture(false); setPlaying(true);
    } catch (error: unknown) {
      if (attempt !== playAttempt.current) return;
      setPlaying(false); setBuffering(false);
      const reason = playbackFailure(error);
      if (reason === 'unsupported') setFailed(true);
      else if (reason !== 'interrupted') setNeedsGesture(true);
    }
  }, []);

  useEffect(() => {
    if (canPlay && loadSource) void requestPlay();
    else { ++playAttempt.current; video.current?.pause(); setPlaying(false); setBuffering(false); }
  }, [canPlay, loadSource, requestPlay]);

  useEffect(() => {
    const visibilityChanged = () => {
      if (document.hidden) { mayPlay.current = false; ++playAttempt.current; video.current?.pause(); }
      setPageVisible(!document.hidden);
    };
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => { document.removeEventListener('visibilitychange', visibilityChanged); ++playAttempt.current; };
  }, []);

  const like = useMutation({
    mutationFn: () => api.put(`/posts/${post.id}/like`, { liked: !post.isLiked }),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ['feed'] }); void client.invalidateQueries({ queryKey: ['post'] }); void client.invalidateQueries({ queryKey: ['profile'] }); },
    onError: error => notify(friendlyError(error)),
  });

  async function share() {
    setSharing(true);
    try {
      const result = await shareLink({ title: `${post.restaurant.name} · UzBite`, text: post.dish?.name ?? post.caption, url: shareUrl });
      if (result === 'copied') notify(t('copied'));
      if (result === 'manual') setShareOpen(true);
    } finally { setSharing(false); }
  }

  function toggle() {
    const element = video.current;
    if (!element) return;
    if (element.muted) {
      element.muted = false;
      setAudioBlocked(false); onEnableAudio();
      setPausedByUser(false); setNeedsGesture(false);
      onActivate?.(post.id);
      mayPlay.current = !document.hidden && !comments && !photoSelected && !shareOpen;
      void requestPlay();
      return;
    }
    if (!element.paused) { setPausedByUser(true); ++playAttempt.current; element.pause(); }
    else {
      setPausedByUser(false); setNeedsGesture(false);
      onActivate?.(post.id);
      // Keep play() inside the click gesture for browsers that block autoplay.
      mayPlay.current = !document.hidden && !comments && !photoSelected && !shareOpen;
      void requestPlay();
    }
  }

  function retryVideo() {
    setFailed(false); setNeedsGesture(false); setPausedByUser(false);
    onActivate?.(post.id);
    mayPlay.current = !document.hidden;
    video.current?.load();
    void requestPlay();
  }

  function showMedia(index: number) {
    const slider = gallery.current;
    if (!slider) return;
    const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
    slider.scrollTo({ left: index * slider.clientWidth, behavior });
  }

  return <article data-reel-id={post.id} className="reel relative isolate mx-auto mb-6 aspect-[9/14.6] max-h-[740px] w-[min(100%,clamp(310px,calc((100dvh-260px)*.64),460px))] overflow-hidden rounded-[28px] bg-[#25271e] text-white shadow-[0_14px_50px_-20px_#25251a50] sm:aspect-[9/14.2]">
    <div ref={gallery} className={`reel-media hide-scrollbar${hasGallery ? ' reel-media--gallery' : ''}`} onScroll={event => {
      const slider = event.currentTarget;
      setShowingPhoto(slider.scrollLeft > slider.clientWidth / 2);
    }}>
      <div className="reel-frame" aria-hidden={photoSelected || undefined}>
        <img src={image} alt={media ? '' : title} className={`absolute inset-0 h-full w-full object-cover ${landscape ? 'scale-110 blur-xl brightness-50' : ''}`} loading={first ? 'eager' : 'lazy'}/>
        {media && <video
          ref={video}
          src={loadSource ? media.url : undefined}
          poster={image}
          muted={muted}
          loop
          playsInline
          preload={active || preloadNext ? 'auto' : first || sourceLoaded ? 'metadata' : 'none'}
          className={`reel-video absolute inset-0 h-full w-full ${landscape ? 'object-contain' : 'object-cover'} ${failed ? 'opacity-0' : ''}`}
          onError={() => {
            if (video.current?.error?.code === MediaError.MEDIA_ERR_ABORTED) return;
            setFailed(true);
            setPlaying(false);
            setBuffering(false);
          }}
          onPlay={() => { if (!mayPlay.current) video.current?.pause(); else setPlaying(true); }}
          onPlaying={() => setBuffering(false)}
          onWaiting={() => { if (mayPlay.current) setBuffering(true); }}
          onPause={() => { setPlaying(false); setBuffering(false); }}
          aria-label={title}
        />}
        {media && !failed && <button type="button" onClick={toggle} tabIndex={photoSelected ? -1 : 0} aria-label={muted ? c('Воспроизвести со звуком', 'Ovoz bilan ko‘rish', 'Play with sound') : playing ? c('Приостановить видео', 'Videoni to‘xtatish', 'Pause video') : c('Воспроизвести видео', 'Videoni ko‘rish', 'Play video')} aria-pressed={playing} className="reel-play-toggle">
          {buffering && active ? <span role="status" className="flex h-14 w-14 items-center justify-center rounded-full bg-black/20 backdrop-blur-sm"><span className="h-7 w-7 animate-spin rounded-full border-2 border-white/30 border-t-white"/><span className="sr-only">{c('Загрузка видео', 'Video yuklanmoqda', 'Loading video')}</span></span> : !playing && <span className="flex h-16 w-16 items-center justify-center rounded-full border border-white/25 bg-black/15 backdrop-blur-sm"><Icon name="play" size={25} className="ml-1"/></span>}
          {needsGesture && <span className="max-w-52 rounded-full bg-black/40 px-4 py-2 text-[11px] backdrop-blur-md">{c('Нажмите, чтобы воспроизвести', 'Ko‘rish uchun bosing', 'Tap to play')}</span>}
        </button>}
        {failed && <div role="status" className="absolute inset-x-8 top-1/4 rounded-2xl bg-black/60 p-4 text-center text-xs leading-relaxed backdrop-blur-md"><p>{t('videoUnavailable')}</p><button type="button" tabIndex={photoSelected ? -1 : 0} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/30 px-4 py-2 font-semibold" onClick={retryVideo}>{t('retry')}<Icon name="play" size={15}/></button></div>}
      </div>
      {media && dishPhoto && <div className="reel-frame" aria-hidden={!photoSelected || undefined}><img src={dishPhoto} alt={`${c('Фото блюда', 'Taom rasmi', 'Dish photo')}: ${title}`} className="h-full w-full object-cover" loading="lazy" draggable={false}/></div>}
    </div>
    <div className="reel-shade" aria-hidden="true"/>
    {!descriptionExpanded && <div className="reel-actions">
      <Link to={`/restaurants/${post.restaurant.id}`} aria-label={post.restaurant.name} className="relative mb-1"><img src={post.restaurant.logoUrl} alt="" className="h-11 w-11 rounded-full border-2 border-white object-cover"/><span className="absolute -bottom-1.5 left-1/2 flex h-4 w-4 -translate-x-1/2 items-center justify-center rounded-full bg-brand"><Icon name="plus" size={11}/></span></Link>
      <button type="button" className={`flex flex-col items-center gap-1 transition active:scale-90 ${post.isLiked ? 'text-[#ff754f]' : ''}`} onClick={() => like.mutate()} disabled={like.isPending} aria-label={post.isLiked ? c('Убрать лайк', 'Laykni bekor qilish', 'Unlike') : t('like')} aria-pressed={post.isLiked}><Icon name="heart" size={29} filled={post.isLiked}/><span className="text-[10px] font-bold">{post.likeCount}</span></button>
      <button type="button" className="flex flex-col items-center gap-1" onClick={() => setComments(true)} aria-label={t('comments')}><Icon name="comments" size={28}/><span className="text-[10px] font-bold">{post.commentCount}</span></button>
      <button type="button" className="flex flex-col items-center gap-1 disabled:opacity-50" disabled={sharing} aria-busy={sharing} onClick={() => void share()} aria-label={t('share')}><Icon name="share" size={26}/><span className="text-[9px] font-semibold">{t('share')}</span></button>
    </div>}
    <div className={`reel-info${descriptionExpanded ? ' is-expanded' : ''}`}>
      <div className="reel-caption" tabIndex={descriptionExpanded ? 0 : undefined} role={descriptionExpanded ? 'region' : undefined} aria-labelledby={descriptionExpanded ? `${detailsId}-title` : undefined}>
        <Link to={`/restaurants/${post.restaurant.id}`} className="reel-meta mb-3 inline-flex flex-wrap items-center gap-2 text-xs font-bold">{post.restaurant.name}<span className="ml-1 flex items-center gap-1 font-medium text-white/70"><Icon name="star" size={12} className="text-[#ffb765]"/>{post.restaurant.rating?.toFixed(1) ?? t('new')}</span></Link>
        <h2 id={`${detailsId}-title`} className="text-[25px] font-extrabold leading-tight tracking-[-.04em]">{title}</h2>
        {dish && <>
          <div className="reel-description">
            {!descriptionExpanded && description && <p>{description}</p>}
            <button type="button" onClick={() => setDescriptionExpanded(value => !value)} aria-expanded={descriptionExpanded} aria-controls={detailsId}>
              {descriptionExpanded ? c('Свернуть', 'Yig‘ish', 'Show less') : c('Подробнее', 'Batafsil', 'More')}
            </button>
          </div>
          <div id={detailsId} className="reel-dish-details" hidden={!descriptionExpanded}>
            {descriptionExpanded && <>
              {description && <p>{description}</p>}
              <ReelDishDetails dish={dish} canOrder={canOrder}/>
            </>}
          </div>
        </>}
      </div>
      {dish ? <div className="reel-order">
        <p className="reel-price">{money(dish.price, language)} <span>{language === 'en' ? 'UZS' : language === 'uz' ? 'soʻm' : 'сум'}</span></p>
        {hasGallery && <div className="reel-media-dots" role="group" aria-label={c('Видео и фото блюда', 'Taom videosi va rasmi', 'Dish video and photo')}>
          <button type="button" aria-label={c('Показать видео', 'Videoni ko‘rsatish', 'Show video')} aria-pressed={!photoSelected} onClick={() => showMedia(0)}><span/></button>
          <button type="button" aria-label={c('Показать фото', 'Rasmni ko‘rsatish', 'Show photo')} aria-pressed={photoSelected} onClick={() => showMedia(1)}><span/></button>
        </div>}
        <button type="button" className="button-primary reel-order-button" disabled={!canOrder} onClick={() => addItem(dish, true)}>{t('toCart')}<Icon name="plus" size={16}/></button>
      </div> : <Link className="button-primary reel-menu-button" to={`/restaurants/${post.restaurant.id}`}>{t('menu')}<Icon name="arrow" size={17}/></Link>}
    </div>
    {comments && <CommentsSheet postId={post.id} onClose={() => setComments(false)} />}
    {shareOpen && <Modal title={t('share')} onClose={() => setShareOpen(false)}><p className="mb-4 text-sm leading-relaxed text-[var(--muted)]">{c('Скопируйте ссылку. Если браузер запрещает копирование, выделите её и скопируйте вручную.', 'Havolani nusxalang. Brauzer ruxsat bermasa, havolani tanlab qo‘lda nusxalang.', 'Copy the link. If your browser blocks copying, select it and copy it manually.')}</p><input type="url" readOnly value={shareUrl} onFocus={event => event.currentTarget.select()} onClick={event => event.currentTarget.select()} aria-label={c('Ссылка на публикацию', 'Post havolasi', 'Post link')} className={inputClass} /><button type="button" disabled={copying} className="button-primary mt-5 w-full" onClick={async () => { setCopying(true); const copied = await copyShareLink(shareUrl); setCopying(false); if (copied) { notify(t('copied')); setShareOpen(false); } else notify(c('Выделите ссылку и скопируйте её вручную.', 'Havolani tanlab qo‘lda nusxalang.', 'Select the link and copy it manually.')); }}>{copying ? c('Копируем…', 'Nusxalanmoqda…', 'Copying…') : c('Скопировать ссылку', 'Havolani nusxalash', 'Copy link')}</button></Modal>}
  </article>;
}
