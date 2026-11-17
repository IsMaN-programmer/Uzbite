import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Post } from '@uzbite/shared';
import { api, friendlyError, money } from '../lib/api';
import { playbackFailure } from '../lib/media';
import { copyShareLink, shareLink } from '../lib/share';
import { useApp } from '../context/AppContext';
import { Icon } from './icons/Icon';
import { CommentsSheet } from './CommentsSheet';
import { inputClass, Modal, useCopy } from './AccountPrimitives';

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
  const [details, setDetails] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [copying, setCopying] = useState(false);
  const media = post.media.find(item => item.type === 'VIDEO');
  const image = media?.posterUrl ?? post.dish?.imageUrl ?? post.restaurant.coverUrl;
  const loadSource = sourceLoaded || active || preloadNext || first;
  const canPlay = active && pageVisible && !pausedByUser && !comments && !details && !sharing && !shareOpen && !failed;
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
      mayPlay.current = !document.hidden && !comments && !details && !shareOpen;
      void requestPlay();
      return;
    }
    if (!element.paused) { setPausedByUser(true); ++playAttempt.current; element.pause(); }
    else {
      setPausedByUser(false); setNeedsGesture(false);
      onActivate?.(post.id);
      // Keep play() inside the click gesture for browsers that block autoplay.
      mayPlay.current = !document.hidden && !comments && !details && !shareOpen;
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

  return <article data-reel-id={post.id} className="reel relative isolate mx-auto mb-6 aspect-[9/14.6] max-h-[740px] w-[min(100%,clamp(310px,calc((100dvh-260px)*.64),460px))] overflow-hidden rounded-[28px] bg-[#25271e] text-white shadow-[0_14px_50px_-20px_#25251a50] sm:aspect-[9/14.2]">
    <img src={image} alt={post.dish?.name ?? post.restaurant.name} className={`absolute inset-0 -z-20 h-full w-full object-cover ${landscape ? 'scale-110 blur-xl brightness-50' : ''}`} loading={first ? 'eager' : 'lazy'} />
    {media && <video ref={video} src={loadSource ? media.url : undefined} poster={image} muted={muted} loop playsInline preload={active || preloadNext ? 'auto' : first || sourceLoaded ? 'metadata' : 'none'} className={`reel-video absolute inset-0 -z-10 h-full w-full ${landscape ? 'object-contain' : 'object-cover'} ${failed ? 'opacity-0' : ''}`} onError={() => { if (video.current?.error?.code !== MediaError.MEDIA_ERR_ABORTED) { setFailed(true); setPlaying(false); setBuffering(false); } }} onPlay={() => { if (!mayPlay.current) video.current?.pause(); else setPlaying(true); }} onPlaying={() => setBuffering(false)} onWaiting={() => { if (mayPlay.current) setBuffering(true); }} onPause={() => { setPlaying(false); setBuffering(false); }} aria-label={post.dish?.name ?? post.caption} />}
    <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-black/25 via-transparent to-black/85" />
    {media && !failed && <button type="button" onClick={toggle} aria-label={muted ? c('Воспроизвести со звуком', 'Ovoz bilan ko‘rish', 'Play with sound') : playing ? c('Приостановить видео', 'Videoni to‘xtatish', 'Pause video') : c('Воспроизвести видео', 'Videoni ko‘rish', 'Play video')} aria-pressed={playing} className="absolute inset-x-0 bottom-48 top-0 flex flex-col items-center justify-center gap-3">{buffering && active ? <span role="status" className="flex h-14 w-14 items-center justify-center rounded-full bg-black/20 backdrop-blur-sm"><span className="h-7 w-7 animate-spin rounded-full border-2 border-white/30 border-t-white" /><span className="sr-only">{c('Загрузка видео', 'Video yuklanmoqda', 'Loading video')}</span></span> : !playing && <span className="flex h-16 w-16 items-center justify-center rounded-full border border-white/25 bg-black/15 backdrop-blur-sm"><Icon name="play" size={25} className="ml-1" /></span>}{needsGesture && <span className="max-w-52 rounded-full bg-black/40 px-4 py-2 text-[11px] backdrop-blur-md">{c('Нажмите, чтобы воспроизвести', 'Ko‘rish uchun bosing', 'Tap to play')}</span>}</button>}
    {failed && <div role="status" className="absolute inset-x-8 top-1/4 rounded-2xl bg-black/60 p-4 text-center text-xs leading-relaxed backdrop-blur-md"><p>{t('videoUnavailable')}</p><button type="button" className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/30 px-4 py-2 font-semibold" onClick={retryVideo}>{t('retry')}<Icon name="play" size={15} /></button></div>}
    <div className="reel-actions absolute bottom-43 right-4 flex flex-col items-center gap-5">
      <Link to={`/restaurants/${post.restaurant.id}`} aria-label={post.restaurant.name} className="relative mb-1"><img src={post.restaurant.logoUrl} alt="" className="h-11 w-11 rounded-full border-2 border-white object-cover" /><span className="absolute -bottom-1.5 left-1/2 flex h-4 w-4 -translate-x-1/2 items-center justify-center rounded-full bg-brand"><Icon name="plus" size={11} /></span></Link>
      <button type="button" className={`flex flex-col items-center gap-1 transition active:scale-90 ${post.isLiked ? 'text-[#ff754f]' : ''}`} onClick={() => like.mutate()} disabled={like.isPending} aria-label={post.isLiked ? c('Убрать лайк', 'Laykni bekor qilish', 'Unlike') : t('like')} aria-pressed={post.isLiked}><Icon name="heart" size={29} filled={post.isLiked} /><span className="text-[10px] font-bold">{post.likeCount}</span></button>
      <button type="button" className="flex flex-col items-center gap-1" onClick={() => setComments(true)} aria-label={t('comments')}><Icon name="comments" size={28} /><span className="text-[10px] font-bold">{post.commentCount}</span></button>
      <button type="button" className="flex flex-col items-center gap-1 disabled:opacity-50" disabled={sharing} aria-busy={sharing} onClick={() => void share()} aria-label={t('share')}><Icon name="share" size={26} /><span className="text-[9px] font-semibold">{t('share')}</span></button>
    </div>
    <div className="reel-info absolute bottom-0 left-0 right-0 p-5 sm:p-6"><Link to={`/restaurants/${post.restaurant.id}`} className="reel-meta mb-3 inline-flex flex-wrap items-center gap-2 text-xs font-bold">{post.restaurant.name}<span className="ml-1 flex items-center gap-1 font-medium text-white/70"><Icon name="star" size={12} className="text-[#ffb765]" />{post.restaurant.rating?.toFixed(1) ?? t('new')}</span></Link><h2 className="max-w-[85%] text-[25px] font-extrabold leading-tight tracking-[-.04em]">{post.dish ? <button type="button" className="text-left underline-offset-4 hover:underline" onClick={() => setDetails(true)} aria-label={`${c('Подробнее о блюде', 'Taom haqida batafsil', 'Dish details')}: ${post.dish.name}`}>{post.dish.name}</button> : post.caption}</h2><p className="mt-2 line-clamp-1 max-w-[83%] text-xs leading-relaxed text-white/70 md:line-clamp-2">{post.dish?.description ?? post.caption}</p><div className="reel-order mt-5 flex items-center justify-between gap-3 border-t border-white/15 pt-4">{post.dish ? <><p className="text-xl font-extrabold tracking-tight">{money(post.dish.price, language)} <span className="text-xs font-medium text-white/60">{language === 'en' ? 'UZS' : language === 'uz' ? 'soʻm' : 'сум'}</span></p><button type="button" className="button-primary min-h-11 rounded-xl px-5 py-2 text-xs" disabled={!post.dish.isAvailable || !post.restaurant.isOpen} onClick={() => post.dish && addItem(post.dish, true)}>{t('toCart')}<Icon name="plus" size={16} /></button></> : <Link className="button-primary w-full" to={`/restaurants/${post.restaurant.id}`}>{t('menu')}<Icon name="arrow" size={17} /></Link>}</div></div>
    {comments && <CommentsSheet postId={post.id} onClose={() => setComments(false)} />}
    {details && post.dish && <Modal title={post.dish.name} onClose={() => setDetails(false)}><img src={post.dish.imageUrl} alt={post.dish.name} className="mb-5 aspect-[4/3] w-full rounded-2xl object-cover" /><p className="mb-3 text-xs font-semibold text-orange-600">{post.restaurant.name}</p><p className="mb-6 text-sm leading-relaxed text-[var(--muted)]">{post.dish.description}</p><div className="flex items-center justify-between gap-4"><strong>{money(post.dish.price, language)} {language === 'en' ? 'UZS' : language === 'uz' ? 'soʻm' : 'сум'}</strong><button type="button" className="button-primary" disabled={!post.dish.isAvailable || !post.restaurant.isOpen} onClick={() => { if (post.dish) { setDetails(false); addItem(post.dish, true); } }}>{t('toCart')}<Icon name="plus" size={17} /></button></div></Modal>}
    {shareOpen && <Modal title={t('share')} onClose={() => setShareOpen(false)}><p className="mb-4 text-sm leading-relaxed text-[var(--muted)]">{c('Скопируйте ссылку. Если браузер запрещает копирование, выделите её и скопируйте вручную.', 'Havolani nusxalang. Brauzer ruxsat bermasa, havolani tanlab qo‘lda nusxalang.', 'Copy the link. If your browser blocks copying, select it and copy it manually.')}</p><input type="url" readOnly value={shareUrl} onFocus={event => event.currentTarget.select()} onClick={event => event.currentTarget.select()} aria-label={c('Ссылка на публикацию', 'Post havolasi', 'Post link')} className={inputClass} /><button type="button" disabled={copying} className="button-primary mt-5 w-full" onClick={async () => { setCopying(true); const copied = await copyShareLink(shareUrl); setCopying(false); if (copied) { notify(t('copied')); setShareOpen(false); } else notify(c('Выделите ссылку и скопируйте её вручную.', 'Havolani tanlab qo‘lda nusxalang.', 'Select the link and copy it manually.')); }}>{copying ? c('Копируем…', 'Nusxalanmoqda…', 'Copying…') : c('Скопировать ссылку', 'Havolani nusxalash', 'Copy link')}</button></Modal>}
  </article>;
}
