'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { changeOrderStatus, loadOrders } from '@/app/admin/pedidos/actions';
import { ORDER_STATUS_LABELS, ORDER_TRANSITIONS, PAYMENT_LABELS, type AdminOrder, type OrdersResult, type OrderStatus } from '@/lib/admin-order-types';
import { Button, Card, Money } from '@/components/ui';
import { useVisiblePolling } from '@/lib/use-visible-polling';

const dateFormat = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
const money = (cents: number) => <Money value={cents / 100} />;
const STATUS_STYLE: Record<OrderStatus, { className: string; icon: string }> = {
  new: { className: 'border-sky-300 bg-sky-100 text-sky-950', icon: '●' }, confirmed: { className: 'border-emerald-300 bg-emerald-100 text-emerald-950', icon: '✓' }, preparing: { className: 'border-orange-300 bg-orange-100 text-orange-950', icon: '◷' }, ready: { className: 'border-emerald-300 bg-emerald-100 text-emerald-950', icon: '✓' },
  out_for_delivery: { className: 'border-sky-300 bg-sky-100 text-sky-950', icon: '→' }, delivered: { className: 'border-emerald-300 bg-emerald-100 text-emerald-950', icon: '✓' }, cancelled: { className: 'border-red-300 bg-red-100 text-red-900', icon: '×' },
};
function StatusBadge({ status }: { status: OrderStatus }) { const style = STATUS_STYLE[status]; return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-black ${style.className}`}><span aria-hidden="true" className="mr-1.5">{style.icon}</span>{ORDER_STATUS_LABELS[status]}</span>; }

function StatusSelect({ order, disabled, update }: { order: AdminOrder; disabled: boolean; update: (order: AdminOrder, status: OrderStatus) => void }) {
  const nextStatuses = ORDER_TRANSITIONS[order.status];
  return <select aria-label={`Próximo status do pedido ${order.order_number}`} value="" disabled={disabled || nextStatuses.length === 0}
    onChange={event => { const status = nextStatuses.find(value => value === event.target.value); if (status) update(order, status); }}
    className="min-h-11 w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-bold text-stone-950 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-200 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-600 sm:w-auto">
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

  useVisiblePolling(refresh);
  useEffect(() => {
    const afterPrint = () => { printing.current = false; };
    window.addEventListener('afterprint', afterPrint);
    return () => window.removeEventListener('afterprint', afterPrint);
  }, []);

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
      <header className="rounded-3xl bg-gradient-to-br from-brand-900 to-brand-700 p-5 text-white shadow-[0_18px_50px_rgba(24,74,55,0.16)] sm:p-7"><div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-white/85">Operação em tempo real</p><h1 className="mt-1 text-2xl font-black sm:text-3xl">Pedidos</h1><p className="mt-2 max-w-xl text-sm font-medium text-white/90">Acompanhe o preparo, organize as entregas e mantenha cada pedido no próximo passo.</p><p className="mt-1 text-xs font-medium text-white/80">Atualização automática · horários de São Paulo</p></div><button disabled={disabled} onClick={() => void refresh()} className="min-h-12 w-full rounded-xl border border-white bg-white px-4 py-2.5 text-sm font-black text-brand-900 shadow-sm transition hover:bg-orange-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-wait disabled:bg-stone-200 disabled:text-stone-700 sm:w-auto">{refreshing ? 'Atualizando...' : 'Atualizar agora'}</button></div></header>
      {loadError && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{loadError}</p>}
      {actionError && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{actionError}</p>}
      {unauthorized && <a href="/login?redirectTo=/admin/pedidos" className="mt-3 inline-block font-semibold text-brand-600">Entrar novamente</a>}
      <p role="status" className="mt-3 min-h-5 text-sm font-semibold text-emerald-800">{savingId ? 'Salvando status...' : notice}</p>
      {data?.total === 0 && <Card className="mt-6 text-center"><h2 className="font-bold">Nenhum pedido recebido</h2><p className="mt-2 text-sm text-stone-600">Os novos pedidos aparecerão aqui automaticamente.</p></Card>}
      <div aria-busy={disabled} className="mt-4 grid gap-4 xl:grid-cols-2">
        {data?.orders.map(order => <Card key={order.id} className="overflow-hidden p-0">
          <article aria-label={`Pedido ${order.order_number}`}>
            <div className="border-b border-stone-100 p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-terracotta-700">Pedido #{order.order_number}</p><h2 className="mt-1 text-lg font-black text-stone-950">{order.customer_name_snapshot}</h2><p className="mt-1 text-sm text-stone-600">{dateFormat.format(new Date(order.created_at))}</p><p className="text-sm font-medium text-stone-700">{order.whatsapp_snapshot}</p></div><StatusBadge status={order.status}/></div><div className="mt-4 space-y-2">{order.items.map(item => <div key={item.id} className="flex items-start gap-2 text-sm"><span className="rounded-lg bg-stone-100 px-2 py-0.5 font-bold">{item.quantity}×</span><span><b>{item.product_name_snapshot}</b>{item.size_snapshot && <small className="ml-1 text-stone-600">· {item.size_snapshot === 'small' ? 'Pequena' : 'Grande'}</small>}{item.addons.length > 0 && <small className="block text-stone-600">{item.addons.map(addon => `${addon.quantity}× ${addon.addon_name_snapshot}`).join(' · ')}</small>}{item.notes && <small className="block font-medium text-terracotta-700">Obs.: {item.notes}</small>}</span></div>)}</div><div className="mt-4 flex flex-wrap gap-2 text-xs font-bold text-stone-800"><span className="rounded-full border border-stone-200 bg-stone-100 px-3 py-1.5">{order.delivery_method === 'delivery' ? 'Entrega' : 'Retirada'}</span><span className="rounded-full border border-stone-200 bg-stone-100 px-3 py-1.5">{PAYMENT_LABELS[order.payment_method]}</span></div></div>
            <div className="flex flex-col gap-3 bg-stone-50/70 p-4 sm:p-5"><div className="flex items-end justify-between"><span className="text-xs font-bold uppercase tracking-wider text-stone-700">Total</span><b className="text-xl text-brand-900">{money(order.total_cents)}</b></div><div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
              <StatusSelect order={order} disabled={disabled} update={update} />
              <Button onClick={() => setSelectedId(order.id)} className="bg-stone-800">Detalhes</Button><button onClick={() => printOrder(order)} className="min-h-11 rounded-xl border bg-white px-4 text-sm font-bold">Imprimir</button></div>{ORDER_TRANSITIONS[order.status].includes('cancelled') && <button disabled={disabled} onClick={() => void update(order, 'cancelled')} className="self-start text-sm font-semibold text-red-700 hover:underline disabled:opacity-50">Cancelar pedido</button>}</div>
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
      <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-terracotta-700">Detalhes do pedido</p><h2 id="order-title" className="mt-1 text-xl font-black text-stone-950">Pedido #{order.order_number}</h2><p className="mt-1 text-sm text-stone-600">{dateFormat.format(new Date(order.created_at))}</p></div><div className="flex items-center gap-3"><StatusBadge status={order.status}/><button aria-label="Fechar detalhes" onClick={close} className="grid h-11 w-11 place-items-center rounded-full bg-stone-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-900 print:hidden">✕</button></div></div>
      <div className="mt-4 space-y-3 text-sm">
        <div className="rounded-2xl bg-emerald-50/70 p-4"><b className="text-brand-900">{order.customer_name_snapshot}</b><p className="mt-1 text-stone-600">{order.whatsapp_snapshot}</p></div>
        <div><b>Itens:</b><ul className="mt-2 space-y-3">{order.items.map(item => <li key={item.id} className="rounded-lg bg-stone-50 p-3 print:break-inside-avoid">
          <p className="font-semibold">{item.quantity}× {item.product_name_snapshot}</p>
          {item.public_name_snapshot !== item.product_name_snapshot && <p className="text-xs text-stone-600">Cliente viu: {item.public_name_snapshot}</p>}
          {item.size_snapshot && <p>Tamanho: {item.size_snapshot === 'small' ? 'Pequena' : 'Grande'}</p>}
          <p>{money(item.unit_price_cents)} por unidade · {money(item.unit_price_cents * item.quantity)}</p>
          {item.notes && <p className="mt-1 whitespace-pre-wrap"><b>Observação do item:</b> {item.notes}</p>}
          {item.addons.length > 0 && <ul className="mt-2 space-y-1">{item.addons.map(addon => <li key={addon.id}>+ {addon.quantity}× {addon.addon_name_snapshot} · {money(addon.unit_price_cents)} por unidade · {money(addon.unit_price_cents * addon.quantity)}</li>)}</ul>}
        </li>)}</ul></div>
        <p className="whitespace-pre-wrap"><b>Observações:</b> {order.notes || 'Nenhuma'}</p>
        <p><b>Recebimento:</b> {order.delivery_method === 'delivery' ? 'Entrega' : 'Retirada no balcão'}</p>
        {order.delivery_method === 'delivery' && <p className="whitespace-pre-wrap"><b>Endereço:</b> {order.address_snapshot || 'Não informado'}</p>}
        <p><b>Pagamento:</b> {PAYMENT_LABELS[order.payment_method]} · <b>Troco para:</b> {order.change_for_cents === null ? '—' : money(order.change_for_cents)}</p>
        <dl className="space-y-2 rounded-2xl bg-stone-50 p-4"><div className="flex justify-between"><dt>Subtotal</dt><dd>{money(order.subtotal_cents)}</dd></div><div className="flex justify-between"><dt>Taxa de entrega</dt><dd>{money(order.delivery_fee_cents)}</dd></div><div className="flex justify-between border-t pt-3 text-lg font-black text-brand-900"><dt>Total</dt><dd>{money(order.total_cents)}</dd></div></dl>
      </div>
      <div className="mt-5 flex gap-2 print:hidden"><StatusSelect order={order} disabled={disabled} update={update} /><Button onClick={print} className="bg-stone-800">Imprimir</Button></div>
      {saving && <p role="status" className="mt-2 text-sm print:hidden">Salvando status...</p>}
      {error && <p role="alert" className="mt-2 text-sm text-red-700 print:hidden">{error}</p>}
    </Card>
  </div>;
}
