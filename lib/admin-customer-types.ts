import type { OrderStatus } from '@/lib/admin-order-types';

export const CUSTOMER_PROFILES = ['Novo', 'Frequente', 'VIP', 'Inativo'] as const;
export type CustomerProfile = typeof CUSTOMER_PROFILES[number];
export type CustomerAddress = { id: string; label: string | null; address_line: string; complement: string | null; neighborhood: string | null; city: string | null; postal_code: string | null };
export type CustomerOrderSummary = { id: string; order_number: number; created_at: string; status: OrderStatus; delivery_method: 'delivery' | 'pickup'; payment_method: 'pix' | 'cash' | 'card'; total_cents: number };
export type AdminCustomer = {
  id: string; name: string; whatsapp_normalized: string; created_at: string;
  first_order_at: string | null; last_order_at: string | null; order_count: number;
  total_spent_cents: number; average_ticket_cents: number; profile: CustomerProfile;
  favorite_product: string | null; favorite_payment: CustomerOrderSummary['payment_method'] | null;
  internal_notes: string | null; addresses: CustomerAddress[]; orders: CustomerOrderSummary[];
};
export type CustomersResult = { data: AdminCustomer[]; error?: never } | { data?: never; error: string; unauthorized?: boolean };

export function classifyCustomer(orderCount: number, totalSpentCents: number, lastOrderAt: string | null, now = new Date()): CustomerProfile {
  const inactiveAfterMs = 60 * 24 * 60 * 60 * 1000;
  if (lastOrderAt && now.getTime() - new Date(lastOrderAt).getTime() >= inactiveAfterMs) return 'Inativo';
  if (orderCount >= 10 || totalSpentCents >= 50_000) return 'VIP';
  if (orderCount >= 3) return 'Frequente';
  return 'Novo';
}
