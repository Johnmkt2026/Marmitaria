import 'server-only';
import { AdminAccessError, requireAdminClient } from '@/lib/admin-orders';
import type { WhatsAppCenterData, WhatsAppCenterResult, WhatsAppOrder } from '@/lib/admin-whatsapp-types';

type SettingsRow = { name: string; delivery_minutes_min: number | null; delivery_minutes_max: number | null };

export async function getWhatsAppCenterData(): Promise<WhatsAppCenterData> {
  const db = await requireAdminClient();
  const [ordersResult, settingsResult] = await Promise.all([
    db.from('orders').select(`
      id,order_number,customer_id,customer_name_snapshot,whatsapp_snapshot,status,created_at,
      delivery_method,payment_method,total_cents,address_snapshot,notes,
      items:order_items(id,product_name_snapshot,quantity,unit_price_cents,notes,
        addons:order_item_addons(id,addon_name_snapshot,quantity,unit_price_cents))
    `).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(100).returns<WhatsAppOrder[]>(),
    db.from('restaurant_settings').select('name,delivery_minutes_min,delivery_minutes_max').limit(1).single<SettingsRow>(),
  ]);
  if (ordersResult.error || !ordersResult.data) throw new Error('Falha ao carregar atendimentos');
  if (settingsResult.error || !settingsResult.data) throw new Error('Falha ao carregar configurações');
  return { orders: ordersResult.data, restaurant_name: settingsResult.data.name, delivery_minutes_min: settingsResult.data.delivery_minutes_min, delivery_minutes_max: settingsResult.data.delivery_minutes_max };
}

export async function getWhatsAppCenterResult(): Promise<WhatsAppCenterResult> {
  try { return { data: await getWhatsAppCenterData() }; }
  catch (error) { return error instanceof AdminAccessError ? { error: error.message, unauthorized: true } : { error: 'Não foi possível carregar a central de atendimento.' }; }
}
