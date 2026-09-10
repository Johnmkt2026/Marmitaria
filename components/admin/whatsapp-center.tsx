'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadWhatsAppCenter } from '@/app/admin/whatsapp/actions';
import { Badge, Button, Card, Money } from '@/components/ui';
import { ORDER_STATUSES, ORDER_STATUS_LABELS, PAYMENT_LABELS, type OrderStatus } from '@/lib/admin-order-types';
import type { WhatsAppCenterData, WhatsAppCenterResult, WhatsAppOrder } from '@/lib/admin-whatsapp-types';
import { buildWhatsAppMessage, createWhatsAppUrl, normalizeBrazilianWhatsApp, suggestedTemplate, WHATSAPP_MESSAGE_MAX_LENGTH, WHATSAPP_TEMPLATE_IDS, WHATSAPP_TEMPLATE_LABELS, type MessageContext, type WhatsAppTemplateId } from '@/lib/whatsapp';
import { useVisiblePolling } from '@/lib/use-visible-polling';

const dateTime = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
const field = 'rounded-xl border bg-white px-3 py-2 text-sm';

function messageContext(order: WhatsAppOrder, data: WhatsAppCenterData): MessageContext {
  return { customerName: order.customer_name_snapshot, orderNumber: order.order_number, totalCents: order.total_cents, deliveryMethod: order.delivery_method, restaurantName: data.restaurant_name, deliveryMinutesMin: data.delivery_minutes_min, deliveryMinutesMax: data.delivery_minutes_max };
}

