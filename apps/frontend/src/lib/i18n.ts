export type Language='ru'|'uz'|'en';
const messages={
 home:['Главная','Asosiy','Home'],search:['Поиск','Qidiruv','Explore'],orders:['Заказы','Buyurtmalar','Orders'],profile:['Профиль','Profil','Profile'],
 cartStorageUnavailable:['Браузер не сохраняет корзину. Она доступна до закрытия страницы.','Brauzer savatni saqlamayapti. U sahifa yopilguncha mavjud.','Your browser cannot save this bag. It is available until the page closes.'],
 markRead:['Отметить прочитанным','Oʻqilgan deb belgilash','Mark as read'], darkTheme:['Тёмная тема','Tungi koʻrinish','Dark theme'],lightTheme:['Светлая тема','Yorugʻ koʻrinish','Light theme'],navigation:['Навигация','Navigatsiya','Navigation'],
 feed:['Для вас','Siz uchun','For you'],following:['Подписки','Obunalar','Following'],tagline:['Вкус в каждом кадре','Har kadrda lazzat','A taste in every frame'],
 greeting:['Вкусно. Близко. Твоё.','Mazali. Yaqin. Sizniki.','Good food. Great finds.'],subheading:['Откройте для себя любимый вкус Ташкента','Toshkentning sevimli taʼmini kashf eting','Find your next favorite taste of Tashkent'],
 restaurants:['Рестораны','Restoranlar','Restaurants'],all:['Все','Barchasi','All'],viewAll:['Смотреть все','Barchasini koʻrish','View all'],
 toCart:['Заказать','Buyurtma qilish','Order now'],add:['Добавить','Qoʻshish','Add to order'],basket:['Корзина','Savat','Your bag'],
 location:['Доставка в Ташкенте','Toshkent boʻylab yetkazish','Delivery in Tashkent'],searchPlaceholder:['Ресторан, блюдо или кухня','Restoran, taom yoki oshxona','Restaurant, dish or cuisine'],
 forYou:['Вам понравится','Sizga yoqadi','Made for your cravings'],nearby:['Откройте новый вкус','Yangi taʼmni kashf eting','Find a new favorite'],
 nearbyText:['Небольшие открытия. Большая любовь к еде.','Kichik kashfiyotlar. Taomga katta mehr.','Small discoveries. A big love for food.'],
 explore:['Найти свой ресторан','Restoran topish','Explore restaurants'],open:['Открыт','Ochiq','Open'],closed:['Закрыт','Yopiq','Closed'],
 map:['Карта','Xarita','Map'],view:['Посмотреть','Koʻrish','View'],new:['Новый','Yangi','New'],menu:['Меню','Menyu','Menu'],posts:['Публикации','Nashrlar','Posts'],reviews:['Отзывы','Sharhlar','Reviews'],
 follow:['Подписаться','Obuna boʻlish','Follow'],unfollow:['Вы подписаны','Obuna boʻlgansiz','Following'],followers:['подписчиков','obunachi','followers'],
 retry:['Попробовать снова','Qayta urinish','Try again'],empty:['Здесь пока пусто','Hozircha boʻsh','Nothing here yet'],
 noPosts:['Новых публикаций пока нет','Hozircha yangi nashr yoʻq','No posts yet'],noFollowing:['Подпишитесь на рестораны, чтобы видеть их публикации','Nashrlarni koʻrish uchun restoranlarga obuna boʻling','Follow restaurants to see their latest posts'],
 noResults:['Ничего не найдено','Hech narsa topilmadi','No matches found'],noResultsText:['Попробуйте другое название блюда или ресторана','Boshqa taom yoki restoran nomini kiriting','Try another dish or restaurant name'],
 comments:['Комментарии','Izohlar','Comments'],commentPlaceholder:['Поделитесь впечатлением…','Fikringizni yozing…','Share your thoughts…'],send:['Отправить','Yuborish','Send'],reply:['Ответить','Javob berish','Reply'],
 share:['Поделиться','Ulashish','Share'],copied:['Ссылка скопирована','Havola nusxalandi','Link copied'],like:['Нравится','Yoqdi','Like'],
 loadMore:['Показать ещё','Yana koʻrsatish','Load more'],notifications:['Уведомления','Bildirishnomalar','Notifications'],noNotifications:['Новых уведомлений пока нет','Yangi bildirishnoma yoʻq','You’re all caught up'],
 cancel:['Отмена','Bekor qilish','Cancel'],replace:['Очистить и добавить','Tozalash va qoʻshish','Replace and add'],replaceTitle:['Начнём новую корзину?','Yangi savat ochamizmi?','Start a new bag?'],
 replaceText:['В корзине уже есть блюда другого ресторана. Очистить корзину и добавить новое блюдо?','Savatda boshqa restoran taomlari bor. Tozalab, yangi taom qoʻshilsinmi?','Your bag has dishes from another restaurant. Clear it and add this dish?'],
 added:['Добавлено в корзину','Savatga qoʻshildi','Added to your bag'],about:['О ресторане','Restoran haqida','About the restaurant'],
 noReviews:['Первый отзыв — после первого доставленного заказа','Birinchi sharh — yetkazilgan buyurtmadan soʻng','The first review starts with a delivered order'],verified:['Подтверждённый заказ','Tasdiqlangan buyurtma','Verified order'],
 unavailable:['Блюдо недоступно','Taom mavjud emas','Dish unavailable'],minOrder:['Мин. заказ','Eng kam buyurtma','Minimum order'],delivery:['Доставка','Yetkazish','Delivery'],
 videoUnavailable:['Видео недоступно. Можно посмотреть блюдо в меню.','Video mavjud emas. Taomni menyuda koʻring.','Video unavailable. Find the dish on the menu.'],
 connection:['Нет подключения к интернету','Internet aloqasi yoʻq','You’re offline'],footer:['Сделано с аппетитом в Узбекистане','Oʻzbekistonda ishtiyoq bilan yaratilgan','Made with an appetite in Uzbekistan'],
 demo:['Демонстрационный каталог','Namoyish katalogi','Demo catalog'],total:['Итого','Jami','Total']
} satisfies Record<string,readonly string[]>;
export type TranslationKey=keyof typeof messages;
export function translate(key:string,language:Language){return messages[key as TranslationKey]?.[language==='ru'?0:language==='uz'?1:2]??key;}
