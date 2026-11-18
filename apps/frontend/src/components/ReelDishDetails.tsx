import type { Dish } from '@uzbite/shared';
import { useApp } from '../context/AppContext';
import { catalogCategoryLabel } from '../lib/discovery';
import { money, useCopy } from './AccountPrimitives';

export function ReelDishDetails({ dish, canOrder }: { dish: Dish; canOrder: boolean }) {
  const { language } = useApp();
  const c = useCopy();
  const rows: [string, string][] = [];

  if (dish.weightGrams != null) rows.push([c('Вес порции', 'Porsiya vazni', 'Serving weight'), `${dish.weightGrams} ${c('г', 'g', 'g')}`]);
  if (dish.volumeMl != null) rows.push([c('Объём', 'Hajm', 'Volume'), `${dish.volumeMl} ${c('мл', 'ml', 'ml')}`]);
  if (dish.piecesPerPortion != null) rows.push([c('Количество в порции', 'Porsiyadagi soni', 'Pieces per serving'), `${dish.piecesPerPortion} ${c('шт.', 'dona', 'pcs')}`]);
  if (dish.diameterCm != null) rows.push([c('Диаметр', 'Diametr', 'Diameter'), `${dish.diameterCm} ${c('см', 'sm', 'cm')}`]);
  if (!rows.length) rows.push([c('Размер порции', 'Porsiya hajmi', 'Serving size'), c('Не указан', 'Ko‘rsatilmagan', 'Not specified')]);

  rows.push(
    [c('Категория', 'Toifa', 'Category'), catalogCategoryLabel(dish.catalogCategory ?? 'OTHER', language)],
    [c('Цена', 'Narx', 'Price'), money(dish.price, language)],
    [c('Доступность', 'Holat', 'Availability'), canOrder ? c('Можно заказать', 'Buyurtma berish mumkin', 'Available') : c('Сейчас недоступно', 'Hozir mavjud emas', 'Currently unavailable')],
  );

  return <table className="reel-dish-specs" aria-label={c('Информация о блюде', 'Taom haqida ma’lumot', 'Dish information')}>
    <tbody>
      {rows.map(([label, value]) => <tr key={label}>
        <th scope="row">{label}</th>
        <td>{value}</td>
      </tr>)}
    </tbody>
  </table>;
}
