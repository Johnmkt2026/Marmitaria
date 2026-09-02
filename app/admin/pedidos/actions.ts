'use server';

import { z } from 'zod';
import { AdminAccessError, getAdminOrders, requireAdminClient } from '@/lib/admin-orders';
import { isOrderTransitionAllowed, ORDER_STATUSES, type AdminOrder, type OrdersResult, type StatusResult } from '@/lib/admin-order-types';

export async function loadOrders(page: unknown = 1): Promise<OrdersResult> {
  const parsed = z.number().int().min(1).max(1000000).safeParse(page);
  if (!parsed.success) return { error: 'Página inválida.' };
  try {
    return { data: await getAdminOrders(parsed.data) };
  } catch (error) {
    return error instanceof AdminAccessError
      ? { error: error.message, unauthorized: true }
      : { error: 'Não foi possível atualizar os pedidos. Tente novamente.' };
  }
}

const statusSchema = z.object({
  id: z.string().uuid(), status: z.enum(ORDER_STATUSES), updatedAt: z.string().datetime({ offset: true }),
});

export async function changeOrderStatus(input: unknown): Promise<StatusResult> {
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return { error: 'Pedido ou status inválido.' };
  try {
    const db = await requireAdminClient();
    const { data: current, error: readError } = await db.from('orders').select('id,status,updated_at')
      .eq('id', parsed.data.id)
      .maybeSingle<Pick<AdminOrder, 'id' | 'status' | 'updated_at'>>();
    if (readError) return { error: 'Não foi possível consultar o estado atual do pedido.' };
    if (!current) return { error: 'Pedido não encontrado ou indisponível.', conflict: true };
    if (current.updated_at !== parsed.data.updatedAt) {
      return { error: 'Este pedido foi alterado por outro administrador. Atualize o painel antes de tentar novamente.', conflict: true };
    }
    if (!isOrderTransitionAllowed(current.status, parsed.data.status)) {
      return { error: `A transição de ${current.status} para ${parsed.data.status} não é permitida.`, invalidTransition: true };
    }
    // Só o status pode ser alterado. RLS usa a sessão do operador, sem service role.
    // A versão evita sobrescrever silenciosamente outro operador. O trigger existente
    // grava a transição e auth.uid() em order_status_history na mesma transação.
    const { data, error } = await db.from('orders').update({ status: parsed.data.status })
      .eq('id', parsed.data.id).eq('status', current.status).eq('updated_at', current.updated_at)
      .select('id,status,updated_at').maybeSingle<Pick<AdminOrder, 'id' | 'status' | 'updated_at'>>();
    if (error) return { error: 'Não foi possível salvar o status. Tente novamente.' };
    if (!data) return { error: 'Este pedido foi alterado por outro operador ou não está mais disponível. Atualize o painel.', conflict: true };
    return { data };
  } catch (error) {
    return error instanceof AdminAccessError
      ? { error: error.message, unauthorized: true }
      : { error: 'Não foi possível salvar o status. Tente novamente.' };
  }
}
