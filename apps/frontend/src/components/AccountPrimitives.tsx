import { useEffect, useId, useRef, type ReactNode } from 'react';
import {createPortal} from 'react-dom';
import { useApp } from '../context/AppContext';
import { Icon } from './icons/Icon';

export function useCopy() {
  const { language } = useApp();
  return (ru: string, uz: string, en: string) => language === 'uz' ? uz : language === 'en' ? en : ru;
}

export const inputClass = 'w-full rounded-2xl border border-[var(--border)] bg-[var(--bg)] px-4 py-3.5 text-sm text-[var(--text)] outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-500/10 disabled:opacity-50';
export const primaryClass = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-orange-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-orange-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-500 disabled:cursor-not-allowed disabled:opacity-50';
export const secondaryClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--text)] transition hover:border-orange-400 focus-visible:outline-2 focus-visible:outline-orange-500 disabled:opacity-50';

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid gap-2 text-sm font-medium text-[var(--text)]"><span>{label}</span>{children}</label>;
}

export function FormError({ message }: { message?: string | null }) {
  return message ? <p role="alert" className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-300">{message}</p> : null;
}

export function Modal({ title, children, onClose, wide = false, fullScreenOnMobile = false, presentation = 'dialog', compactHeader = false, headerAction }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean; fullScreenOnMobile?: boolean; presentation?: 'dialog' | 'screen'; compactHeader?: boolean; headerAction?: ReactNode }) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const c = useCopy();
  const screen = presentation === 'screen';
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (dialogs[dialogs.length - 1] !== panelRef.current) return;
      if (event.key === 'Escape') closeRef.current();
      if (event.key !== 'Tab') return;
      const targets = panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]');
      if (!targets?.length) return;
      const first = targets[0];
      const last = targets[targets.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', onKey); previousFocus?.focus(); };
  }, []);
  return createPortal(<div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/45 p-0 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={screen ? 'screen-dialog' : `${fullScreenOnMobile?'flex h-dvh max-h-dvh flex-col rounded-none pt-[max(1.25rem,env(safe-area-inset-top))] sm:block sm:h-auto sm:max-h-[94dvh]':'max-h-[94dvh] rounded-t-[2rem]'} w-full overflow-y-auto border border-[var(--border)] bg-[var(--surface)] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-[var(--text)] outline-none sm:rounded-[2rem] sm:p-7 ${wide ? 'sm:max-w-3xl' : 'sm:max-w-xl'}`}>
      {screen ? <header className={'screen-dialog-header' + (compactHeader ? ' screen-dialog-header--compact' : '')}><button type="button" onClick={onClose} aria-label={c('Назад', 'Orqaga', 'Back')}><Icon name="back" size={26}/></button><h2 id={titleId}>{title}</h2>{headerAction && <div className="screen-dialog-header-action">{headerAction}</div>}</header> : <div className="mb-6 flex shrink-0 items-center justify-between gap-4"><h2 id={titleId} className="text-xl font-bold tracking-tight">{title}</h2><button type="button" onClick={onClose} aria-label={c('Закрыть', 'Yopish', 'Close')} className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--bg)]"><Icon name="close" /></button></div>}
      {children}
    </div>
  </div>, document.body);
}

export function LoadingCards() {
  return <div aria-busy="true" className="space-y-4">{[0, 1, 2].map((item) => <div key={item} className="h-32 animate-pulse rounded-3xl bg-[var(--border)]" />)}</div>;
}

export function money(value: number | string, language = 'ru') {
  return `${new Intl.NumberFormat(language === 'uz' ? 'uz-UZ' : language === 'en' ? 'en-US' : 'ru-RU').format(Number(value))} ${language === 'en' ? 'UZS' : language === 'uz' ? 'soʻm' : 'сум'}`;
}
