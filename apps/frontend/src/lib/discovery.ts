import type { CatalogCategory, Language } from '@uzbite/shared';

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

const catalogLabels: Record<CatalogCategory, Record<Language, string>> = {
  NATIONAL: { ru: 'Национальное', uz: 'Milliy', en: 'National' },
  FAST_FOOD: { ru: 'Фаст-фуд', uz: 'Fastfud', en: 'Fast food' },
  FOREIGN: { ru: 'Зарубежное', uz: 'Xorijiy', en: 'International' },
  EASTERN: { ru: 'Восточное', uz: 'Sharqona', en: 'Eastern' },
  ASIAN: { ru: 'Азиатское', uz: 'Osiyo taomlari', en: 'Asian' },
  DRINKS: { ru: 'Напитки', uz: 'Ichimliklar', en: 'Drinks' },
  SALADS: { ru: 'Салаты', uz: 'Salatlar', en: 'Salads' },
  MEAT: { ru: 'Мясное', uz: 'Go‘shtli', en: 'Meat' },
  SNACKS: { ru: 'Закуски', uz: 'Gazaklar', en: 'Snacks' },
  OTHER: { ru: 'Другое', uz: 'Boshqa', en: 'Other' },
};

export function catalogCategoryLabel(category: CatalogCategory, language: Language) {
  return catalogLabels[category][language];
}

export function categoryLabel(name: string, language: Language, short = false) {
  const category = categories[name];
  return language === 'ru' ? (short ? category?.short ?? name : name) : category?.[language] ?? name;
}
export function categoryArtwork(name: string) { return categories[name] ?? { icon: '🍽️', tint: '#eef0ed' }; }
