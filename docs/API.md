# Пользовательский REST API

Все браузерные запросы идут по относительному `/api` через Vite/reverse proxy. Успешный ответ: `{ "data": ... }`; ошибка: `{ "error": { "code": "...", "message": "..." } }`. Денежные значения в JSON — числа для отображения; источником стоимости остаётся PostgreSQL Decimal на сервере.

Для изменения данных сначала вызовите `GET /api/auth/csrf`, затем передавайте полученный `csrfToken` в `X-CSRF-Token` вместе с cookie. Авторизация использует HttpOnly cookies; произвольные JWT в теле запроса, роли и userId от клиента не принимаются за полномочия. На production необходим HTTPS для Secure cookies.

## Авторизация и профиль

| Метод и путь | Назначение |
| --- | --- |
| `GET /api/health` | Реальная готовность БД, Redis, rate limiting и S3; 503 при недоступности обязательных сервисов |
| `GET /api/auth/csrf` | Выдача CSRF cookie/token |
| `POST /api/auth/register` | `{email,password,language?,theme?}`; никнейм задаётся позже в настройках; только роль USER |
| `POST /api/auth/login` | `{email,password}` |
| `POST /api/auth/refresh` | Одноразовая ротация refresh nonce и перевыпуск access JWT |
| `POST /api/auth/logout` | Отзыв текущей сессии и очистка cookies |
| `GET /api/auth/me` | Текущий пользователь без хеша пароля и секретов |
| `GET /api/profile` | Профиль, настройки, счётчики подписок/заказов/лайков |
| `PATCH /api/profile` | Имя, bio, username/nickname, телефон, email, пароль, language, theme |
| `GET /api/profile/likes` | Понравившиеся публикации |
| `GET /api/profile/follows` | Подписки на рестораны |

Смена email/пароля требует `currentPassword`; новый пароль передаётся в `newPassword`. Смена никнейма ограничена 30 днями на сервере. Смена пароля отзывает остальные сессии. Неизвестные поля отклоняются Zod.

## Каталог и социальные действия

Ресторан в результатах поиска содержит `deliveryEstimate: {minMinutes,maxMinutes,distanceKm} | null`. Оценка рассчитывается сервером для текущего адреса аккаунта; без адреса и для закрытого ресторана возвращается `null`. Расстояние определяется по координатам, время включает `Restaurant.preparationMinutes` и модель движения курьера. Это ориентировочный диапазон, без live-маршрутизации и пробок.

| Метод и путь | Назначение |
| --- | --- |
| `GET /api/restaurants?q=&category=&open=true&freeDelivery=true&sort=name&page=&pageSize=` | Поиск, фильтры открытых/бесплатной доставки; sort: name, delivery (стоимость доставки), popular (подписчики); `{items,page,pageSize,total,hasMore}`, cuisines в каждой записи |
| `GET /api/categories` | Собственные категории ресторана |
| `GET /api/restaurants/:id` | Профиль по ID или slug: меню, категории, публикации, проверенные отзывы |
| `GET /api/feed?following=true&page=&pageSize=` | Общая лента либо лента подписок |
| `GET /api/posts/:id` | Отдельная публикация |
| `PUT /api/posts/:id/like` | Идемпотентное `{liked:boolean}` |
| `PUT /api/restaurants/:id/follow` | Идемпотентное `{following:boolean}` |
| `GET /api/posts/:id/comments?page=&pageSize=` | Корневые комментарии с ответами |
| `POST /api/posts/:id/comments` | `{text,parentId?}`; ответ только на корневой комментарий той же публикации |
| `POST /api/restaurants/:id/reviews` | `{orderId,rating,text}`; только собственный доставленный заказ, один отзыв на заказ |

Рейтинг рассчитывается по проверенным отзывам. Отсутствие отзывов возвращает `rating:null`. Приватные реквизиты не включаются в публичные карточки. Поиск не обращается к Yandex Organization Search.

## Адреса, корзина и заказы

| Метод и путь | Назначение |
| --- | --- |
| `GET /api/addresses` | Только собственные сохранённые адреса |
| `GET /api/addresses/delivery` | Текущий адрес доставки и source: selected / order / default / none |
| `PUT /api/addresses/delivery` | `{addressId}`; выбор собственного сохранённого адреса для каталога и оформления |
| `POST /api/addresses` | Сохранение `{latitude,longitude,addressText,label,entrance?,floor?,apartment?,comment?,isDefault?}` |
| `PATCH /api/addresses/:id` | Изменение своего адреса и основного адреса |
| `DELETE /api/addresses/:id` | Удаление; при удалении основного выбирается следующий |
| `POST /api/orders/quote` | `{items:[{dishId,quantity}]}`; актуальные цены, доступность, единый ресторан, доставка и сумма |
| `GET /api/orders` | Собственные заказы, включая снимки позиций, адреса и платежи |
| `POST /api/orders` | `{items,addressId,recipientName,recipientPhone,paymentMethod,receiptId?}` |
| `GET /api/orders/:id` | Только собственный заказ |

