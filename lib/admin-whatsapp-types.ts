import type { OrderStatus } from '@/lib/admin-order-types';

export type WhatsAppAddon = { id: string; addon_name_snapshot: string; quantity: number; unit_price_cents: number };
export type WhatsAppItem = { id: string; product_name_snapshot: string; public_name_snapshot: string; size_snapshot: 'small' | 'large' | null; quantity: number; unit_price_cents: number; notes: string | null; addons: WhatsAppAddon[] };
export type WhatsAppOrder = {
  id: string; order_number: number; customer_id: string; customer_name_snapshot: string; whatsapp_snapshot: string;
  status: OrderStatus; created_at: string; delivery_method: 'delivery' | 'pickup'; payment_method: 'pix' | 'cash' | 'card';
  total_cents: number; address_snapshot: string | null; notes: string | null; items: WhatsAppItem[];
};
export type WhatsAppConversationState = 'new' | 'waiting' | 'active' | 'resolved';
export type WhatsAppMessageStatus = 'received' | 'queued' | 'accepted' | 'sent' | 'delivered' | 'read' | 'failed';
export type WhatsAppMessageOrigin = 'cloud_api' | 'business_app' | 'history';
export type WhatsAppConnectionState = 'not_configured' | 'connected' | 'coexistence_active' | 'attention' | 'removed';
export type WhatsAppSyncRun = { id: string; sync_type: 'history' | 'contacts'; state: 'pending' | 'processing' | 'completed' | 'failed'; phase: string | null; progress: number | null; items_processed: number; failure_message: string | null; updated_at: string };
export type WhatsAppConversation = {
  id: string; phone_number_id: string; wa_id: string; phone_e164: string; customer_id: string | null;
  latest_order_id: string | null; state: WhatsAppConversationState; unread_count: number; last_inbound_at: string | null;
  last_outbound_at: string | null; last_message_at: string | null; service_window_expires_at: string | null;
  customer: { id: string; name: string; whatsapp_normalized: string } | null; latest_order: WhatsAppOrder | null;
};
export type WhatsAppMessage = {
  id: string; conversation_id: string; external_message_id: string | null; direction: 'inbound' | 'outbound';
  message_origin: WhatsAppMessageOrigin; message_type: string; content_text: string | null; template_name: string | null; status: WhatsAppMessageStatus;
  automatic: boolean; received_at: string | null; accepted_at: string | null; sent_at: string | null;
  delivered_at: string | null; read_at: string | null; failed_at: string | null; failure_message: string | null; created_at: string;
};
export type WhatsAppCenterData = { conversations: WhatsAppConversation[]; fallback_orders: WhatsAppOrder[]; integration_enabled: boolean; official_available: boolean; automations_enabled: boolean; connection_state: WhatsAppConnectionState; last_account_event: string | null; sync_runs: WhatsAppSyncRun[]; restaurant_name: string; delivery_minutes_min: number | null; delivery_minutes_max: number | null };
export type WhatsAppCenterResult = { data: WhatsAppCenterData; error?: never } | { data?: never; error: string; unauthorized?: boolean };
export type WhatsAppMessagesResult = { data: WhatsAppMessage[]; error?: never } | { data?: never; error: string; unauthorized?: boolean };
export type QueueWhatsAppResult = { data: { message_id: string }; error?: never } | { data?: never; error: string; unauthorized?: boolean };
