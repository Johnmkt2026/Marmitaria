import 'server-only';
import { AdminAccessError, requireAdminClient } from '@/lib/admin-orders';
import type { WhatsAppCenterData, WhatsAppCenterResult, WhatsAppConnectionState, WhatsAppConversation, WhatsAppMessage, WhatsAppMessagesResult, WhatsAppOrder, WhatsAppSyncRun } from '@/lib/admin-whatsapp-types';

type SettingsRow = { name: string; delivery_minutes_min: number | null; delivery_minutes_max: number | null };

export async function getWhatsAppCenterData(): Promise<WhatsAppCenterData> {
  const db = await requireAdminClient();
  const orderSelect = `id,order_number,customer_id,customer_name_snapshot,whatsapp_snapshot,status,created_at,
    delivery_method,payment_method,total_cents,address_snapshot,notes,
    items:order_items(id,product_name_snapshot,public_name_snapshot,size_snapshot,quantity,unit_price_cents,notes,
      addons:order_item_addons(id,addon_name_snapshot,quantity,unit_price_cents))`;
  const [conversationsResult, ordersResult, settingsResult, whatsappSettingsResult, syncRunsResult] = await Promise.all([
    db.from('whatsapp_conversations').select(`id,phone_number_id,wa_id,phone_e164,customer_id,latest_order_id,state,unread_count,
      last_inbound_at,last_outbound_at,last_message_at,service_window_expires_at,
      customer:customers(id,name,whatsapp_normalized),latest_order:orders(${orderSelect})`)
      .order('last_message_at', { ascending: false, nullsFirst: false }).order('id', { ascending: false }).limit(100).returns<WhatsAppConversation[]>(),
    db.from('orders').select(orderSelect).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(100).returns<WhatsAppOrder[]>(),
    db.from('restaurant_settings').select('name,delivery_minutes_min,delivery_minutes_max').limit(1).single<SettingsRow>(),
    db.from('whatsapp_settings').select('automations_enabled,connection_state,last_account_event').eq('singleton',true).single<{ automations_enabled: boolean; connection_state: WhatsAppConnectionState; last_account_event: string | null }>(),
    db.from('whatsapp_sync_runs').select('id,sync_type,state,phase,progress,items_processed,failure_message,updated_at')
      .order('updated_at',{ ascending: false }).order('id',{ ascending: false }).limit(10).returns<WhatsAppSyncRun[]>(),
  ]);
  if (conversationsResult.error || !conversationsResult.data) throw new Error('Falha ao carregar conversas');
  if (ordersResult.error || !ordersResult.data) throw new Error('Falha ao carregar atendimentos');
  if (settingsResult.error || !settingsResult.data) throw new Error('Falha ao carregar configurações');
  if (whatsappSettingsResult.error || !whatsappSettingsResult.data) throw new Error('Falha ao carregar configurações do WhatsApp');
  if (syncRunsResult.error || !syncRunsResult.data) throw new Error('Falha ao carregar sincronizações do WhatsApp');
  const integrationEnabled = process.env.WHATSAPP_INTEGRATION_ENABLED === 'true';
  const officialAvailable = integrationEnabled && !['removed','attention'].includes(whatsappSettingsResult.data.connection_state);
  return { conversations: conversationsResult.data, fallback_orders: ordersResult.data,
    integration_enabled: integrationEnabled, official_available: officialAvailable,
    automations_enabled: whatsappSettingsResult.data.automations_enabled,
    connection_state: whatsappSettingsResult.data.connection_state, last_account_event: whatsappSettingsResult.data.last_account_event,
    sync_runs: syncRunsResult.data,
    restaurant_name: settingsResult.data.name,
    delivery_minutes_min: settingsResult.data.delivery_minutes_min, delivery_minutes_max: settingsResult.data.delivery_minutes_max };
}

export async function getWhatsAppMessages(conversationId: string, beforeCreatedAt?: string, beforeId?: string): Promise<WhatsAppMessage[]> {
  const db = await requireAdminClient();
  let query = db.from('whatsapp_messages').select('id,conversation_id,external_message_id,direction,message_origin,message_type,content_text,template_name,status,automatic,received_at,accepted_at,sent_at,delivered_at,read_at,failed_at,failure_message,created_at')
    .eq('conversation_id', conversationId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(50);
  if (beforeCreatedAt && beforeId) query = query.or(`created_at.lt.${beforeCreatedAt},and(created_at.eq.${beforeCreatedAt},id.lt.${beforeId})`);
  const { data, error } = await query.returns<WhatsAppMessage[]>();
  if (error || !data) throw new Error('Falha ao carregar mensagens');
  return data.reverse();
}

export async function getWhatsAppCenterResult(): Promise<WhatsAppCenterResult> {
  try { return { data: await getWhatsAppCenterData() }; }
  catch (error) { return error instanceof AdminAccessError ? { error: error.message, unauthorized: true } : { error: 'Não foi possível carregar a central de atendimento.' }; }
}
export async function getWhatsAppMessagesResult(conversationId: string, beforeCreatedAt?: string, beforeId?: string): Promise<WhatsAppMessagesResult> {
  try { return { data: await getWhatsAppMessages(conversationId, beforeCreatedAt, beforeId) }; }
  catch (error) { return error instanceof AdminAccessError ? { error: error.message, unauthorized: true } : { error: 'Não foi possível carregar o histórico.' }; }
}
