'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { changeOrderStatus, loadOrders } from '@/app/admin/pedidos/actions';
import { ORDER_STATUS_LABELS, ORDER_TRANSITIONS, PAYMENT_LABELS, type AdminOrder, type OrdersResult, type OrderStatus } from '@/lib/admin-order-types';
import { Badge, Button, Card, Money } from '@/components/ui';

const dateFormat = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
const money = (cents: number) => <Money value={cents / 100} />;

function StatusSelect({ order, disabled, update }: { order: AdminOrder; disabled: boolean; update: (order: AdminOrder, status: OrderStatus) => void }) {
  const nextStatuses = ORDER_TRANSITIONS[order.status];
  return <select aria-label={`Próximo status do pedido ${order.order_number}`} value="" disabled={disabled || nextStatuses.length === 0}
    onChange={event => { const status = nextStatuses.find(value => value === event.target.value); if (status) update(order, status); }}
    className="rounded-lg border px-2 py-2 text-sm disabled:opacity-50">
    <option value="" disabled>{nextStatuses.length ? 'Alterar status' : 'Status final'}</option>
    {nextStatuses.map(status => <option key={status} value={status}>{ORDER_STATUS_LABELS[status]}</option>)}
  </select>;
}

export function OrdersBoard({ initial }: { initial: OrdersResult }) {
  const [data, setData] = useState(initial.data ?? null);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(initial.error ?? null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState('unauthorized' in initial && !!initial.unauthorized);
  const [refreshing, setRefreshing] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const busy = useRef(false);
  const printing = useRef(false);
  const selected = data?.orders.find(order => order.id === selectedId) ?? null;

  const refresh = useCallback(async (targetPage = page) => {
    if (busy.current || printing.current) return;
    busy.current = true;
    setRefreshing(true);
    try {
      const result = await loadOrders(targetPage);
      if (result.data) {
        setData(result.data); setPage(targetPage); setLoadError(null); setUnauthorized(false);
      } else {
        setLoadError(result.error);
        if (result.unauthorized) { setData(null); setSelectedId(null); setUnauthorized(true); }
      }
    } catch { setLoadError('Conexão interrompida. Exibindo a última consulta recebida.'); }
    finally { busy.current = false; setRefreshing(false); }
  }, [page]);

  useEffect(() => {
    const updateVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const timer = window.setInterval(updateVisible, 10000);
    const afterPrint = () => { printing.current = false; };
    document.addEventListener('visibilitychange', updateVisible);
    window.addEventListener('focus', updateVisible);
    window.addEventListener('afterprint', afterPrint);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', updateVisible);
      window.removeEventListener('focus', updateVisible);
      window.removeEventListener('afterprint', afterPrint);
    };
  }, [refresh]);

  async function update(order: AdminOrder, status: OrderStatus) {
    if (busy.current || status === order.status) return;
    busy.current = true; setSavingId(order.id); setActionError(null); setNotice('');
    try {
      const result = await changeOrderStatus({ id: order.id, status, updatedAt: order.updated_at });
      if (result.data) {
        const saved = result.data;
        setData(current => current ? { ...current, orders: current.orders.map(item => item.id === saved.id ? { ...item, ...saved } : item) } : current);
        setNotice(`Pedido #${order.order_number}: ${ORDER_STATUS_LABELS[saved.status]}.`);
      } else {
        setActionError(result.error);
        if (result.unauthorized) { setData(null); setSelectedId(null); setUnauthorized(true); }
      }
    } catch { setActionError('Não foi possível confirmar a alteração. Atualize o painel antes de tentar novamente.'); }
    finally { busy.current = false; setSavingId(null); }
  }

  function printOrder(order: AdminOrder) {
    printing.current = true;
    flushSync(() => setSelectedId(order.id));
    window.print();
    printing.current = false;
  }
  const disabled = refreshing || savingId !== null;
  return <>
    <div className={selected ? 'print:hidden' : ''}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-2xl font-black">Pedidos</h1><p className="mt-1 text-stone-600">Pedidos reais, atualizados automaticamente a cada 10 segundos.</p><p className="mt-1 text-xs text-stone-500">Datas e horários de São Paulo.</p></div>
        <Button disabled={disabled} onClick={() => void refresh()}>{refreshing ? 'Atualizando...' : 'Atualizar agora'}</Button>
      </div>
      {loadError && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{loadError}</p>}
      {actionError && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{actionError}</p>}
      {unauthorized && <a href="/login?redirectTo=/admin/pedidos" className="mt-3 inline-block font-semibold text-brand-600">Entrar novamente</a>}
      <p role="status" className="mt-3 text-sm text-stone-600">{savingId ? 'Salvando status...' : notice}</p>
      {data?.total === 0 && <Card className="mt-6 text-center"><h2 className="font-bold">Nenhum pedido recebido</h2><p className="mt-2 text-sm text-stone-500">Os novos pedidos aparecerão aqui automaticamente.</p></Card>}
      <div aria-busy={disabled} className="mt-6 grid gap-4 xl:grid-cols-2">
        {data?.orders.map(order => <Card key={order.id}>
          <article aria-label={`Pedido ${order.order_number}`}>
            <div className="flex justify-between gap-3"><div><b>#{order.order_number} · {order.customer_name_snapshot}</b><p className="text-sm text-stone-500">{dateFormat.format(new Date(order.created_at))} · {order.whatsapp_snapshot}</p></div><Badge tone={order.status === 'cancelled' ? 'red' : order.status === 'delivered' ? 'green' : 'orange'}>{ORDER_STATUS_LABELS[order.status]}</Badge></div>
            <p className="mt-3 text-sm">{order.items.map(item => `${item.quantity}× ${item.product_name_snapshot}`).join(', ')}</p>
            <p className="mt-1 text-xs text-stone-500">{order.delivery_method === 'delivery' ? 'Entrega' : 'Retirada'} · {PAYMENT_LABELS[order.payment_method]}</p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <StatusSelect order={order} disabled={disabled} update={update} />
              <Button onClick={() => setSelectedId(order.id)} className="bg-stone-800">Detalhes</Button>
              {ORDER_TRANSITIONS[order.status].includes('cancelled') && <button disabled={disabled} onClick={() => void update(order, 'cancelled')} className="text-sm font-semibold text-red-600 disabled:opacity-50">Cancelar</button>}
              <button onClick={() => printOrder(order)} className="text-sm font-semibold text-stone-600">Imprimir</button>
              <b className="ml-auto">{money(order.total_cents)}</b>
            </div>
          </article>
        </Card>)}
      </div>
      {data && data.total > 0 && <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm">
        <p>{data.total} pedidos · Página {data.page} de {Math.max(1, Math.ceil(data.total / data.pageSize))}</p>
        <div className="flex gap-3"><button disabled={disabled || data.page <= 1} onClick={() => { setSelectedId(null); void refresh(page - 1); }} className="rounded-lg border bg-white px-3 py-2 disabled:opacity-40">Anteriores</button><button disabled={disabled || data.page * data.pageSize >= data.total} onClick={() => { setSelectedId(null); void refresh(page + 1); }} className="rounded-lg border bg-white px-3 py-2 disabled:opacity-40">Próximos</button></div>
      </div>}
    </div>
    {selected && <OrderModal order={selected} error={actionError} saving={savingId === selected.id} disabled={disabled} close={() => setSelectedId(null)} update={update} print={() => printOrder(selected)} />}
  </>;
}

