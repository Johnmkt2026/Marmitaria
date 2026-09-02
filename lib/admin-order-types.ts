// Valores persistidos: os rótulos traduzidos nunca são enviados ao banco.
export const ORDER_STATUSES = ['new', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled'] as const;
export type OrderStatus = typeof ORDER_STATUSES[number];
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: 'Novo', confirmed: 'Confirmado', preparing: 'Preparando', ready: 'Pronto',
  out_for_delivery: 'Saiu para entrega', delivered: 'Entregue', cancelled: 'Cancelado',
};
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  new: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['out_for_delivery', 'delivered', 'cancelled'],
  out_for_delivery: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};
export function isOrderTransitionAllowed(current: OrderStatus, next: OrderStatus) {
  return ORDER_TRANSITIONS[current].includes(next);
}
export const PAYMENT_LABELS = { pix: 'Pix', cash: 'Dinheiro', card: 'Cartão' } as const;
export type OrderAddon = {
  id: string; addon_name_snapshot: string; unit_price_cents: number; quantity: number;
};
export type OrderItem = {
  id: string; product_name_snapshot: string; unit_price_cents: number; quantity: number;
  notes: string | null; addons: OrderAddon[];
};
export type AdminOrder = {
  id: string; order_number: number; status: OrderStatus; created_at: string; updated_at: string;
  customer_name_snapshot: string; whatsapp_snapshot: string;
  delivery_method: 'delivery' | 'pickup'; payment_method: keyof typeof PAYMENT_LABELS;
  address_snapshot: string | null; notes: string | null; change_for_cents: number | null;
  subtotal_cents: number; delivery_fee_cents: number; total_cents: number; items: OrderItem[];
};
export type OrdersPage = { orders: AdminOrder[]; page: number; total: number; pageSize: number };
export type OrderFailure = { error: string; unauthorized?: boolean };
export type OrdersResult = { data: OrdersPage; error?: never } | (OrderFailure & { data?: never });
export type StatusResult = { data: Pick<AdminOrder, 'id' | 'status' | 'updated_at'>; error?: never }
  | (OrderFailure & { data?: never; conflict?: boolean; invalidTransition?: boolean });
