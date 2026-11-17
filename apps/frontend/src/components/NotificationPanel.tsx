import {Link} from 'react-router-dom';
import {useInfiniteQuery,useQueryClient} from '@tanstack/react-query';
import type {Notification} from '@uzbite/shared';
import {useApp} from '../context/AppContext';
import {api,friendlyError} from '../lib/api';
import {nextCollectionPage,type PaginatedCollection} from '../lib/pagination';
import {EmptyState,ErrorState,Modal} from './UI';
import {Icon} from './icons/Icon';

export function NotificationPanel({onClose}:{onClose:()=>void}){
  const{t,notify,language}=useApp();const client=useQueryClient();
  const result=useInfiniteQuery({
    queryKey:['notifications',language],initialPageParam:1,
    queryFn:async({pageParam})=>(await api.get<PaginatedCollection<Notification>>('/notifications',{params:{page:pageParam,pageSize:12}})).data,
    getNextPageParam:nextCollectionPage,
  });
  const items=result.data?.pages.flatMap(page=>page.data)??[];
  async function mark(id:string){
    try{await api.patch(`/notifications/${id}/read`);void client.invalidateQueries({queryKey:['notifications']});}
    catch(error){notify(friendlyError(error));}
  }
  return <Modal title={t('notifications')} onClose={onClose}>
    <div className="overflow-y-auto p-5">
      {result.isPending?<div className="skeleton h-24"/>:result.isError&&!items.length?<ErrorState message={friendlyError(result.error)} retry={()=>void result.refetch()}/>:!items.length?<EmptyState icon="notifications" title={t('noNotifications')}/>:items.map(item=><article key={item.id} className={`mb-3 rounded-2xl border p-4 ${item.readAt?'border-[var(--border)]':'border-brand/20 bg-[var(--soft)]'}`}>
        <div className="flex items-start justify-between gap-3">
          <Link to={item.link?.startsWith('/')?item.link:'/orders'} onClick={()=>{void mark(item.id);onClose();}} className="text-sm font-bold hover:text-brand">{item.title}</Link>
          {!item.readAt&&<button aria-label={t('markRead')} onClick={()=>void mark(item.id)} className="text-brand"><Icon name="check" size={18}/></button>}
        </div>
        <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">{item.body}</p>
        <time className="mt-3 block text-[10px] text-[var(--muted)]">{new Date(item.createdAt).toLocaleString(language)}</time>
      </article>)}
      {result.isFetchNextPageError&&<p role="alert" className="my-4 text-sm text-red-600">{friendlyError(result.error)}</p>}
      {result.hasNextPage&&<button className="button-secondary mt-3 w-full" disabled={result.isFetchingNextPage} onClick={()=>void result.fetchNextPage()}>{t(result.isFetchNextPageError?'retry':'loadMore')}</button>}
    </div>
  </Modal>;
}
