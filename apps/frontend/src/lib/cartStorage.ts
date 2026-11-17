export interface CartItem {
  dishId: string;
  restaurantId: string;
  name: string;
  price: number | string;
  imageUrl: string;
  quantity: number;
}
export interface CartDish { id: string; restaurantId: string; name: string; price: number | string; imageUrl: string }
type CartStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function parseCart(raw: string | null): CartItem[] {
  try {
    const items: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(items) || items.length > 50) return [];
    const valid = items.every((item: unknown): item is CartItem => {
      if (!item || typeof item !== 'object') return false;
      const value = item as Partial<CartItem>;
      return typeof value.dishId === 'string' && value.dishId.length > 0
        && typeof value.restaurantId === 'string' && value.restaurantId.length > 0
        && typeof value.name === 'string' && typeof value.imageUrl === 'string'
        && (typeof value.price === 'number' || typeof value.price === 'string')
        && Number.isFinite(Number(value.price)) && Number(value.price) >= 0
        && Number.isInteger(value.quantity) && value.quantity! >= 1 && value.quantity! <= 99;
    });
    if (!valid || new Set(items.map(item => item.dishId)).size !== items.length
      || items.some(item => item.restaurantId !== items[0]?.restaurantId)) return [];
    return items;
  } catch { return []; }
}

export function loadCart(userId: string, storage?: Pick<CartStorage, 'getItem'>): CartItem[] {
  try { return parseCart((storage ?? localStorage).getItem(`uzbite-cart:${userId}`)); } catch { return []; }
}
export function saveCart(userId: string, items: CartItem[], storage?: Pick<CartStorage, 'setItem'>): boolean {
  try { (storage ?? localStorage).setItem(`uzbite-cart:${userId}`, JSON.stringify(items)); return true; } catch { return false; }
}
