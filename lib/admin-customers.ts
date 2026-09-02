import 'server-only';
import { requireAdminClient } from '@/lib/admin-orders';
import { classifyCustomer, type AdminCustomer, type CustomerAddress, type CustomerOrderSummary } from '@/lib/admin-customer-types';

type CustomerRow = {
  id: string; name: string; whatsapp_normalized: string; created_at: string;
  first_order_at: string | null; last_order_at: string | null; internal_notes: string | null;
  addresses: CustomerAddress[];
  orders: Array<CustomerOrderSummary & { items: Array<{ product_name_snapshot: string; quantity: number }> }>;
};

function mostFrequent<T extends string>(values: Array<{ value: T; weight: number }>): T | null {
  const totals = new Map<T, number>();
  for (const entry of values) totals.set(entry.value, (totals.get(entry.value) ?? 0) + entry.weight);
  return [...totals.entries()].sort(([nameA, countA], [nameB, countB]) => countB - countA || nameA.localeCompare(nameB))[0]?.[0] ?? null;
}

function mapCustomer(row: CustomerRow, now: Date): AdminCustomer {
  const orders = [...row.orders].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  // Cancelados permanecem no histórico, mas não representam receita nem frequência.
  const validOrders = orders.filter(order => order.status !== 'cancelled');
  const totalSpentCents = validOrders.reduce((total, order) => total + order.total_cents, 0);
  const orderCount = validOrders.length;
  return {
    id: row.id, name: row.name, whatsapp_normalized: row.whatsapp_normalized,
    created_at: row.created_at, first_order_at: row.first_order_at, last_order_at: row.last_order_at,
    order_count: orderCount, total_spent_cents: totalSpentCents,
    average_ticket_cents: orderCount ? Math.round(totalSpentCents / orderCount) : 0,
    profile: classifyCustomer(orderCount, totalSpentCents, row.last_order_at, now),
    favorite_product: mostFrequent(validOrders.flatMap(order => order.items.map(item => ({ value: item.product_name_snapshot, weight: item.quantity })))),
    favorite_payment: mostFrequent(validOrders.map(order => ({ value: order.payment_method, weight: 1 }))),
    internal_notes: row.internal_notes, addresses: row.addresses, orders,
  };
}

export async function getAdminCustomers(): Promise<AdminCustomer[]> {
  const db = await requireAdminClient();
  // Uma única consulta traz clientes, endereços, pedidos e itens, sem N+1.
  const { data, error } = await db.from('customers').select(`
    id,name,whatsapp_normalized,created_at,first_order_at,last_order_at,internal_notes,
    addresses:customer_addresses(id,label,address_line,complement,neighborhood,city,postal_code),
    orders(id,order_number,created_at,status,delivery_method,payment_method,total_cents,
      items:order_items(product_name_snapshot,quantity))
  `).order('last_order_at', { ascending: false, nullsFirst: false }).limit(500).returns<CustomerRow[]>();
  if (error || !data) throw new Error('Falha ao carregar clientes');
  const now = new Date();
  return data.map(row => mapCustomer(row, now)).sort((a, b) => Date.parse(b.last_order_at ?? b.created_at) - Date.parse(a.last_order_at ?? a.created_at));
}
