'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { loadReports } from '@/app/admin/relatorios/actions';
import type { ReportResult } from '@/lib/admin-report-types';
import { Button, Card, Money } from '@/components/ui';
import { useVisiblePolling } from '@/lib/use-visible-polling';

type Period = 'today' | '7' | '30' | 'custom';
const paymentLabels = { pix: 'Pix', cash: 'Dinheiro', card: 'Cartão' } as const;
const methodLabels = { delivery: 'Entrega', pickup: 'Retirada' } as const;
const money = (cents: number) => <Money value={cents / 100} />;

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function shortDate(date: string) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: '2-digit', month: '2-digit' }).format(new Date(`${date}T00:00:00Z`));
}

export function ReportsAnalytics({ initial }: { initial: ReportResult }) {
  const [data, setData] = useState(initial.data ?? null);
  const [error, setError] = useState(initial.error ?? null);
  const [period, setPeriod] = useState<Period>('today');
  const [refreshing, setRefreshing] = useState(false);
  const [start, setStart] = useState(initial.data?.start_date ?? '');
  const [end, setEnd] = useState(initial.data?.end_date ?? '');
  const busy = useRef(false);

  const refresh = useCallback(async (first = start, last = end) => {
    if (busy.current) return;
    busy.current = true;
    setRefreshing(true);
    try {
      const result = await loadReports({ start: first, end: last });
      if (result.data) {
        setData(result.data);
        setStart(result.data.start_date);
        setEnd(result.data.end_date);
        setError(null);
      } else setError(result.error);
    } catch {
      setError('Conexão interrompida. Exibindo a última consulta recebida.');
    } finally {
      busy.current = false;
      setRefreshing(false);
    }
  }, [start, end]);

  function choose(value: Period) {
    setPeriod(value);
    if (value === 'custom') return;
    const today = data?.business_date ?? end;
    void refresh(value === 'today' ? today : addDays(today, value === '7' ? -6 : -29), today);
  }

  useVisiblePolling(refresh, period === 'today');

  if (!data) return <div className="mx-auto max-w-7xl"><Header period={period} choose={choose} refreshing={refreshing}/><Card className="mt-6"><p role="alert" className="text-red-700">{error ?? 'Relatório indisponível.'}</p></Card></div>;

  const peak = data.hours.reduce((best, row) => row.received > best.received ? row : best, { hour: 0, received: 0, revenue_cents: 0 });
  const maxRevenue = Math.max(1, ...data.daily.map(day => day.revenue_cents));

  return <div className="mx-auto max-w-7xl">
    <Header period={period} choose={choose} refreshing={refreshing}/>
    {period === 'custom' && <form className="mt-4 grid gap-3 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); void refresh(String(form.get('start') ?? ''), String(form.get('end') ?? '')); }}><label className="text-sm font-semibold text-stone-700">Início<input name="start" aria-label="Data inicial" type="date" value={start} onChange={event => setStart(event.target.value)} className="mt-1 block min-h-12 w-full rounded-xl border bg-stone-50 px-3"/></label><label className="text-sm font-semibold text-stone-700">Fim<input name="end" aria-label="Data final" type="date" value={end} onChange={event => setEnd(event.target.value)} className="mt-1 block min-h-12 w-full rounded-xl border bg-stone-50 px-3"/></label><Button disabled={refreshing} className="min-h-12">Aplicar período</Button></form>}
    {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <p className="mt-3 text-xs font-medium text-stone-500">Período: {data.start_date.split('-').reverse().join('/')} a {data.end_date.split('-').reverse().join('/')} · America/Sao_Paulo</p>

    <section aria-label="Indicadores principais" className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Kpi label="Faturamento" value={money(data.metrics.revenue_cents)} featured/>
      <Kpi label="Pedidos recebidos" value={data.metrics.orders_received}/>
      <Kpi label="Pedidos válidos" value={data.metrics.valid_orders}/>
      <Kpi label="Ticket médio" value={money(data.metrics.average_ticket_cents)}/>
      <Kpi label="Clientes únicos" value={data.metrics.unique_customers}/>
      <Kpi label="Cancelamentos" value={`${data.metrics.cancelled_orders} (${data.metrics.cancellation_rate_percent.toLocaleString('pt-BR')}%)`}/>
      <Kpi label="Crescimento" value={data.metrics.growth_percent === null ? 'Sem base' : `${data.metrics.growth_percent.toLocaleString('pt-BR')}%`} accent={data.metrics.growth_percent !== null && data.metrics.growth_percent > 0}/>
      <Kpi label="Período anterior" value={money(data.metrics.previous_revenue_cents)}/>
    </section>

    <div className="mt-6 grid gap-5 lg:grid-cols-2">
      <SectionCard eyebrow="Desempenho" title="Evolução diária" className="lg:col-span-2">
        <div className="mt-5 flex h-48 items-end gap-2 overflow-x-auto border-b border-stone-100 pb-1">{data.daily.map(day => <div key={day.date} title={`${day.date}: ${day.revenue_cents} centavos`} className="flex h-full min-w-9 flex-1 flex-col justify-end"><div className="mx-auto w-full max-w-12 rounded-t-lg bg-gradient-to-t from-terracotta-600 to-terracotta-400 transition-[height]" style={{ height: `${Math.max(day.revenue_cents ? 8 : 1, day.revenue_cents / maxRevenue * 100)}%` }}/><small className="mt-2 text-center text-[10px] font-semibold text-stone-500">{shortDate(day.date)}</small></div>)}</div>
        <p className="mt-3 text-xs text-stone-500">Dias sem movimento permanecem na série com zero.</p>
      </SectionCard>

      <SectionCard eyebrow="Recebimentos" title="Formas de pagamento">{(['pix', 'card', 'cash'] as const).map(method => { const row = data.payments.find(item => item.method === method); return <Line key={method} label={paymentLabels[method]} detail={`${row?.quantity ?? 0} pedidos · ${(row?.percent ?? 0).toLocaleString('pt-BR')}%`} cents={row?.revenue_cents ?? 0}/>; })}</SectionCard>
      <SectionCard eyebrow="Operação" title="Entrega e retirada">{(['delivery', 'pickup'] as const).map(method => { const row = data.delivery_methods.find(item => item.method === method); return <Line key={method} label={methodLabels[method]} detail={`${row?.quantity ?? 0} pedidos · ${(row?.percent ?? 0).toLocaleString('pt-BR')}%`} cents={row?.revenue_cents ?? 0}/>; })}</SectionCard>

      <SectionCard eyebrow="Relacionamento" title="Clientes">
        <div className="mt-4 grid grid-cols-2 gap-3"><MiniMetric label="Novos" value={data.customers.new}/><MiniMetric label="Recorrentes" value={data.customers.recurring}/></div>
        <div className="mt-5 border-t border-stone-100 pt-1">{data.customers.top.length === 0 ? <Empty/> : data.customers.top.map((customer, index) => <div key={customer.id} className="flex items-center justify-between gap-3 border-b border-stone-100 py-3 last:border-0"><span className="min-w-0"><b className="block truncate text-stone-900">{index + 1}. {customer.name}</b><small className="text-stone-500">{customer.orders_count} pedidos</small></span><b className="shrink-0 text-brand-900">{money(customer.spent_cents)}</b></div>)}</div>
        <div className="mt-4 rounded-2xl bg-orange-50 p-3 text-sm text-stone-600"><span className="font-semibold text-terracotta-700">Horário de pico</span><strong className="mt-1 block text-stone-900">{peak.received ? `${String(peak.hour).padStart(2, '0')}h–${String((peak.hour + 1) % 24).padStart(2, '0')}h · ${peak.received} pedidos` : 'Sem movimento'}</strong></div>
      </SectionCard>

      <SectionCard eyebrow="Cardápio" title="Produtos mais vendidos">
        {data.products.length === 0 ? <Empty/> : <div className="mt-3 space-y-2">{data.products.map((product, index) => <article key={product.name} className="rounded-2xl border border-stone-100 bg-stone-50/70 p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><b className="block text-stone-900">{index + 1}. {product.name}</b><span className="text-xs font-semibold text-terracotta-700">{product.quantity} unidades</span></div><b className="shrink-0 text-brand-900">{money(product.total_revenue_cents)}</b></div><p className="mt-2 text-xs text-stone-500">Produtos {money(product.product_revenue_cents)} + adicionais {money(product.addon_revenue_cents)}</p></article>)}</div>}
      </SectionCard>
    </div>
  </div>;
}

function Header({ period, choose, refreshing }: { period: Period; choose: (period: Period) => void; refreshing: boolean }) {
  return <header className="rounded-3xl bg-gradient-to-br from-brand-900 to-brand-700 p-5 text-white shadow-[0_18px_50px_rgba(24,74,55,0.16)] sm:p-7"><div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-100">Inteligência da operação</p><h1 className="mt-1 text-2xl font-black sm:text-3xl">Relatórios</h1><p className="mt-2 max-w-xl text-sm text-emerald-50">Acompanhe vendas, clientes e desempenho do cardápio em um só lugar.</p></div><label className="text-xs font-bold uppercase tracking-wider text-emerald-100">Período<select aria-label="Período do relatório" value={period} disabled={refreshing} onChange={event => choose(event.target.value as Period)} className="mt-2 block min-h-12 w-full rounded-xl border-0 bg-white px-4 font-semibold normal-case tracking-normal text-brand-950 shadow-sm sm:w-56"><option value="today">Hoje</option><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="custom">Período personalizado</option></select></label></div></header>;
}

function Kpi({ label, value, featured = false, accent = false }: { label: string; value: ReactNode; featured?: boolean; accent?: boolean }) {
  return <Card className={`min-w-0 border-stone-100 p-4 shadow-sm ${featured ? 'bg-brand-900 text-white' : 'bg-white'} ${accent ? 'ring-1 ring-emerald-200' : ''}`}><p className={`text-xs font-bold uppercase tracking-wider ${featured ? 'text-emerald-100' : 'text-stone-500'}`}>{label}</p><div className={`mt-2 break-words text-xl font-black sm:text-2xl ${accent ? 'text-emerald-700' : ''}`}>{value}</div></Card>;
}

function SectionCard({ eyebrow, title, children, className = '' }: { eyebrow: string; title: string; children: ReactNode; className?: string }) {
  return <Card className={`border-stone-100 p-4 shadow-sm sm:p-5 ${className}`}><p className="text-[11px] font-bold uppercase tracking-[0.16em] text-terracotta-600">{eyebrow}</p><h2 className="mt-1 text-lg font-black text-brand-950">{title}</h2>{children}</Card>;
}

function MiniMetric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-2xl bg-stone-50 p-3"><span className="text-xs font-semibold text-stone-500">{label}</span><strong className="mt-1 block text-xl text-brand-950">{value}</strong></div>;
}

function Line({ label, detail, cents }: { label: string; detail: string; cents: number }) {
  return <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-stone-100 bg-stone-50/70 p-3"><span><b className="text-stone-900">{label}</b><small className="mt-0.5 block text-stone-500">{detail}</small></span><b className="shrink-0 text-brand-900">{money(cents)}</b></div>;
}

function Empty() {
  return <p className="mt-4 rounded-2xl bg-stone-50 p-4 text-sm text-stone-500">Sem movimento no período.</p>;
}
