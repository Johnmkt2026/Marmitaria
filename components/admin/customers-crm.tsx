'use client';

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { loadCustomers } from '@/app/admin/clientes/actions';
import { CUSTOMER_PROFILES, type AdminCustomer, type CustomerProfile, type CustomersResult } from '@/lib/admin-customer-types';
import { ORDER_STATUS_LABELS, PAYMENT_LABELS } from '@/lib/admin-order-types';
import { Badge, Button, Card, Money } from '@/components/ui';
import { useVisiblePolling } from '@/lib/use-visible-polling';

const dateTime = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
const dateOnly = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'medium' });
const money = (cents: number) => <Money value={cents / 100} />;
const phoneDigits = (value: string) => value.replace(/\D/g, '');
const badgeTone = (profile: CustomerProfile) => profile === 'VIP' ? 'orange' : profile === 'Inativo' ? 'stone' : profile === 'Novo' ? 'blue' : 'green';

function Addresses({ customer }: { customer: AdminCustomer }) {
  if (!customer.addresses.length) return <p className="mt-1 text-sm text-stone-500">Nenhum endereço cadastrado.</p>;
  return <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">{customer.addresses.map(address => <li key={address.id} className="rounded-xl border border-stone-100 bg-stone-50 p-3">
    {address.label && <b>{address.label}: </b>}{[address.address_line, address.complement, address.neighborhood, address.city, address.postal_code].filter(Boolean).join(', ')}
  </li>)}</ul>;
}

export function CustomersCRM({ initial }: { initial: CustomersResult }) {
  const [customers, setCustomers] = useState(initial.data ?? []);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'Todos' | CustomerProfile>('Todos');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState(initial.error ?? null);
  const [unauthorized, setUnauthorized] = useState('unauthorized' in initial && !!initial.unauthorized);
  const [refreshing, setRefreshing] = useState(false);
  const busy = useRef(false);
  const selected = customers.find(customer => customer.id === selectedId) ?? null;

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true; setRefreshing(true);
    try {
      const result = await loadCustomers();
      if (result.data) { setCustomers(result.data); setError(null); setUnauthorized(false); }
      else { setError(result.error); if (result.unauthorized) { setCustomers([]); setSelectedId(null); setUnauthorized(true); } }
    } catch { setError('Conexão interrompida. Exibindo a última consulta recebida.'); }
    finally { busy.current = false; setRefreshing(false); }
  }, []);

  useVisiblePolling(refresh);

  const list = useMemo(() => {
    const textQuery = query.trim().toLocaleLowerCase('pt-BR');
    const digits = phoneDigits(query);
    return customers.filter(customer => (filter === 'Todos' || customer.profile === filter)
      && (!textQuery || customer.name.toLocaleLowerCase('pt-BR').includes(textQuery)
        || (!!digits && phoneDigits(customer.whatsapp_normalized).includes(digits))));
  }, [customers, filter, query]);

  return <div className="mx-auto max-w-6xl">
    <header className="rounded-3xl bg-gradient-to-br from-brand-900 to-brand-700 p-5 text-white shadow-[0_18px_50px_rgba(24,74,55,0.16)] sm:p-7"><div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-100">Relacionamento</p><h1 className="mt-1 text-2xl font-black sm:text-3xl">Clientes</h1><p className="mt-2 max-w-xl text-sm text-emerald-50">Conheça o histórico, a frequência e o valor de cada cliente para atender melhor.</p></div><Button disabled={refreshing} onClick={() => void refresh()} className="w-full bg-white text-brand-900 hover:bg-orange-50 sm:w-auto">{refreshing ? 'Atualizando...' : 'Atualizar agora'}</Button></div></header>
    <div className="mt-4 grid gap-3 rounded-2xl border bg-white p-3 shadow-sm sm:grid-cols-[minmax(0,1fr)_190px]"><input aria-label="Buscar clientes" value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar por nome ou WhatsApp" className="min-h-12 rounded-xl border bg-stone-50 px-4 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100"/><select aria-label="Filtrar por perfil" value={filter} onChange={event => setFilter(event.target.value as typeof filter)} className="min-h-12 rounded-xl border bg-white px-3 font-semibold"><option>Todos</option>{CUSTOMER_PROFILES.map(profile => <option key={profile}>{profile}</option>)}</select></div>
    {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {unauthorized && <a href="/login?redirectTo=/admin/clientes" className="mt-3 inline-block font-semibold text-brand-600">Entrar novamente</a>}
    {!refreshing && !error && customers.length === 0 && <Card className="mt-5 text-center"><b>Nenhum cliente encontrado</b><p className="mt-2 text-sm text-stone-500">Os clientes aparecerão após o primeiro pedido.</p></Card>}
    {customers.length > 0 && list.length === 0 && <Card className="mt-5 text-center text-sm text-stone-500">Nenhum cliente corresponde à busca ou ao filtro.</Card>}
    {list.length > 0 && <div aria-busy={refreshing} className="mt-5 grid gap-4 xl:grid-cols-2">{list.map(customer => <Card key={customer.id} className="overflow-hidden p-0"><article><button className="w-full p-4 text-left sm:p-5" onClick={() => setSelectedId(customer.id)}><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-black text-stone-900">{customer.name}</h2><p className="mt-1 text-sm font-medium text-stone-600">{customer.whatsapp_normalized}</p></div><Badge tone={badgeTone(customer.profile)}>{customer.profile}</Badge></div><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3"><Metric label="Pedidos" value={String(customer.order_count)}/><Metric label="Total gasto" value={money(customer.total_spent_cents)}/><Metric label="Ticket médio" value={money(customer.average_ticket_cents)}/></div><div className="mt-4 border-t border-stone-100 pt-3 text-sm"><p className="text-stone-500">Última compra</p><b>{customer.last_order_at ? dateTime.format(new Date(customer.last_order_at)) : '—'}</b>{customer.favorite_product && <p className="mt-2 text-stone-600"><span className="text-stone-500">Favorito:</span> {customer.favorite_product}</p>}</div></button><div className="border-t bg-stone-50/70 p-3 sm:px-5"><button onClick={() => setSelectedId(customer.id)} className="min-h-11 w-full rounded-xl bg-white px-4 text-sm font-bold text-brand-900 shadow-sm ring-1 ring-stone-200 sm:w-auto">Ver histórico e detalhes</button></div></article></Card>)}</div>}
    {selected && <CustomerModal customer={selected} close={() => setSelectedId(null)} />}
  </div>;
}