Корзина сохраняется на клиенте; сервер проверяет её заново при quote и создании заказа. Количество — целое 1–99, не больше 50 уникальных позиций. Цены и итог от клиента отклоняются как неизвестные поля. Отправка заказа выполняется в Serializable-транзакции, а частичный уникальный PostgreSQL-индекс запрещает второй активный заказ. Конфликт возвращает 409. Исторические данные не меняются после редактирования меню или сохранённого адреса.

Приоритет адреса доставки: явно выбранный в аккаунте → сохранённый адрес, совпадающий со снимком последнего заказа → основной/первый сохранённый. Выбор и оформление заказа обновляют `User.deliveryAddressId`. Удалённые адреса автоматически не восстанавливаются из истории. Выбор чужого адреса отклоняется; изменение основного адреса также выбирает его для доставки.

`paymentMethod` — `CASH` либо `CARD`. Для CARD необходимы настоящие настройки ресторана, приватное хранилище и собственный ещё не использованный receiptId. При отсутствии конфигурации возвращается `CARD_UNAVAILABLE`; наличие чека не подтверждает оплату.

## Загрузка файлов и уведомления

| Метод и путь | Назначение |
| --- | --- |
| `POST /api/uploads/avatar` | Multipart `file`, загрузка аватара в S3/CDN |
| `POST /api/uploads/receipt` | Multipart `file`, загрузка приватного чека |
| `GET /api/uploads/:id` | Только владелец чека; временная подписанная ссылка, `private, no-store` |
| `GET /api/notifications` | Сохранённые собственные уведомления |
| `PATCH /api/notifications/:id/read` | Прочитать собственное уведомление |

Загрузки ограничены размером и проверкой фактической сигнатуры. S3 без конфигурации не подменяется локальной заглушкой. Чеки хранятся в отдельном `S3_PRIVATE_BUCKET`; их ключи не выдаются посторонним.

## Socket.IO

Соединение `/socket.io` использует авторизованную cookie-сессию и разрешённый Origin. Сервер сам присоединяет пользователя в `user:<id>`.

- Клиент `order:join(orderId, ack)` получает `{ok:true}` только для собственного заказа.
- Клиент `post:join(postId)` подписывается на комментарии существующей публикации.
- Сервер `order:updated` уведомляет об актуальном заказе.
- Сервер `notification` доставляет сохранённое уведомление.
- Сервер `comment:created` доставляет комментарий в комнате публикации.

Событие не заменяет запись PostgreSQL. При переподключении клиент заново читает REST. Developer CLI публикует изменения через Redis; если Redis недоступен, статус остаётся сохранённым, а интерфейс получает его при повторном запросе API. Публичного HTTP/Socket endpoint для смены доставки или подтверждения оплаты нет.

## Дополнения после аудита

Регистрация принимает необязательные language (ru/uz/en) и theme (light/dark), сохраняя выбор экрана авторизации. PATCH profile принимает phone:null для очистки телефона. Пароли и currentPassword ограничены72байтами UTF-8, включая вход.

GET orders, profile/likes, profile/follows, notifications и posts/:id/comments принимают page/pageSize (по умолчанию12, максимум50) и сохраняют массив data. Рядом возвращается pagination:{page,pageSize,total,hasMore}. Вспомогательные данные уведомления хранятся в metadata; title/body локализуются при чтении по актуальным настройкам пользователя.

Закрытый CLI: npm run order:status -- ORDER_ID STATUS [PAYMENT_STATUS] [REJECTION_REASON]. PAYMENT_STATUS можно изменить без продвижения STATUS; REJECTED требует причину длиной3–500символов. Оплаченный/отклонённый платёж не переводится произвольно назад. CLI недоступен в production и не имеет публичного HTTP/Socket-аналога.

## Карта курьера и сторона ресторана

