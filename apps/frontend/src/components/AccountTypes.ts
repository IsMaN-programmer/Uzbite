export interface SavedAddress {
  id: string;
  label: string;
  addressText: string;
  latitude: number;
  longitude: number;
  entrance?: string | null;
  floor?: string | null;
  apartment?: string | null;
  comment?: string | null;
  isDefault: boolean;
}

export interface OrderItem {
  id: string;
  dishId?: string;
  name?: string;
  dishName?: string;
  nameSnapshot?: string;
  quantity: number;
  unitPrice: number;
  total?: number;
  imageUrl?: string | null;
}

export interface UserOrder {
  id: string;
  number?: string;
  restaurantId: string;
  restaurantName?: string;
  restaurant?: { id: string; name: string; logoUrl?: string; imageUrl?: string; coverUrl?: string; phone?: string | null; telegram?: string | null };
  status: 'PENDING_ACCEPTANCE' | 'ACCEPTED' | 'PREPARING' | 'DELIVERING' | 'DELIVERED' | 'CANCELLED';
  payment: { method: 'CASH' | 'CARD'; status: string; rejectionReason?: string | null } | null;
  items: OrderItem[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  addressSnapshot: SavedAddress;
  recipientName: string;
  recipientPhone: string;
  createdAt: string;
  updatedAt: string;
  review?: { id: string } | null;
}

export interface Quote {
  restaurant: { id: string; name: string; logoUrl?: string; isOpen: boolean; minOrder: number; cardPaymentAvailable: boolean; paymentDetails?: string | null; paymentQrUrl?: string | null; paymentInstructions?: string | null };
  items: OrderItem[];
  subtotal: number;
  deliveryFee: number;
  total: number;
}
