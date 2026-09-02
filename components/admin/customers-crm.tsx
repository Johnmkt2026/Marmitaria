'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadCustomers } from '@/app/admin/clientes/actions';
import { CUSTOMER_PROFILES, type AdminCustomer, type CustomerProfile, type CustomersResult } from '@/lib/admin-customer-types';
import { ORDER_STATUS_LABELS, PAYMENT_LABELS } from '@/lib/admin-order-types';
import { Badge, Button, Card, Money } from '@/components/ui';

const dateTime = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
const dateOnly = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'medium' });
const money = (cents: number) => <Money value={cents / 100} />;
const phoneDigits = (value: string) => value.replace(/\D/g, '');
const badgeTone = (profile: CustomerProfile) => profile === 'VIP' ? 'orange' : profile === 'Inativo' ? 'stone' : 'green';

function Addresses({ customer }: { customer: AdminCustomer }) {
  if (!customer.addresses.length) return <p className="mt-1 text-sm text-stone-500">Nenhum endereço cadastrado.</p>;
  return <ul className="mt-1 space-y-2 text-sm">{customer.addresses.map(address => <li key={address.id}>
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

  useEffect(() => {
    const updateVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const timer = window.setInterval(updateVisible, 10000);
    document.addEventListener('visibilitychange', updateVisible);
    window.addEventListener('focus', updateVisible);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', updateVisible); window.removeEventListener('focus', updateVisible); };
  }, [refresh]);

  const list = useMemo(() => {
    const textQuery = query.trim().toLocaleLowerCase('pt-BR');
    const digits = phoneDigits(query);
    return customers.filter(customer => (filter === 'Todos' || customer.profile === filter)
      && (!textQuery || customer.name.toLocaleLowerCase('pt-BR').includes(textQuery)
        || (!!digits && phoneDigits(customer.whatsapp_normalized).includes(digits))));
  }, [customers, filter, query]);

  return <>
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-black">Clientes</h1><p className="mt-1 text-sm text-stone-600">Dados reais, atualizados automaticamente a cada 10 segundos.</p></div><Button disabled={refreshing} onClick={() => void refresh()}>{refreshing ? 'Atualizando...' : 'Atualizar agora'}</Button></div>
    <div className="mt-5 flex flex-wrap gap-3"><input aria-label="Buscar clientes" value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar nome ou WhatsApp" className="rounded-xl border bg-white px-3 py-2"/><select aria-label="Filtrar por perfil" value={filter} onChange={event => setFilter(event.target.value as typeof filter)} className="rounded-xl border bg-white px-3 py-2"><option>Todos</option>{CUSTOMER_PROFILES.map(profile => <option key={profile}>{profile}</option>)}</select></div>
    {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {unauthorized && <a href="/login?redirectTo=/admin/clientes" className="mt-3 inline-block font-semibold text-brand-600">Entrar novamente</a>}
    {!refreshing && !error && customers.length === 0 && <Card className="mt-5 text-center"><b>Nenhum cliente encontrado</b><p className="mt-2 text-sm text-stone-500">Os clientes aparecerão após o primeiro pedido.</p></Card>}
    {customers.length > 0 && list.length === 0 && <Card className="mt-5 text-center text-sm text-stone-500">Nenhum cliente corresponde à busca ou ao filtro.</Card>}
    {list.length > 0 && <Card className="mt-5 overflow-x-auto p-0"><table aria-busy={refreshing} className="w-full min-w-[740px] text-left text-sm"><thead className="bg-stone-50 text-stone-500"><tr>{['Cliente','WhatsApp','Pedidos','Total gasto','Ticket médio','Último pedido','Favorito','Perfil'].map(column => <th className="p-3" key={column}>{column}</th>)}</tr></thead><tbody>{list.map(customer => <tr className="border-t" key={customer.id}><td className="p-3 font-semibold"><button className="text-left hover:underline" onClick={() => setSelectedId(customer.id)}>{customer.name}</button></td><td className="p-3">{customer.whatsapp_normalized}</td><td className="p-3">{customer.order_count}</td><td className="p-3">{money(customer.total_spent_cents)}</td><td className="p-3">{money(customer.average_ticket_cents)}</td><td className="p-3">{customer.last_order_at ? dateTime.format(new Date(customer.last_order_at)) : '—'}</td><td className="p-3">{customer.favorite_product ?? '—'}</td><td className="p-3"><button onClick={() => setSelectedId(customer.id)}><Badge tone={badgeTone(customer.profile)}>{customer.profile}</Badge></button></td></tr>)}</tbody></table></Card>}
    {selected && <CustomerModal customer={selected} close={() => setSelectedId(null)} />}
  </>;
}

function CustomerModal({ customer, close }: { customer: AdminCustomer; close: () => void }) {
  return <div role="dialog" aria-modal="true" aria-labelledby="customer-title" className="fixed inset-0 z-30 grid place-items-center bg-black/40 p-4" onKeyDown={event => { if (event.key === 'Escape') close(); }}><Card className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto"><div className="flex justify-between"><h2 id="customer-title" className="text-xl font-black">{customer.name}</h2><button aria-label="Fechar detalhes" onClick={close}>✕</button></div><div className="mt-5 grid gap-4 sm:grid-cols-2"><p><b>WhatsApp</b><br/>{customer.whatsapp_normalized}</p><p><b>Perfil</b><br/>{customer.profile}</p><p><b>Cadastro</b><br/>{dateOnly.format(new Date(customer.created_at))}</p><p><b>Primeiro pedido</b><br/>{customer.first_order_at ? dateTime.format(new Date(customer.first_order_at)) : '—'}</p><p><b>Último pedido</b><br/>{customer.last_order_at ? dateTime.format(new Date(customer.last_order_at)) : '—'}</p><p><b>Total de pedidos</b><br/>{customer.order_count}</p><p><b>Total gasto</b><br/>{money(customer.total_spent_cents)}</p><p><b>Ticket médio</b><br/>{money(customer.average_ticket_cents)}</p><p><b>Pagamento favorito</b><br/>{customer.favorite_payment ? PAYMENT_LABELS[customer.favorite_payment] : '—'}</p><p><b>Produto favorito</b><br/>{customer.favorite_product ?? '—'}</p></div><div className="mt-5 border-t pt-4"><b>Endereços</b><Addresses customer={customer}/><b className="mt-4 block">Observações internas</b><p className="mt-1 whitespace-pre-wrap text-sm text-stone-600">{customer.internal_notes || 'Nenhuma observação.'}</p><b className="mt-4 block">Histórico recente</b>{customer.orders.length === 0 ? <p className="mt-1 text-sm text-stone-500">Nenhum pedido registrado.</p> : <ul className="mt-2 divide-y text-sm">{customer.orders.slice(0, 10).map(order => <li key={order.id} className="grid gap-1 py-3 sm:grid-cols-[1fr_auto]"><div><b>#{order.order_number} · {ORDER_STATUS_LABELS[order.status]}</b><p className="text-stone-500">{dateTime.format(new Date(order.created_at))} · {order.delivery_method === 'delivery' ? 'Entrega' : 'Retirada'} · {PAYMENT_LABELS[order.payment_method]}</p></div><b>{money(order.total_cents)}</b></li>)}</ul>}</div></Card></div>;
}