Кнопки «Принимаю заказы» нет, метода `PATCH /api/courier/availability` больше нет. Подтверждённый курьер всегда на линии, пока у него нет активной доставки: «Свой ресторан» — после привязки по коду ресторана, который его нанял, «Свободные доставки» — после допуска UzBite (`npm run courier:approve -- <email>`) и выбора города. Статус считает сервер: `profile.availability` — `AVAILABLE`, `BUSY` (есть принятая доставка) или `UNAVAILABLE` (не подтверждён для текущего режима или заблокирован; приложение пишет, что заказы берёт только верифицированный курьер). После настройки аккаунта сменить режим на «Свой ресторан» можно только с активной привязкой, иначе `PATCH /api/courier/work-mode` отвечает `409 AFFILIATION_REQUIRED`. Допуск, завершение настройки, смена режима или города сразу подбирают курьеру открытые поиски его города. Колонка `CourierProfile.isAvailable` больше не используется и будет удалена отдельной миграцией. Карту ресторанов подтверждённый курьер открывает с главного экрана.

`GET /api/courier/map` → `CourierMap { city, restaurants: CourierMapRestaurant[] }` (типы в `packages/shared/src/courier.ts`). На карте рестораны, которые сейчас ждут курьера:

- свободный поиск (`Delivery.status = SEARCHING`, срок поиска не истёк) в городе курьера — видят допущенные курьеры в режиме «Свободные доставки» с выбранным городом;
- личное предложение этому курьеру (`DeliveryOffer.status = PENDING`) — так ресторан зовёт своего курьера.

У ресторана: `id, name, logoUrl, addressText, latitude, longitude` (из `Restaurant`), `waitingOrders` — сколько заказов ждут курьера, `offerIds` — открытые предложения этому курьеру (принимаются как обычно, `POST /api/courier/delivery-offers/:id/accept`). Данных покупателя в ответе нет.

Живое обновление. Клиент отправляет `courier-map:join` (без аргументов, ответ `{ok}`); сервер сам выбирает комнату `courier-map:<city>` по профилю курьера и отказывает недопущенным. После любого изменения доставки ресторана сервер шлёт в комнату города ресторана `courier:map_updated {restaurantId}` — это подсказка, клиент перечитывает `GET /api/courier/map`. `courier-map:leave` выходит из комнаты. Личные предложения, как и раньше, приходят в `courier:<id>`.

Что делает сторона ресторана — новых методов не нужно, карта строится из существующего API:

1. Принять заказ: `POST /api/restaurant/orders/:id/accept` (по желанию `start-preparing`).
2. «Готов отдать заказ»: `POST /api/restaurant/orders/:id/delivery/search {reward?}` — ресторан появляется на карте свободных курьеров своего города и они получают предложение. Своему курьеру: `POST /api/restaurant/orders/:id/delivery/offer {courierId, reward?}`.
3. Поиск закрывается, когда курьер принял заказ, ресторан вызвал `POST /api/restaurant/orders/:id/delivery/cancel {reason?}` или истёк `DELIVERY_SEARCH_TTL_SECONDS`. Во всех случаях ресторан пропадает с карты сам.
4. Заказ готов к выдаче: `POST /api/restaurant/orders/:id/delivery/ready`.

Точка на карте — `Restaurant.latitude/longitude`, город — `Restaurant.city` (код из `SERVICE_CITIES`): неверные координаты ресторана дадут неверную точку у курьера. Аккаунт сотрудника: `npm run restaurant:staff -- <slug> <email>`, вход `POST /api/restaurant/auth/login`, Bearer-токен; сокет с `auth: {token}` попадает в комнату `restaurant:<id>`.

Ключ Яндекс Карт для приложения курьера: `EXPO_PUBLIC_YANDEX_MAPS_API_KEY` в `apps/mobile/.env` (ключ «JavaScript API и HTTP Геокодер» из кабинета разработчика Яндекса, см. `apps/mobile/.env.example`). Если у ключа ограничение по HTTP Referer, разрешите хост из `EXPO_PUBLIC_YANDEX_MAPS_REFERER` (по умолчанию `localhost`), а для браузерной версии — адрес, с которого она открыта. Без ключа экран показывает те же рестораны списком.

Регистрация: `POST /auth/register {email,password,language?,theme?}`. Вход: `POST /auth/login {email,password}`. Почта обязательна и нормализуется в нижний регистр, никнейм не служит учётными данными для входа. При регистрации создаётся временный никнейм, который пользователь заменяет в настройках профиля; первая установка доступна сразу, последующие изменения — раз в 30 дней. В профиле name/username/nickname обозначают одно имя. Имя получателя заказа хранится отдельно в recipientName.
