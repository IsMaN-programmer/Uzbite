import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { DeliveryAddressSelection } from '@uzbite/shared';
import { api } from './api';

export function invalidateDeliveryContext(client: QueryClient) {
  return Promise.all([client.invalidateQueries({ queryKey: ['delivery-address'] }), client.invalidateQueries({ queryKey: ['restaurants'] })]);
}

export function useDeliveryAddress() {
  return useQuery({ queryKey: ['delivery-address'], queryFn: async ({ signal }) => (await api.get<{ data: DeliveryAddressSelection }>('/addresses/delivery', { signal })).data.data });
}

export function useSelectDeliveryAddress(onSelected?: () => void) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (addressId: string) => (await api.put<{ data: DeliveryAddressSelection }>('/addresses/delivery', { addressId })).data.data,
    onSuccess: selection => {
      client.setQueryData(['delivery-address'], selection);
      void client.invalidateQueries({ queryKey: ['restaurants'] });
      onSelected?.();
    },
  });
}
