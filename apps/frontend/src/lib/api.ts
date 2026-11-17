import axios,{AxiosError,type InternalAxiosRequestConfig} from 'axios';
export const api=axios.create({baseURL:'/api',withCredentials:true,timeout:20000});
let csrfToken:string|undefined;
let csrfRequest:Promise<string>|undefined;
let refreshRequest:Promise<unknown>|undefined;
async function csrf(){
 if(csrfToken)return csrfToken;
 csrfRequest??=axios.get('/api/auth/csrf',{withCredentials:true,timeout:20000}).then(r=>{csrfToken=r.data.data.csrfToken??r.data.data.token;return csrfToken!;}).finally(()=>{csrfRequest=undefined;});
 return csrfRequest;
}
api.interceptors.request.use(async config=>{
 if(!['get','head','options'].includes(config.method??'get'))config.headers.set('X-CSRF-Token',await csrf());
 return config;
});
api.interceptors.response.use(r=>r,async(error:AxiosError)=>{
 const request=error.config as (InternalAxiosRequestConfig&{_retried?:boolean;_csrfRetried?:boolean})|undefined;
 if(error.response?.status===401&&request&&!request._retried&&!/\/auth\/(login|register|refresh|logout)/.test(request.url??'')){
  request._retried=true;
  try{refreshRequest??=api.post('/auth/refresh').finally(()=>{refreshRequest=undefined;});await refreshRequest;return api(request);}catch{return Promise.reject(error);}
 }
 if(error.response?.status===403&&request&&!request._csrfRetried&&['CSRF','CSRF_INVALID'].includes((error.response.data as {error?:{code:string}})?.error?.code??'')){
  request._csrfRetried=true;csrfToken=undefined;return api(request);
 }
 return Promise.reject(error);
});
type ErrorCopy = readonly [ru: string, uz: string, en: string];
const errorMessages: Record<string, ErrorCopy> = {
 UNAUTHORIZED: ['Войдите в аккаунт и повторите действие.', 'Hisobga kiring va qayta urinib ko‘ring.', 'Please sign in and try again.'],
 INVALID_CREDENTIALS: ['Неверная почта или пароль.', 'Email yoki parol noto‘g‘ri.', 'The email or password is incorrect.'],
 VALIDATION: ['Проверьте заполненные поля.', 'Kiritilgan maydonlarni tekshiring.', 'Please check the form fields.'],
 CONFLICT: ['Такая запись уже существует. Проверьте введённые данные или активный заказ.', 'Bunday yozuv allaqachon mavjud. Ma’lumotlar yoki faol buyurtmani tekshiring.', 'This record already exists. Check your details or active order.'],
 NOT_FOUND: ['Запись не найдена. Возможно, она была удалена.', 'Yozuv topilmadi. U o‘chirilgan bo‘lishi mumkin.', 'This record was not found. It may have been removed.'],
 RETRY: ['Данные изменились. Обновите страницу и повторите действие.', 'Ma’lumotlar o‘zgardi. Sahifani yangilab qayta urinib ko‘ring.', 'The data changed. Refresh the page and try again.'],
 CSRF: ['Обновите страницу и повторите действие.', 'Sahifani yangilab qayta urinib ko‘ring.', 'Refresh the page and try again.'],
 CSRF_INVALID: ['Обновите страницу и повторите действие.', 'Sahifani yangilab qayta urinib ko‘ring.', 'Refresh the page and try again.'],
 ORIGIN_FORBIDDEN: ['Этот адрес сайта не разрешён сервером. Проверьте настройку доступа через сеть.', 'Bu sayt manziliga server ruxsat bermagan. Tarmoq sozlamalarini tekshiring.', 'This site address is not allowed by the server. Check the network access configuration.'],
 RATE_LIMIT: ['Слишком много запросов. Подождите и повторите попытку.', 'So‘rovlar juda ko‘p. Biroz kutib qayta urinib ko‘ring.', 'Too many requests. Please wait and try again.'],
 RATE_LIMIT_UNAVAILABLE: ['Сервис временно недоступен. Попробуйте позже.', 'Xizmat vaqtincha mavjud emas. Keyinroq urinib ko‘ring.', 'The service is temporarily unavailable. Please try again later.'],
 DATABASE_UNAVAILABLE: ['База данных временно недоступна. Попробуйте позже.', 'Ma’lumotlar bazasi vaqtincha mavjud emas. Keyinroq urinib ko‘ring.', 'The database is temporarily unavailable. Please try again later.'],
 INTERNAL: ['Не удалось выполнить запрос. Попробуйте позже.', 'So‘rov bajarilmadi. Keyinroq urinib ko‘ring.', 'The request could not be completed. Please try again later.'],
 INVALID_JSON: ['Некорректный запрос. Обновите страницу и повторите действие.', 'So‘rov noto‘g‘ri. Sahifani yangilab qayta urinib ko‘ring.', 'The request is invalid. Refresh the page and try again.'],
 ADDRESS_LIMIT: ['Можно сохранить не больше 20 адресов.', 'Ko‘pi bilan 20 ta manzil saqlash mumkin.', 'You can save up to 20 addresses.'],
 ADDRESS_REQUIRED: ['Выберите сохранённый адрес доставки.', 'Saqlangan yetkazish manzilini tanlang.', 'Please choose a saved delivery address.'],
 INVALID_REPLY: ['Ответ должен относиться к комментарию этой публикации.', 'Javob shu postning izohiga tegishli bo‘lishi kerak.', 'A reply must belong to a comment on this post.'],
 REVIEW_NOT_ALLOWED: ['Оставить отзыв можно только после доставки вашего заказа.', 'Faqat o‘z buyurtmangiz yetkazilgandan keyin fikr qoldirish mumkin.', 'You can review your order after it has been delivered.'],
 ACTIVE_ORDER_EXISTS: ['У вас уже есть активный заказ. Дождитесь его завершения.', 'Sizda faol buyurtma mavjud. U tugashini kuting.', 'You already have an active order. Please wait for it to be completed.'],
 CARD_UNAVAILABLE: ['Оплата картой для этого ресторана не настроена.', 'Bu restoran uchun karta to‘lovi sozlanmagan.', 'Card payment is not configured for this restaurant.'],
 INVALID_RECEIPT: ['Чек не найден или уже используется в другом заказе.', 'Chek topilmadi yoki boshqa buyurtmada ishlatilgan.', 'The receipt was not found or has already been used.'],
 RECEIPT_REQUIRED: ['Загрузите чек об оплате.', 'To‘lov chekini yuklang.', 'Please upload your payment receipt.'],
 MIN_ORDER: ['Сумма заказа ниже минимальной для этого ресторана.', 'Buyurtma summasi bu restoran uchun minimal miqdordan kam.', 'Your order is below this restaurant’s minimum order amount.'],
 PASSWORD_REQUIRED: ['Введите текущий пароль для подтверждения изменения.', 'O‘zgarishni tasdiqlash uchun joriy parolni kiriting.', 'Enter your current password to confirm this change.'],
 USERNAME_COOLDOWN: ['Никнейм можно менять один раз в 30 дней.', 'Taxallusni har 30 kunda bir marta o‘zgartirish mumkin.', 'You can change your username once every 30 days.'],
 DISH_UNAVAILABLE: ['Одно из блюд больше недоступно. Проверьте корзину.', 'Taomlardan biri mavjud emas. Savatni tekshiring.', 'One of the dishes is no longer available. Please check your bag.'],
 MIXED_RESTAURANTS: ['В одном заказе могут быть блюда только одного ресторана.', 'Bitta buyurtmada faqat bitta restoran taomlari bo‘lishi mumkin.', 'An order can contain dishes from one restaurant only.'],
 ORDER_TOO_LARGE: ['Сумма заказа слишком велика. Уменьшите количество блюд.', 'Buyurtma summasi juda katta. Taomlar sonini kamaytiring.', 'The order total is too large. Please reduce the quantity.'],
 RESTAURANT_CLOSED: ['Ресторан сейчас закрыт. Корзина сохранена.', 'Restoran hozir yopiq. Savat saqlangan.', 'The restaurant is currently closed. Your bag is saved.'],
 FILE_REQUIRED: ['Выберите файл для загрузки.', 'Yuklash uchun faylni tanlang.', 'Please choose a file to upload.'],
 FILE_TOO_LARGE: ['Файл слишком большой: до 5 МБ для фото профиля и до 8 МБ для чека.', 'Fayl juda katta: profil rasmi 5 MB, chek esa 8 MB gacha.', 'The file is too large: up to 5 MB for profile photos and 8 MB for receipts.'],
 FILE_TYPE: ['Разрешены изображения JPEG, PNG и WebP.', 'JPEG, PNG va WebP rasmlari ruxsat etilgan.', 'Only JPEG, PNG and WebP images are supported.'],
 UPLOAD_INVALID: ['Файл слишком большой или загрузка некорректна.', 'Fayl juda katta yoki yuklash noto‘g‘ri.', 'The file is too large or the upload is invalid.'],
 STORAGE_NOT_CONFIGURED: ['Облачное хранилище пока не настроено. Загрузка файлов недоступна.', 'Bulutli xotira hali sozlanmagan. Fayl yuklash mavjud emas.', 'Cloud storage has not been configured. File uploads are unavailable.'],
};