function CustomerModal({ customer, close }: { customer: AdminCustomer; close: () => void }) {
  return <div role="dialog" aria-modal="true" aria-labelledby="customer-title" className="fixed inset-0 z-30 grid place-items-center bg-brand-950/55 p-3 backdrop-blur-sm sm:p-5" onKeyDown={event => { if (event.key === 'Escape') close(); }}>
    <Card className="max-h-[92dvh] w-full max-w-3xl overflow-y-auto p-0 shadow-2xl">
      <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b bg-white/95 p-4 backdrop-blur sm:p-6">
        <div><div className="flex flex-wrap items-center gap-2"><h2 id="customer-title" className="text-xl font-black text-brand-950 sm:text-2xl">{customer.name}</h2><Badge tone={badgeTone(customer.profile)}>{customer.profile}</Badge></div><p className="mt-1 text-sm font-medium text-stone-500">{customer.whatsapp_normalized}</p></div>
        <button aria-label="Fechar detalhes" onClick={close} className="grid size-10 shrink-0 place-items-center rounded-full bg-stone-100 text-lg font-bold text-stone-600 hover:bg-stone-200">✕</button>
      </header>
      <div className="space-y-5 p-4 sm:p-6">
        <section><p className="text-xs font-bold uppercase tracking-[0.16em] text-stone-500">Resumo do relacionamento</p><div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4"><Metric label="Pedidos" value={String(customer.order_count)}/><Metric label="Total gasto" value={money(customer.total_spent_cents)}/><Metric label="Ticket médio" value={money(customer.average_ticket_cents)}/><Metric label="Desde" value={dateOnly.format(new Date(customer.created_at))}/></div></section>
        <section className="grid gap-3 sm:grid-cols-2"><Info label="Primeiro pedido" value={customer.first_order_at ? dateTime.format(new Date(customer.first_order_at)) : '—'}/><Info label="Último pedido" value={customer.last_order_at ? dateTime.format(new Date(customer.last_order_at)) : '—'}/><Info label="Pagamento favorito" value={customer.favorite_payment ? PAYMENT_LABELS[customer.favorite_payment] : '—'}/><Info label="Produto favorito" value={customer.favorite_product ?? '—'}/></section>
        <section className="rounded-2xl border border-stone-100 bg-white p-4"><h3 className="font-black text-brand-950">Endereços</h3><Addresses customer={customer}/></section>
        <section className="rounded-2xl border border-stone-100 bg-orange-50/50 p-4"><h3 className="font-black text-brand-950">Observações internas</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-stone-600">{customer.internal_notes || 'Nenhuma observação.'}</p></section>
        <section><div className="flex items-end justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-stone-500">Compras</p><h3 className="mt-1 font-black text-brand-950">Histórico recente</h3></div><span className="text-xs text-stone-500">Até 10 pedidos</span></div>{customer.orders.length === 0 ? <p className="mt-3 rounded-2xl bg-stone-50 p-4 text-sm text-stone-500">Nenhum pedido registrado.</p> : <ul className="mt-3 space-y-2 text-sm">{customer.orders.slice(0, 10).map(order => <li key={order.id} className="grid gap-3 rounded-2xl border border-stone-100 bg-white p-4 sm:grid-cols-[1fr_auto] sm:items-center"><div><div className="flex flex-wrap items-center gap-2"><b className="text-brand-950">#{order.order_number}</b><span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-bold text-stone-600">{ORDER_STATUS_LABELS[order.status]}</span></div><p className="mt-1 text-stone-500">{dateTime.format(new Date(order.created_at))} · {order.delivery_method === 'delivery' ? 'Entrega' : 'Retirada'} · {PAYMENT_LABELS[order.payment_method]}</p></div><b className="text-base text-brand-950">{money(order.total_cents)}</b></li>)}</ul>}</section>
      </div>
    </Card>
  </div>;
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return <div className="min-w-0 rounded-2xl border border-stone-100 bg-stone-50/80 p-3"><span className="block text-[11px] font-bold uppercase tracking-wider text-stone-500">{label}</span><strong className="mt-1 block break-words text-sm text-stone-900 sm:text-base">{value}</strong></div>;
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return <div className="rounded-2xl border border-stone-100 bg-stone-50/70 p-4"><span className="text-xs font-bold uppercase tracking-wider text-stone-500">{label}</span><strong className="mt-1 block text-sm text-stone-900">{value}</strong></div>;
}
