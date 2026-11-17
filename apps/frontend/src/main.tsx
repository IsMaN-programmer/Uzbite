import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {AppProvider} from './context/AppContext';
import App from './App';
import './styles.css';
const client=new QueryClient({defaultOptions:{queries:{retry:1,staleTime:15000,refetchOnWindowFocus:true},mutations:{retry:false}}});
document.addEventListener('error',event=>{
 const target=event.target;
 if(target instanceof HTMLImageElement&&!target.dataset.fallback){
  target.dataset.fallback='true';
  target.src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 160"><rect width="200" height="160" fill="#ffffff"/><g fill="none" stroke="#aaaaaa" stroke-width="3" stroke-linecap="round"><path d="M60 104h80M70 104a30 30 0 0 1 60 0M100 74v-8m-7 0h14M65 116h70"/></g></svg>');
 }
},true);
createRoot(document.getElementById('root')!).render(<StrictMode><QueryClientProvider client={client}><BrowserRouter><AppProvider><App/></AppProvider></BrowserRouter></QueryClientProvider></StrictMode>);
