/** JSON transport contracts shared by the browser and independent API. */
export const ORDER_STATUSES = ['PENDING_ACCEPTANCE', 'ACCEPTED', 'PREPARING', 'DELIVERING', 'DELIVERED', 'CANCELLED'] as const;
export type OrderStatus = typeof ORDER_STATUSES[number];
export const ACTIVE_ORDER_STATUSES = ['PENDING_ACCEPTANCE', 'ACCEPTED', 'PREPARING', 'DELIVERING'] as const;
export const PAYMENT_STATUSES = ['AWAITING_PAYMENT', 'AWAITING_CONFIRMATION', 'PAID', 'REJECTED'] as const;
export type PaymentStatus = typeof PAYMENT_STATUSES[number];
export type PaymentMethod = 'CASH' | 'CARD';
export type Language = 'ru' | 'uz' | 'en';
export type Theme = 'light' | 'dark';
export interface ApiResponse<T> { data: T }
export interface ApiError { error: { code: string; message: string; details?: unknown } }
export interface Page<T> { items: T[]; page: number; pageSize: number; total: number; hasMore: boolean }
export interface CartItemInput { dishId: string; quantity: number }
export interface AddressInput {
  latitude: number;
  longitude: number;
  addressText: string;
  label: string;
  entrance?: string;
  floor?: string;
  apartment?: string;
  comment?: string;
  isDefault?: boolean;
}
export interface SavedAddress extends AddressInput { id: string; createdAt: string; updatedAt: string }
export interface DeliveryAddressSelection { address: SavedAddress | null; source: 'selected' | 'order' | 'default' | 'none' }
export interface DeliveryEstimate { minMinutes: number; maxMinutes: number; distanceKm: number }
export interface UserSettings { language: Language; theme: Theme }
export interface PublicUser { id: string; name: string; username: string; avatarUrl: string | null }
export interface CurrentUser extends PublicUser {
  email: string | null;
  recipientName?: string | null;
  bio: string;
  phone: string | null;
  role: 'USER';
  usernameChangedAt: string | null;
  settings: UserSettings;
  createdAt: string;
}
/** Money uses PostgreSQL Decimal on the server; JSON numbers are only for display. */
export type Money = number;
export interface RestaurantSummary {
  deliveryEstimate?: DeliveryEstimate | null;
  cuisines?: string[];
  id: string;
  slug: string;
  name: string;
  description: string;
  logoUrl: string;
  coverUrl: string;
  galleryUrls?: string[];
  addressText: string;
  latitude: number;
  longitude: number;
  phone: string | null;
  telegram?: string | null;
  isOpen: boolean;
  deliveryFee: Money;
  minOrder: Money;
  rating: number | null;
  reviewCount: number;
  followerCount: number;
  isFollowing: boolean;
  cardPaymentAvailable: boolean;
}
export interface Dish {
  id: string;
  restaurantId: string;
  categoryId: string;
  name: string;
  description: string;
  price: Money;
  imageUrl: string;
  isAvailable: boolean;
}
export interface PostMedia {
  id: string;
  type: 'VIDEO' | 'IMAGE';
  url: string;
  posterUrl: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  size: number | null;
}
export interface Post {
  id: string;
  caption: string;
  createdAt: string;
  restaurant: RestaurantSummary;
  dish: Dish | null;
  media: PostMedia[];
  likeCount: number;
  commentCount: number;
  isLiked: boolean;
}
export interface Comment {
  id: string;
  postId: string;
  parentId: string | null;
  text: string;
  createdAt: string;
  user: PublicUser;
  replies?: Comment[];
}
export interface OrderItem {
  id: string;
  dishId: string | null;
  dishName: string;
  unitPrice: Money;
  quantity: number;
  imageUrl: string;
}
export interface Payment { method: PaymentMethod; status: PaymentStatus; rejectionReason: string | null }
export interface Order {
  id: string;
  restaurantId: string;
  restaurant?: Pick<RestaurantSummary, 'id' | 'name' | 'logoUrl' | 'phone' | 'telegram'>;
  restaurantName: string;
  restaurantAddress: string;
  addressSnapshot: AddressInput;
  recipientName: string;
  recipientPhone: string;
  subtotal: Money;
  deliveryFee: Money;
  total: Money;
  status: OrderStatus;
  items: OrderItem[];
  payment: Payment | null;
  createdAt: string;
  updatedAt: string;
}
export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string;
  readAt: string | null;
  createdAt: string;
}
