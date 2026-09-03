'use client';

import Link from 'next/link';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { loadDashboard } from '@/app/admin/actions';
import type { DashboardResult, OperationalStatus } from '@/lib/admin-dashboard-types';
import { ORDER_STATUS_LABELS } from '@/lib/admin-order-types';
import { Badge, Button, Card, Money } from '@/components/ui';
import { useVisiblePolling } from '@/lib/use-visible-polling';

const dateTime = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', timeStyle: 'short', dateStyle: 'short' });
const money = (cents: number) => <Money value={cents / 100} />;
const operational: OperationalStatus[] = ['new', 'confirmed', 'preparing', 'ready', 'out_for_delivery'];

export function AdminDashboard({ initial }: { initial: DashboardResult }) {
  const [data, setData] = useState(initial.data ?? null);
  const [error, setError] = useState(initial.error ?? null);
  const [refreshing, setRefreshing] = useState(false);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setRefreshing(true);
    try {
      const result = await loadDashboard();
      if (result.data) { setData(result.data); setError(null); }
      else { setError(result.error); if (result.unauthorized) setData(null); }
    } catch { setError('Conexão interrompida. Exibindo a última consulta recebida.'); }
    finally { busy.current = false; setRefreshing(false); }
  }, []);

  useVisiblePolling(refresh);

  if (!data) return <><Header refreshing={refreshing} refresh={refresh} /><Card className="mt-6"><p role="alert" className="text-red-700">{error ?? 'Indicadores indisponíveis.'}</p></Card></>;
  const stats: Array<[string, ReactNode]> = [
    ['Pedidos de hoje', data.metrics.orders_today],
    ['Faturamento de hoje', money(data.metrics.revenue_today_cents)],
    ['Ticket médio', money(data.metrics.average_ticket_today_cents)],
    ['Clientes atendidos', data.metrics.customers_today],
    ['Em operação', data.metrics.open_orders],
    ['Situação', <Badge key="status" tone={data.settings.is_open ? 'green' : 'red'}>{data.settings.is_open ? 'Aberto' : 'Fechado'}</Badge>],
  ];
  return <>
    <Header refreshing={refreshing} refresh={refresh} />
    {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <div aria-busy={refreshing} className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{stats.map(([label, value]) => <Card key={label}><p className="text-sm text-stone-500">{label}</p><div className="mt-2 text-2xl font-black">{value}</div></Card>)}</div>
    <Card className="mt-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-black">Operação atual</h2><p className="mt-1 text-sm text-stone-500">Taxa {money(data.settings.delivery_fee_cents)} · Prazo {formatMinutes(data.settings.delivery_minutes_min, data.settings.delivery_minutes_max)}</p></div><Link href="/admin/configuracoes" className="text-sm font-semibold text-brand-600">Configurações</Link></div><div className="mt-4 grid gap-2 sm:grid-cols-5">{operational.map(status => <div key={status} className="rounded-xl bg-stone-50 p-3"><p className="text-xs text-stone-500">{ORDER_STATUS_LABELS[status]}</p><b className="text-xl">{data.status_counts[status]}</b></div>)}</div></Card>
    <div className="mt-6 grid gap-6 xl:grid-cols-2">
      <Card><h2 className="font-black">Produtos mais vendidos hoje</h2>{data.top_products.length === 0 ? <Empty text="Nenhuma venda válida hoje." /> : data.top_products.map((product, index) => <div className="mt-4 flex items-center justify-between gap-3" key={product.name}><span>{index + 1}. {product.name}</span><span className="text-right"><b>{product.quantity} un.</b><small className="block text-stone-500">{money(product.revenue_cents)}</small></span></div>)}</Card>
      <Card><div className="flex justify-between gap-3"><h2 className="font-black">Pedidos recentes</h2><Link href="/admin/pedidos" className="text-sm font-semibold text-brand-600">Ver pedidos</Link></div>{data.recent_orders.length === 0 ? <Empty text="Nenhum pedido recebido." /> : data.recent_orders.map(order => <div className="mt-4 flex items-center justify-between gap-3" key={order.id}><div><b>#{order.order_number} · {order.customer_name_snapshot}</b><p className="text-sm text-stone-500">{dateTime.format(new Date(order.created_at))} · {order.delivery_method === 'delivery' ? 'Entrega' : 'Retirada'} · {money(order.total_cents)}</p></div><Badge tone={order.status === 'cancelled' ? 'red' : order.status === 'delivered' ? 'green' : 'orange'}>{ORDER_STATUS_LABELS[order.status]}</Badge></div>)}</Card>
    </div>
  </>;
}

function Header({ refreshing, refresh }: { refreshing: boolean; refresh: () => Promise<void> }) {
  return <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-black">Visão geral</h1><p className="mt-1 text-stone-600">Indicadores reais da operação, atualizados a cada 10 segundos.</p><p className="mt-1 text-xs text-stone-500">Data comercial e horários de São Paulo.</p></div><Button disabled={refreshing} onClick={() => void refresh()}>{refreshing ? 'Atualizando...' : 'Atualizar agora'}</Button></div>;
}

function Empty({ text }: { text: string }) { return <p className="mt-4 text-sm text-stone-500">{text}</p>; }
function formatMinutes(min: number | null, max: number | null) {
  if (min === null && max === null) return 'não informado';
  if (min === null) return `até ${max} min`;
  if (max === null) return `a partir de ${min} min`;
  return `${min}–${max} min`;
}
