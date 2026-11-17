import type { Language } from '@uzbite/shared';

const categories: Record<string, { uz: string; en: string; icon: string; tint: string; short?: string }> = {
  'Узбекская кухня': { uz: 'O‘zbekcha', en: 'Uzbek', icon: '🍛', tint: '#f4ecdf', short: 'Узбекская' },
  'Бургеры': { uz: 'Burgerlar', en: 'Burgers', icon: '🍔', tint: '#f6ecde' },
  'Салаты': { uz: 'Salatlar', en: 'Salads', icon: '🥗', tint: '#e9f1e9' },
  'Пицца': { uz: 'Pitsa', en: 'Pizza', icon: '🍕', tint: '#f7e9e4' },
  'Выпечка': { uz: 'Pishiriqlar', en: 'Bakery', icon: '🥐', tint: '#f7efdf' },
  'Паста': { uz: 'Pasta', en: 'Pasta', icon: '🍝', tint: '#f2eee1' },
  'Лапша': { uz: 'Lag‘mon', en: 'Noodles', icon: '🍜', tint: '#e7eeed' },
  'Горячее': { uz: 'Issiq taom', en: 'Mains', icon: '🥘', tint: '#f4e8e1' },
  'Напитки': { uz: 'Ichimliklar', en: 'Drinks', icon: '🧋', tint: '#f1e6ef' },
  'Завтраки': { uz: 'Nonushta', en: 'Breakfast', icon: '🍳', tint: '#f7f0de' },
  'Закуски': { uz: 'Gazaklar', en: 'Sides', icon: '🍟', tint: '#f4ebdf' },
  'Роллы': { uz: 'Rollar', en: 'Rolls', icon: '🍣', tint: '#e7efeb' },
  'Рис': { uz: 'Guruch', en: 'Rice', icon: '🍚', tint: '#e9ecef' },
};

export const featuredCategories = ['Бургеры', 'Салаты', 'Узбекская кухня', 'Выпечка', 'Напитки', 'Пицца'];
export function categoryLabel(name: string, language: Language, short = false) {
  const category = categories[name];
  return language === 'ru' ? (short ? category?.short ?? name : name) : category?.[language] ?? name;
}
export function categoryArtwork(name: string) { return categories[name] ?? { icon: '🍽️', tint: '#eef0ed' }; }
