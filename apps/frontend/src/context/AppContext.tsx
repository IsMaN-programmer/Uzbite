import {createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {useNavigate} from 'react-router-dom';
import {useQueryClient} from '@tanstack/react-query';
import {io,type Socket} from 'socket.io-client';
import {isAxiosError} from 'axios';
import {api,friendlyError} from '../lib/api';
import {translate,type Language} from '../lib/i18n';
import {loadCart,saveCart,type CartItem,type CartDish} from '../lib/cartStorage';
import {CartReplacementDialog} from '../components/CartReplacementDialog';
export type {CartItem,CartDish} from '../lib/cartStorage';
export interface User{id:string;name:string;username:string;email:string|null;recipientName?:string|null;phone:string|null;bio:string;avatarUrl:string|null;usernameChangedAt:string|null;settings?:{language:Language;theme:'light'|'dark'};language?:Language;theme?:'light'|'dark'}
interface AppState{user:User|null;authLoading:boolean;authError:string;refreshUser:()=>Promise<void>;cart:CartItem[];addItem:(dish:CartDish,openOrders?:boolean)=>void;updateQuantity:(dishId:string,quantity:number)=>void;clearCart:()=>void;language:Language;setLanguage:(language:Language)=>void;theme:'light'|'dark';setTheme:(theme:'light'|'dark')=>void;t:(key:string)=>string;notify:(message:string)=>void;joinPost:(postId:string)=>void;leavePost:(postId:string)=>void}
const Context=createContext<AppState|null>(null);
function preference(key:string){try{return localStorage.getItem(key);}catch{return null;}}
function storePreference(key:string,value:string){try{localStorage.setItem(key,value);}catch{/* Preferences remain usable for this session. */}}
export function AppProvider({children}:{children:ReactNode}){
 const navigate=useNavigate();const queryClient=useQueryClient();
 const [user,setUser]=useState<User|null>(null);
 const [authLoading,setAuthLoading]=useState(true);
 const [authError,setAuthError]=useState('');
 const currentUser=useRef<User|null>(null);
 const socketRef=useRef<Socket|null>(null);
 const postRooms=useRef(new Set<string>());
 const settingsQueue=useRef<Promise<unknown>>(Promise.resolve());
 const storageWarning=useRef<string|null>(null);
 const [cartState,setCartState]=useState<{ownerId:string|null;items:CartItem[]}>({ownerId:null,items:[]});
 const cart=cartState.items;
 const setCart=useCallback((next:CartItem[]|((items:CartItem[])=>CartItem[]))=>setCartState(state=>({...state,items:typeof next==='function'?next(state.items):next})),[]);
 const [language,changeLanguage]=useState<Language>(()=>(['ru','uz','en'].includes(preference('uzbite-language')??'')?preference('uzbite-language'):'ru') as Language);
 const [theme,changeTheme]=useState<'light'|'dark'>(()=>preference('uzbite-theme')==='dark'?'dark':'light');
 const [toast,setToast]=useState('');
 const [pending,setPending]=useState<{dish:CartDish;openOrders:boolean}|null>(null);
 const t=(key:string)=>translate(key,language);
 const applyIdentity=useCallback((next:User|null)=>{
  if(currentUser.current?.id!==next?.id){
   queryClient.clear();postRooms.current.clear();setPending(null);
   setCartState({ownerId:next?.id??null,items:next?loadCart(next.id):[]});
  }
  currentUser.current=next;setUser(next);
 },[queryClient]);
 const refreshUser=useCallback(async()=>{
  setAuthError('');
  try{
   const response=await api.get<{data:User}>('/auth/me');applyIdentity(response.data.data);
   const settings=response.data.data.settings;
   if(settings){changeLanguage(settings.language);changeTheme(settings.theme);}
  }catch(error){
   if(isAxiosError(error)&&[401,403].includes(error.response?.status??0))applyIdentity(null);
   else setAuthError(friendlyError(error));
  }finally{setAuthLoading(false);}
 },[applyIdentity]);
 const joinPost=useCallback((postId:string)=>{postRooms.current.add(postId);socketRef.current?.emit('post:join',postId);},[]);
 const leavePost=useCallback((postId:string)=>{postRooms.current.delete(postId);socketRef.current?.emit('post:leave',postId);},[]);
 useEffect(()=>{void refreshUser();},[refreshUser]);
 useEffect(()=>{
  if(!cartState.ownerId)return;
  if(saveCart(cartState.ownerId,cartState.items)){storageWarning.current=null;return;}
  if(storageWarning.current!==cartState.ownerId){storageWarning.current=cartState.ownerId;setToast(translate('cartStorageUnavailable',language));}
 },[cartState,language]);
 useEffect(()=>{storePreference('uzbite-language',language);document.documentElement.lang=language;},[language]);
 useEffect(()=>{storePreference('uzbite-theme',theme);document.documentElement.dataset.theme=theme;},[theme]);
 useEffect(()=>{if(!toast)return;const id=setTimeout(()=>setToast(''),3500);return()=>clearTimeout(id);},[toast]);
 useEffect(()=>{
  if(!user)return;
  const sessionUserId=user.id;let active=true;let recovery:Promise<void>|undefined;let recoveryAttempted=false;let retryTimer:ReturnType<typeof setTimeout>|undefined;
  const socket=io({withCredentials:true,reconnection:true});socketRef.current=socket;
  const sync=()=>{void queryClient.invalidateQueries({queryKey:['orders']});void queryClient.invalidateQueries({queryKey:['notifications']});};
  const recover=()=>{
   if(!active||recovery||recoveryAttempted||currentUser.current?.id!==sessionUserId)return;
   recoveryAttempted=true;
   recovery=api.get<{data:User}>('/auth/me').then(response=>{
    if(!active||currentUser.current?.id!==sessionUserId)return;
    if(response.data.data.id!==sessionUserId){applyIdentity(response.data.data);return;}
    socket.connect();
   }).catch(error=>{
    if(!active||currentUser.current?.id!==sessionUserId)return;
    if(isAxiosError(error)&&[401,403].includes(error.response?.status??0)){socket.disconnect();applyIdentity(null);}
    else{recoveryAttempted=false;retryTimer=setTimeout(recover,5000);}
   }).finally(()=>{recovery=undefined;});
  };
  socket.on('connect',()=>{recoveryAttempted=false;for(const postId of postRooms.current)socket.emit('post:join',postId);sync();});
  socket.on('order:updated',sync);socket.on('payment:updated',sync);socket.on('notification',sync);
  socket.on('comment:created',()=>void queryClient.invalidateQueries({queryKey:['comments']}));
  socket.on('disconnect',reason=>{if(reason==='io server disconnect')recover();});
  socket.on('connect_error',error=>{if(error.message==='Unauthorized')recover();});
  return()=>{active=false;if(retryTimer)clearTimeout(retryTimer);socket.removeAllListeners();socket.disconnect();if(socketRef.current===socket)socketRef.current=null;};
 },[user?.id,queryClient,applyIdentity]);
 function updateSettings(settings:{language?:Language;theme?:'light'|'dark'}){
  const ownerId=currentUser.current?.id;if(!ownerId)return;
  settingsQueue.current=settingsQueue.current.catch(()=>{}).then(async()=>{
   if(currentUser.current?.id!==ownerId)return;
   try{await api.patch('/profile',settings);void queryClient.invalidateQueries({queryKey:['notifications']});}
   catch(error){if(currentUser.current?.id===ownerId)setToast(friendlyError(error));}
  });
 }
 function addItem(dish:CartDish,openOrders=false){
  if(cart.length&&cart[0].restaurantId!==dish.restaurantId){setPending({dish,openOrders});return;}
  setCart(items=>{const existing=items.find(item=>item.dishId===dish.id);return existing?items.map(item=>item.dishId===dish.id?{...item,quantity:Math.min(99,item.quantity+1)}:item):[...items,{dishId:dish.id,restaurantId:dish.restaurantId,name:dish.name,price:dish.price,imageUrl:dish.imageUrl,quantity:1}];});
  if(openOrders)navigate('/orders');else setToast(t('added'));
 }
 function replaceCart(){
  if(!pending)return;
  const{dish,openOrders}=pending;
  setCart([{dishId:dish.id,restaurantId:dish.restaurantId,name:dish.name,price:dish.price,imageUrl:dish.imageUrl,quantity:1}]);
  setPending(null);if(openOrders)navigate('/orders');
 }
 return <Context.Provider value={{user,authLoading,authError,refreshUser,cart,addItem,updateQuantity:(id,quantity)=>setCart(items=>quantity<=0?items.filter(item=>item.dishId!==id):items.map(item=>item.dishId===id?{...item,quantity:Math.min(99,quantity)}:item)),clearCart:()=>setCart([]),language,setLanguage:value=>{changeLanguage(value);updateSettings({language:value});},theme,setTheme:value=>{changeTheme(value);updateSettings({theme:value});},t,notify:setToast,joinPost,leavePost}}>
  {children}
  {toast&&<div role="status" className="fixed bottom-24 left-1/2 z-[110] max-w-[90vw] -translate-x-1/2 rounded-2xl bg-[var(--text)] px-6 py-4 text-sm font-medium text-[var(--bg)] shadow-xl md:bottom-8">{toast}</div>}
  {pending&&<CartReplacementDialog onCancel={()=>setPending(null)} onConfirm={replaceCart}/>}
 </Context.Provider>;
}
export function useApp(){const app=useContext(Context);if(!app)throw new Error('AppProvider is missing');return app;}
