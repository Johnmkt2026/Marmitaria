import type { OrderStatus } from '@/lib/admin-order-types';

export type WhatsAppAddon = { id: string; addon_name_snapshot: string; quantity: number; unit_price_cents: number };
export type WhatsAppItem = { id: string; product_name_snapshot: string; quantity: number; unit_price_cents: number; notes: string | null; addons: WhatsAppAddon[] };
export type WhatsAppOrder = {
  id: string; order_number: number; customer_id: string; customer_name_snapshot: string; whatsapp_snapshot: string;
  status: OrderStatus; created_at: string; delivery_method: 'delivery' | 'pickup'; payment_method: 'pix' | 'cash' | 'card';
  total_cents: number; address_snapshot: string | null; notes: string | null; items: WhatsAppItem[];
};
export type WhatsAppCenterData = { orders: WhatsAppOrder[]; restaurant_name: string; delivery_minutes_min: number | null; delivery_minutes_max: number | null };
export type WhatsAppCenterResult = { data: WhatsAppCenterData; error?: never } | { data?: never; error: string; unauthorized?: boolean };
