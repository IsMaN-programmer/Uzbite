interface CartPriceInput {
  dishId: string;
  price: number | string;
  quantity: number;
}

interface QuotedPriceInput {
  dishId?: string;
  unitPrice: number;
  total?: number;
}

/** Prefer the server quote for display; local prices are estimates while it loads. */
export function cartLinePrice(item: CartPriceInput, quotedItems?: readonly QuotedPriceInput[]) {
  const quoted = quotedItems?.find((line) => line.dishId === item.dishId);
  const unitPrice = quoted?.unitPrice ?? Number(item.price);
  return {
    unitPrice,
    total: quoted?.total ?? unitPrice * item.quantity,
    verified: Boolean(quoted),
    updated: Boolean(quoted && Math.round(unitPrice * 100) !== Math.round(Number(item.price) * 100)),
  };
}