function errorLanguage(): 0 | 1 | 2 {
 try { const language = localStorage.getItem('uzbite-language'); return language === 'uz' ? 1 : language === 'en' ? 2 : 0; } catch { return 0; }
}

export function friendlyError(error:unknown):string{
 const language = errorLanguage();
 const generic: ErrorCopy = ['Не удалось выполнить действие. Попробуйте ещё раз.', 'Amal bajarilmadi. Qayta urinib ko‘ring.', 'The action could not be completed. Please try again.'];
 if(axios.isAxiosError<{error?:{code?:string;message?:string}}>(error)){
  if(!error.response) {
   const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
   if (offline) return (['Нет подключения к интернету.', 'Internetga ulanish yo‘q.', 'You are offline. Please check your connection.'] as ErrorCopy)[language];
   if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') return (['Сервер не ответил вовремя. Попробуйте ещё раз.', 'Server o‘z vaqtida javob bermadi. Qayta urinib ko‘ring.', 'The server took too long to respond. Please try again.'] as ErrorCopy)[language];
   return (['Сервер временно недоступен. Попробуйте ещё раз.', 'Server vaqtincha mavjud emas. Qayta urinib ko‘ring.', 'The server is temporarily unavailable. Please try again.'] as ErrorCopy)[language];
  }
  const failure = error.response.data?.error;
  // Preserve useful contextual server messages in Russian; other locales use stable error codes.
  if (language === 0 && failure?.message) return failure.message;
  return errorMessages[failure?.code ?? '']?.[language] ?? generic[language];
 }
 return generic[language];
}
export const money=(value:number|string,language='ru')=>new Intl.NumberFormat(language==='uz'?'uz-UZ':language==='en'?'en-US':'ru-RU',{maximumFractionDigits:0}).format(Number(value));
