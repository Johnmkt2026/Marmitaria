import { OrdersBoard } from '@/components/admin/orders-board';
import { loadOrders } from './actions';

export const dynamic = 'force-dynamic';

export default async function PedidosPage() {
  return <OrdersBoard initial={await loadOrders()} />;
}
