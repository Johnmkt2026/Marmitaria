import 'server-only';
import { requireAdminClient } from '@/lib/admin-orders';
import type { AdminSettings } from '@/lib/admin-settings-types';

export async function getAdminSettings(): Promise<AdminSettings> {
  const db = await requireAdminClient();
  const { data, error } = await db.from('restaurant_settings')
    .select('id,name,is_open,delivery_fee_cents,delivery_minutes_min,delivery_minutes_max,updated_at')
    .order('created_at').order('id').limit(1).maybeSingle<AdminSettings>();
  if (error) throw new Error('Falha ao carregar configurações');
  if (!data) throw new Error('Restaurante não configurado');
  return data;
}