function OrderModal({ order, error, saving, disabled, close, update, print }: {
  order: AdminOrder; error: string | null; saving: boolean; disabled: boolean; close: () => void;
  update: (order: AdminOrder, status: OrderStatus) => void; print: () => void;
}) {
  return <div role="dialog" aria-modal="true" aria-labelledby="order-title" className="fixed inset-0 z-30 grid place-items-center bg-black/40 p-4 print:static print:block print:bg-white print:p-0" onKeyDown={event => { if (event.key === 'Escape') close(); }}>
    <Card className="max-h-[90dvh] w-full max-w-lg overflow-y-auto print:max-h-none print:max-w-none print:overflow-visible print:border-0 print:shadow-none">
      <div className="flex justify-between"><h2 id="order-title" className="text-xl font-black">Pedido #{order.order_number}</h2><button aria-label="Fechar detalhes" onClick={close} className="print:hidden">✕</button></div>
      <p className="mt-1 text-sm text-stone-500">{dateFormat.format(new Date(order.created_at))} · {ORDER_STATUS_LABELS[order.status]}</p>
      <div className="mt-4 space-y-3 text-sm">
        <p><b>Cliente:</b> {order.customer_name_snapshot} · {order.whatsapp_snapshot}</p>
        <div><b>Itens:</b><ul className="mt-2 space-y-3">{order.items.map(item => <li key={item.id} className="rounded-lg bg-stone-50 p-3 print:break-inside-avoid">
          <p className="font-semibold">{item.quantity}× {item.product_name_snapshot}</p>
          <p>{money(item.unit_price_cents)} por unidade · {money(item.unit_price_cents * item.quantity)}</p>
          {item.notes && <p className="mt-1 whitespace-pre-wrap"><b>Observação do item:</b> {item.notes}</p>}
          {item.addons.length > 0 && <ul className="mt-2 space-y-1">{item.addons.map(addon => <li key={addon.id}>+ {addon.quantity}× {addon.addon_name_snapshot} · {money(addon.unit_price_cents)} por unidade · {money(addon.unit_price_cents * addon.quantity)}</li>)}</ul>}
        </li>)}</ul></div>
        <p className="whitespace-pre-wrap"><b>Observações:</b> {order.notes || 'Nenhuma'}</p>
        <p><b>Recebimento:</b> {order.delivery_method === 'delivery' ? 'Entrega' : 'Retirada no balcão'}</p>
        {order.delivery_method === 'delivery' && <p className="whitespace-pre-wrap"><b>Endereço:</b> {order.address_snapshot || 'Não informado'}</p>}
        <p><b>Pagamento:</b> {PAYMENT_LABELS[order.payment_method]} · <b>Troco para:</b> {order.change_for_cents === null ? '—' : money(order.change_for_cents)}</p>
        <dl className="space-y-1 border-t pt-3"><div className="flex justify-between"><dt>Subtotal</dt><dd>{money(order.subtotal_cents)}</dd></div><div className="flex justify-between"><dt>Taxa de entrega</dt><dd>{money(order.delivery_fee_cents)}</dd></div><div className="flex justify-between text-lg font-bold"><dt>Total</dt><dd>{money(order.total_cents)}</dd></div></dl>
      </div>
      <div className="mt-5 flex gap-2 print:hidden"><StatusSelect order={order} disabled={disabled} update={update} /><Button onClick={print} className="bg-stone-800">Imprimir</Button></div>
      {saving && <p role="status" className="mt-2 text-sm print:hidden">Salvando status...</p>}
      {error && <p role="alert" className="mt-2 text-sm text-red-700 print:hidden">{error}</p>}
    </Card>
  </div>;
}
