import {useEffect,useRef,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {Icon} from './icons/Icon';
import {useApp} from '../context/AppContext';
export function EmptyState({icon='dish',title,description,children}:{icon?:string;title:string;description?:string;children?:ReactNode}){return <div className="flex min-h-64 flex-col items-center justify-center rounded-3xl border border-dashed border-[var(--border)] p-8 text-center"><div className="mb-5 rounded-[24px] bg-[var(--soft)] p-5 text-brand"><Icon name={icon} size={32}/></div><h2 className="text-lg font-bold">{title}</h2>{description&&<p className="mt-2 max-w-sm text-sm leading-relaxed text-[var(--muted)]">{description}</p>}{children&&<div className="mt-6">{children}</div>}</div>;}
export function ErrorState({message,retry}:{message:string;retry:()=>void}){const{t}=useApp();return <EmptyState icon="help" title={message}><button className="button-primary" onClick={retry}>{t('retry')}</button></EmptyState>;}
export function LoadingCards(){return <div aria-busy="true" aria-label="Loading" className="space-y-4">{[1,2,3].map(n=><div key={n} className="surface flex gap-5 p-5"><div className="skeleton h-28 w-32 shrink-0"/><div className="flex-1 space-y-4 pt-2"><div className="skeleton h-5 w-1/2"/><div className="skeleton h-3 w-4/5"/><div className="skeleton h-3 w-2/3"/></div></div>)}</div>;}
export function Modal({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}){
 const ref=useRef<HTMLDivElement>(null);const{t}=useApp();const closeRef=useRef(onClose);closeRef.current=onClose;
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null;const overflow=document.body.style.overflow;
  document.body.style.overflow='hidden';ref.current?.focus();
  function key(event:KeyboardEvent){
   if(event.key==='Escape'){event.preventDefault();closeRef.current();return;}
   if(event.key!=='Tab')return;
   const els=ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex="0"]');
   if(!els?.length){event.preventDefault();return;}
   const first=els[0],last=els[els.length-1];
   if(event.shiftKey&&(document.activeElement===first||document.activeElement===ref.current)){event.preventDefault();last.focus();}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  }
  document.addEventListener('keydown',key);
  return()=>{document.body.style.overflow=overflow;document.removeEventListener('keydown',key);if(previous?.isConnected)previous.focus();};
 },[]);
 return createPortal(<div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/45 backdrop-blur-sm sm:items-center sm:p-5" onClick={e=>{if(e.target===e.currentTarget)onClose();}}><div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className="animate-enter flex max-h-[85dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-[28px] bg-[var(--surface)] outline-none sm:rounded-[28px]"><header className="flex items-center justify-between border-b border-[var(--border)] p-5"><h2 className="text-xl font-extrabold tracking-tight">{title}</h2><button aria-label={t('cancel')} className="icon-button" onClick={onClose}><Icon name="close" size={20}/></button></header>{children}</div></div>,document.body);
}
