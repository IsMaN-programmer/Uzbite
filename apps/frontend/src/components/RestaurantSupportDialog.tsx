import type { UserOrder } from './AccountTypes';
import { Modal, useCopy } from './AccountPrimitives';
import { Icon } from './icons/Icon';
import { restaurantPhoneContact, restaurantTelegramContact } from '../lib/restaurant-contacts';

export function RestaurantSupportDialog({ order, onClose }: { order: UserOrder; onClose: () => void }) {
  const c = useCopy();
  const restaurant = order.restaurant;
  const phone = restaurantPhoneContact(restaurant?.phone);
  const telegram = restaurantTelegramContact(restaurant?.telegram);
  return <Modal title={c('Связаться с рестораном', 'Restoran bilan bog‘lanish', 'Contact the restaurant')} onClose={onClose}>
    <div className="restaurant-support-identity">{restaurant?.logoUrl ? <img src={restaurant.logoUrl} alt="" width="52" height="52"/> : <span><Icon name="restaurant" size={25}/></span>}<div><strong>{order.restaurantName || restaurant?.name || c('Ресторан', 'Restoran', 'Restaurant')}</strong><p>{c('По вопросам вашего заказа', 'Buyurtmangiz bo‘yicha', 'For questions about your order')}</p></div></div>
    {phone || telegram ? <div className="restaurant-support-contacts">
      {phone && <a href={phone.href}><span className="restaurant-support-icon"><Icon name="phone" size={21}/></span><span><small>{c('Позвонить', 'Qo‘ng‘iroq qilish', 'Call the restaurant')}</small><strong>{phone.label}</strong></span><Icon name="chevron" size={18}/></a>}
      {telegram && <a href={telegram.href} target="_blank" rel="noopener noreferrer"><span className="restaurant-support-icon"><Icon name="telegram" size={21}/></span><span><small>Telegram</small><strong>{telegram.label}</strong></span><Icon name="chevron" size={18}/></a>}
    </div> : <div className="restaurant-support-empty"><Icon name="comments" size={29}/><p>{c('Ресторан пока не указал телефон и Telegram для связи.', 'Restoran hali telefon va Telegram kontaktlarini ko‘rsatmagan.', 'The restaurant has not added a phone number or Telegram contact yet.')}</p></div>}
  </Modal>;
}