export function WhatsAppCenter({ initial }: { initial: WhatsAppCenterResult }) {
  const [data, setData] = useState(initial.data ?? null);
  const [error, setError] = useState(initial.error ?? null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | OrderStatus>('all');
  const [selectedId, setSelectedId] = useState(initial.data?.orders[0]?.id ?? null);
  const [template, setTemplate] = useState<WhatsAppTemplateId>('confirmation');
  const [message, setMessage] = useState('');
  const busy = useRef(false);
  const messageKey = useRef('');

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true; setRefreshing(true);
    try {
      const result = await loadWhatsAppCenter();
      if (result.data) {
        setData(result.data); setError(null);
        setSelectedId(current => current && result.data.orders.some(order => order.id === current) ? current : result.data.orders[0]?.id ?? null);
      } else setError(result.error);
    } catch { setError('Conexão interrompida. Exibindo os últimos dados recebidos.'); }
    finally { busy.current = false; setRefreshing(false); }
  }, []);

  useVisiblePolling(refresh);

  const selected = data?.orders.find(order => order.id === selectedId) ?? null;
  useEffect(() => {
    if (!selected || !data) { if (messageKey.current) { messageKey.current = ''; setMessage(''); } return; }
    const key = `${selected.id}:${selected.status}:${data.restaurant_name}:${data.delivery_minutes_min}:${data.delivery_minutes_max}`;
    if (messageKey.current === key) return;
    messageKey.current = key;
    const next = suggestedTemplate(selected.status); setTemplate(next); setMessage(buildWhatsAppMessage(next, messageContext(selected, data)));
  }, [selected, data]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('pt-BR'); const digits = query.replace(/\D/g, '');
    return (data?.orders ?? []).filter(order => (status === 'all' || order.status === status)
      && (!needle || order.customer_name_snapshot.toLocaleLowerCase('pt-BR').includes(needle) || String(order.order_number).includes(needle) || (!!digits && order.whatsapp_snapshot.replace(/\D/g, '').includes(digits))));
  }, [data, query, status]);

  function chooseTemplate(value: WhatsAppTemplateId) {
    setTemplate(value);
    if (selected && data && value !== 'custom') setMessage(buildWhatsAppMessage(value, messageContext(selected, data)));
  }

  if (!data) return <><Title refreshing={refreshing} refresh={refresh} /><Card className="mt-5"><p role="alert" className="text-red-700">{error ?? 'Central indisponível.'}</p></Card></>;
  const normalized = selected ? normalizeBrazilianWhatsApp(selected.whatsapp_snapshot) : null;
  const url = selected ? createWhatsAppUrl(selected.whatsapp_snapshot, message) : null;

  return <>
    <Title refreshing={refreshing} refresh={refresh} />
    <div className="mt-4 rounded-xl bg-green-50 p-3 text-sm text-green-900">A mensagem será aberta no WhatsApp para revisão e envio manual pelo operador.</div>
    {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <div className="mt-5 flex flex-wrap gap-3">
      <input aria-label="Buscar atendimento" value={query} onChange={event => setQuery(event.target.value)} placeholder="Cliente, pedido ou WhatsApp" className={`${field} min-w-60 flex-1`} />
      <select aria-label="Filtrar por status" value={status} onChange={event => setStatus(event.target.value as 'all' | OrderStatus)} className={field}><option value="all">Todos os status</option>{ORDER_STATUSES.map(value => <option key={value} value={value}>{ORDER_STATUS_LABELS[value]}</option>)}</select>
    </div>
    <div className="mt-5 grid min-h-[620px] overflow-hidden rounded-2xl border bg-white lg:grid-cols-[280px_1fr_300px]">
      <aside className="border-b lg:border-b-0 lg:border-r"><div className="p-4 font-bold">Pedidos recentes <span className="text-xs font-normal text-stone-500">({visible.length})</span></div><div className="max-h-72 overflow-y-auto lg:max-h-[700px]">{visible.length === 0 ? <p className="border-t p-4 text-sm text-stone-500">Nenhum pedido encontrado.</p> : visible.map(order => <button className={`w-full border-t p-4 text-left ${order.id === selectedId ? 'bg-brand-50' : 'hover:bg-stone-50'}`} key={order.id} onClick={() => setSelectedId(order.id)}><div className="flex justify-between gap-2"><b className="truncate">#{order.order_number} · {order.customer_name_snapshot}</b><span className="text-xs">{ORDER_STATUS_LABELS[order.status]}</span></div><p className="mt-1 text-xs text-stone-500">{dateTime.format(new Date(order.created_at))}</p></button>)}</div></aside>
      <section className="flex min-h-[500px] flex-col">{selected ? <>
        <div className="border-b p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><b>{selected.customer_name_snapshot}</b><p className="text-xs text-stone-500">Pedido #{selected.order_number} · {selected.whatsapp_snapshot}</p></div><Badge tone={selected.status === 'cancelled' ? 'red' : selected.status === 'delivered' ? 'green' : 'orange'}>{ORDER_STATUS_LABELS[selected.status]}</Badge></div></div>
        <div className="flex-1 bg-stone-50 p-4"><label className="text-sm font-semibold">Modelo<select aria-label="Modelo de mensagem" value={template} onChange={event => chooseTemplate(event.target.value as WhatsAppTemplateId)} className={`${field} mt-1 block w-full`}>{WHATSAPP_TEMPLATE_IDS.map(value => <option key={value} value={value}>{WHATSAPP_TEMPLATE_LABELS[value]}</option>)}</select></label><label className="mt-4 block text-sm font-semibold">Mensagem<textarea aria-label="Mensagem" value={message} maxLength={WHATSAPP_MESSAGE_MAX_LENGTH} onChange={event => { setMessage(event.target.value); setTemplate('custom'); }} rows={9} className="mt-1 w-full resize-y rounded-xl border bg-white p-3 font-normal" /><small className="mt-1 block text-right font-normal text-stone-500">{message.length}/{WHATSAPP_MESSAGE_MAX_LENGTH}</small></label><div className="mt-4 rounded-2xl bg-[#dcf8c6] p-4 text-sm shadow-sm"><p className="mb-2 text-xs font-semibold text-green-900">Prévia</p><p className="whitespace-pre-wrap">{message || 'Digite uma mensagem.'}</p></div></div>
        <div className="border-t p-4">{!normalized && <p role="alert" className="mb-3 text-sm text-red-700">O telefone deste pedido não é um número brasileiro válido para WhatsApp.</p>}{normalized && !url && <p role="alert" className="mb-3 text-sm text-red-700">A mensagem deve conter entre 1 e {WHATSAPP_MESSAGE_MAX_LENGTH} caracteres.</p>}{url ? <a href={url} target="_blank" rel="noopener noreferrer" className="block rounded-xl bg-green-700 px-4 py-3 text-center font-bold text-white hover:bg-green-800">Abrir no WhatsApp</a> : <button disabled className="w-full rounded-xl bg-stone-300 px-4 py-3 font-bold text-stone-600">Abrir no WhatsApp</button>}<p className="mt-2 text-center text-xs text-stone-500">Nenhuma mensagem será marcada ou registrada como enviada.</p></div>
      </> : <div className="grid flex-1 place-items-center p-6 text-sm text-stone-500">Selecione um pedido para preparar a mensagem.</div>}</section>
      <aside className="border-t p-4 lg:border-l lg:border-t-0">{selected ? <OrderDetails order={selected} normalized={normalized} /> : <p className="text-sm text-stone-500">Sem pedido selecionado.</p>}</aside>
    </div>
  </>;
}

function Title({ refreshing, refresh }: { refreshing: boolean; refresh: () => Promise<void> }) {
  return <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-black">WhatsApp</h1><p className="mt-1 text-stone-600">Central operacional baseada nos pedidos reais.</p></div><Button disabled={refreshing} onClick={() => void refresh()}>{refreshing ? 'Atualizando...' : 'Atualizar'}</Button></div>;
}

function OrderDetails({ order, normalized }: { order: WhatsAppOrder; normalized: string | null }) {
  return <><h2 className="font-black">Contexto do pedido</h2><div className="mt-3 space-y-3 text-sm"><p><b>Telefone</b><br />{order.whatsapp_snapshot}<br /><span className={normalized ? 'text-green-700' : 'text-red-700'}>{normalized ? `Destino: +${normalized}` : 'Inválido'}</span></p><p><b>Modalidade</b><br />{order.delivery_method === 'delivery' ? 'Entrega' : 'Retirada'}</p><p><b>Pagamento</b><br />{PAYMENT_LABELS[order.payment_method]}</p><p><b>Total</b><br /><Money value={order.total_cents / 100} /></p>{order.delivery_method === 'delivery' && <p className="whitespace-pre-wrap"><b>Endereço</b><br />{order.address_snapshot || 'Não informado'}</p>}<div><b>Itens</b><ul className="mt-1 space-y-2">{order.items.map(item => <li key={item.id}>{item.quantity}× {item.product_name_snapshot}{item.addons.map(addon => <small className="block text-stone-500" key={addon.id}>+ {addon.quantity}× {addon.addon_name_snapshot}</small>)}{item.notes && <small className="block whitespace-pre-wrap text-stone-500">Obs.: {item.notes}</small>}</li>)}</ul></div><p className="whitespace-pre-wrap"><b>Observações</b><br />{order.notes || 'Nenhuma'}</p></div></>;
}
