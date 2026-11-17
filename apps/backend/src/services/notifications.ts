import type { Notification, Prisma } from '@prisma/client';

type Language = 'ru' | 'uz' | 'en';
type Copy = Record<Language, string>;
const orderLabels: Record<string, Copy> = {
  PENDING_ACCEPTANCE: { ru: 'Ожидает принятия', uz: 'Qabul qilinishi kutilmoqda', en: 'Awaiting acceptance' },
  ACCEPTED: { ru: 'Заказ принят', uz: 'Buyurtma qabul qilindi', en: 'Order accepted' },
  PREPARING: { ru: 'Готовится', uz: 'Tayyorlanmoqda', en: 'Being prepared' },
  DELIVERING: { ru: 'Доставляется', uz: 'Yetkazilmoqda', en: 'Out for delivery' },
  DELIVERED: { ru: 'Доставлено', uz: 'Yetkazildi', en: 'Delivered' },
  CANCELLED: { ru: 'Отменено', uz: 'Bekor qilindi', en: 'Cancelled' },
};
const paymentLabels: Record<string, Copy> = {
  AWAITING_PAYMENT: { ru: 'Ожидает оплаты', uz: 'To‘lov kutilmoqda', en: 'Awaiting payment' },
  AWAITING_CONFIRMATION: { ru: 'Ожидает подтверждения', uz: 'Tasdiqlash kutilmoqda', en: 'Awaiting confirmation' },
  PAID: { ru: 'Оплачено', uz: 'To‘langan', en: 'Paid' },
  REJECTED: { ru: 'Оплата отклонена', uz: 'To‘lov rad etildi', en: 'Payment rejected' },
};
/** Dispatch notifications store a semantic `event`; text is rendered per reader language. */
const dispatchTitles: Record<string, Record<string, Copy>> = {
  DELIVERY_STATUS: {
    COURIER_ASSIGNED: { ru: 'Курьер назначен', uz: 'Kuryer tayinlandi', en: 'Courier assigned' },
  },
  COURIER_DELIVERY: {
    OFFER_CREATED: { ru: 'Новое предложение доставки', uz: 'Yangi yetkazish taklifi', en: 'New delivery offer' },
    READY_FOR_PICKUP: { ru: 'Заказ готов к выдаче', uz: 'Buyurtma topshirishga tayyor', en: 'Order ready for pickup' },
    RELEASED_BY_RESTAURANT: { ru: 'Ресторан снял назначение', uz: 'Restoran tayinlovni bekor qildi', en: 'The restaurant cancelled your assignment' },
    ISSUE_RESOLVED: { ru: 'Обращение рассмотрено', uz: 'Murojaat ko‘rib chiqildi', en: 'Your request was reviewed' },
    CASH_SETTLED: { ru: 'Расчёт наличными подтверждён', uz: 'Naqd hisob-kitob tasdiqlandi', en: 'Cash settlement confirmed' },
    REWARD_CONFIRMED: { ru: 'Вознаграждение подтверждено', uz: 'Mukofot tasdiqlandi', en: 'Reward confirmed' },
    REWARD_PAID: { ru: 'Выплата вознаграждения отмечена', uz: 'Mukofot to‘lovi belgilandi', en: 'Reward payment recorded' },
  },
  RESTAURANT_DELIVERY: {
    COURIER_ASSIGNED: { ru: 'Курьер назначен', uz: 'Kuryer tayinlandi', en: 'Courier assigned' },
    OFFER_REJECTED: { ru: 'Курьер отклонил предложение', uz: 'Kuryer taklifni rad etdi', en: 'The courier declined the offer' },
    OFFER_EXPIRED: { ru: 'Срок предложения курьеру истёк', uz: 'Kuryerga taklif muddati tugadi', en: 'The courier offer expired' },
    SEARCH_EXPIRED: { ru: 'Курьер не найден', uz: 'Kuryer topilmadi', en: 'No courier found' },
    OFFER_WITHDRAWN: { ru: 'Предложение курьеру отозвано', uz: 'Kuryerga taklif qaytarib olindi', en: 'The courier offer was withdrawn' },
    COURIER_RELEASED: { ru: 'Курьер отказался от доставки', uz: 'Kuryer yetkazishdan voz kechdi', en: 'The courier dropped the delivery' },
    ISSUE_OPENED: { ru: 'Новое обращение курьера', uz: 'Kuryerdan yangi murojaat', en: 'New courier request' },
    DELIVERED: { ru: 'Заказ доставлен', uz: 'Buyurtma yetkazildi', en: 'Order delivered' },
  },
};
const handoffHint: Copy = { ru: 'Назовите курьеру код подтверждения', uz: 'Kuryerga tasdiqlash kodini ayting', en: 'Tell the courier your confirmation code' };
const orderWord: Copy = { ru: 'Заказ', uz: 'Buyurtma', en: 'Order' };
/** Title/body of a dispatch notification, or null for any other notification type/event. */
export function dispatchNoticeText(type: string, data: { event?: string; restaurantName?: string; orderNumber?: string }, language: Language = 'ru') {
  const title = dispatchTitles[type]?.[data.event ?? '']?.[language];
  if (!title) return null;
  const detail = type === 'DELIVERY_STATUS' ? handoffHint[language] : data.orderNumber ? `${orderWord[language]} №${data.orderNumber}` : '';
  return { title, body: [data.restaurantName, detail].filter(Boolean).join(' · ') || title };
}
function metadata(value: Prisma.JsonValue): Prisma.JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function text(value: Prisma.JsonValue | undefined) { return typeof value === 'string' ? value : ''; }
export function notificationDto(notification: Notification, preference: string | undefined = 'ru') {
  const language: Language = preference === 'uz' || preference === 'en' ? preference : 'ru';
  const data = metadata(notification.metadata);
  let restaurantName = text(data.restaurantName);
  let status = text(data.status);
  let authorName = text(data.authorName);
  // Older rows remain readable after the additive metadata migration.
  if (!restaurantName && notification.type === 'ORDER_CREATED') restaurantName = notification.body.replace(/ · ожидает принятия$/, '');
  if (!restaurantName && notification.type === 'ORDER_STATUS') {
    const match = /^(.*): (PENDING_ACCEPTANCE|ACCEPTED|PREPARING|DELIVERING|DELIVERED|CANCELLED)$/.exec(notification.body);
    restaurantName = match?.[1] ?? ''; status = status || match?.[2] || '';
  }
  if (!authorName && notification.type === 'COMMENT_REPLY') authorName = notification.body.replace(/ ответил на ваш комментарий$/, '');
  let title = notification.title, body = notification.body;
  if (notification.type === 'ORDER_CREATED') {
    title = ({ ru: 'Заказ создан', uz: 'Buyurtma yaratildi', en: 'Order placed' })[language];
    body = [restaurantName, orderLabels.PENDING_ACCEPTANCE![language]].filter(Boolean).join(' · ');
  } else if (notification.type === 'ORDER_STATUS') {
    title = ({ ru: 'Статус заказа обновлён', uz: 'Buyurtma holati yangilandi', en: 'Order status updated' })[language];
    body = [restaurantName, orderLabels[status]?.[language]].filter(Boolean).join(' · ') || title;
  } else if (notification.type === 'PAYMENT_STATUS') {
    title = ({ ru: 'Статус оплаты обновлён', uz: 'To‘lov holati yangilandi', en: 'Payment status updated' })[language];
    body = [restaurantName, paymentLabels[text(data.paymentStatus)]?.[language]].filter(Boolean).join(' · ') || title;
  } else if (notification.type === 'COMMENT_REPLY') {
    title = ({ ru: 'Новый ответ', uz: 'Yangi javob', en: 'New reply' })[language];
    body = language === 'ru' ? `${authorName} ответил на ваш комментарий` : language === 'uz' ? `${authorName} izohingizga javob berdi` : `${authorName} replied to your comment`;
  } else if (dispatchNoticeText(notification.type, { event: text(data.event), restaurantName, orderNumber: text(data.orderNumber) }, language)) {
    ({ title, body } = dispatchNoticeText(notification.type, { event: text(data.event), restaurantName, orderNumber: text(data.orderNumber) }, language)!);
  } else if (language !== 'ru') {
    title = ({ uz: 'UzBite bildirishnomasi', en: 'UzBite notification' })[language];
    body = ({ uz: 'Hisobingiz uchun yangi ma’lumot mavjud.', en: 'There is an update for your account.' })[language];
  }
  return { ...notification, title, body };
}
