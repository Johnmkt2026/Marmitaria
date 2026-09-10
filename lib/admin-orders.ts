import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { AdminOrder, OrdersPage } from '@/lib/admin-order-types';

export class AdminAccessError extends Error {}

// Toda leitura periódica e toda mutação validam a sessão, mesmo sem renderizar o layout.
export async function requireAdminClient() {
  const db = await createClient();
  if (!db) throw new Error('Supabase indisponível');
  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user) throw new AdminAccessError('Entre novamente com uma conta administrativa.');
  const { data: admin, error: roleError } = await db.rpc('is_admin');
  if (roleError) throw new Error('Não foi possível validar o acesso');
  if (!admin) throw new AdminAccessError('Acesso administrativo necessário.');
  return db;
}

export async function getAdminOrders(page: number): Promise<OrdersPage> {
  const db = await requireAdminClient();
  const pageSize = 50;
  const start = (page - 1) * pageSize;
  // Um único SELECT PostgREST por página, incluindo as duas relações aninhadas.
  // Os snapshots preservam os dados da compra mesmo após mudanças no catálogo/cliente.
  const { data, error, count } = await db.from('orders').select(`
    id,order_number,status,created_at,updated_at,customer_name_snapshot,whatsapp_snapshot,
    delivery_method,payment_method,address_snapshot,notes,change_for_cents,
    subtotal_cents,delivery_fee_cents,total_cents,
    items:order_items(id,product_name_snapshot,public_name_snapshot,size_snapshot,unit_price_cents,quantity,notes,
      addons:order_item_addons(id,addon_name_snapshot,unit_price_cents,quantity))
  `, { count: 'exact' }).order('created_at', { ascending: false }).order('id', { ascending: false })
    .range(start, start + pageSize - 1).returns<AdminOrder[]>();
  if (error || !data) throw new Error('Falha ao carregar pedidos');
  return { orders: data, page, pageSize, total: count ?? data.length };
}
