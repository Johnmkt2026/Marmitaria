'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { loadWhatsAppCenter } from '@/app/admin/whatsapp/actions';
import { Money } from '@/components/ui';
import { ORDER_STATUS_LABELS, PAYMENT_LABELS, type OrderStatus } from '@/lib/admin-order-types';
import type { WhatsAppCenterData, WhatsAppCenterResult, WhatsAppOrder } from '@/lib/admin-whatsapp-types';
import { buildWhatsAppMessage, createWhatsAppUrl, normalizeBrazilianWhatsApp, suggestedTemplate, WHATSAPP_MESSAGE_MAX_LENGTH, WHATSAPP_TEMPLATE_IDS, WHATSAPP_TEMPLATE_LABELS, type MessageContext, type WhatsAppTemplateId } from '@/lib/whatsapp';
import { useVisiblePolling } from '@/lib/use-visible-polling';

const time = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
const dateTime = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
const field = 'rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-950 outline-none placeholder:text-stone-500 focus-visible:border-brand-900 focus-visible:ring-2 focus-visible:ring-emerald-200';
type InboxFilter = 'all' | 'new' | 'waiting' | 'active' | 'resolved';
type InboxTab = 'contacts' | 'groups';

const inboxFilters: { id: InboxFilter; label: string }[] = [
  { id: 'all', label: 'Todas' }, { id: 'new', label: 'Novas' }, { id: 'waiting', label: 'Aguardando' },
  { id: 'active', label: 'Atendendo' }, { id: 'resolved', label: 'Resolvidas' },
];

function conversationState(status: OrderStatus): Exclude<InboxFilter, 'all'> {
  if (status === 'new') return 'new';
  if (status === 'confirmed' || status === 'ready') return 'waiting';
  if (status === 'preparing' || status === 'out_for_delivery') return 'active';
  return 'resolved';
}

function messageContext(order: WhatsAppOrder, data: WhatsAppCenterData): MessageContext {
  return { customerName: order.customer_name_snapshot, orderNumber: order.order_number, totalCents: order.total_cents, deliveryMethod: order.delivery_method, restaurantName: data.restaurant_name, deliveryMinutesMin: data.delivery_minutes_min, deliveryMinutesMax: data.delivery_minutes_max };
}

export function WhatsAppCenter({ initial }: { initial: WhatsAppCenterResult }) {
  const [data, setData] = useState(initial.data ?? null);
  const [error, setError] = useState(initial.error ?? null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<InboxTab>('contacts');
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
        setSelectedId(current => current && result.data.orders.some(order => order.id === current) ? current : null);
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

  const counts = useMemo(() => {
    const result: Record<InboxFilter, number> = { all: data?.orders.length ?? 0, new: 0, waiting: 0, active: 0, resolved: 0 };
    for (const order of data?.orders ?? []) result[conversationState(order.status)] += 1;
    return result;
  }, [data]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('pt-BR'); const digits = query.replace(/\D/g, '');
    return (data?.orders ?? []).filter(order => (filter === 'all' || conversationState(order.status) === filter) && (!needle || order.customer_name_snapshot.toLocaleLowerCase('pt-BR').includes(needle) || String(order.order_number).includes(needle) || (!!digits && order.whatsapp_snapshot.replace(/\D/g, '').includes(digits))));
  }, [data, filter, query]);

  function chooseTemplate(value: WhatsAppTemplateId) {
    setTemplate(value);
    if (selected && data && value !== 'custom') setMessage(buildWhatsAppMessage(value, messageContext(selected, data)));
  }

  if (!data) return <Unavailable refreshing={refreshing} refresh={refresh} error={error} />;
  return <div className="mx-auto flex max-w-[1500px] flex-col">
    <PageHeader refreshing={refreshing} refresh={refresh} />
    {error && <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800">{error}</p>}
    <div className="mt-4 grid min-h-[calc(100dvh-12rem)] overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-[0_18px_60px_rgba(41,55,38,0.09)] lg:h-[calc(100dvh-11rem)] lg:min-h-[620px] lg:grid-cols-[340px_minmax(0,1fr)]">
      <ConversationList orders={visible} total={data.orders.length} selectedId={selectedId} tab={tab} filter={filter} counts={counts} query={query} hiddenOnMobile={Boolean(selected)} onTab={value => { setTab(value); setSelectedId(null); }} onFilter={setFilter} onQuery={setQuery} onSelect={setSelectedId} />
      <ChatPanel order={selected} template={template} message={message} hiddenOnMobile={!selected} onBack={() => setSelectedId(null)} onTemplate={chooseTemplate} onMessage={value => { setMessage(value); setTemplate('custom'); }} />
    </div>
  </div>;
}

function PageHeader({ refreshing, refresh }: { refreshing: boolean; refresh: () => Promise<void> }) {
  return <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.2em] text-terracotta-700">Atendimento</p><h1 className="mt-1 text-2xl font-black text-brand-950 sm:text-3xl">WhatsApp</h1><p className="mt-1 text-sm font-medium text-stone-600">Prepare mensagens a partir dos pedidos reais e continue o atendimento no WhatsApp.</p></div><button disabled={refreshing} onClick={() => void refresh()} className="min-h-11 rounded-xl border border-brand-900 bg-white px-4 text-sm font-black text-brand-900 transition hover:bg-brand-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-900 disabled:cursor-wait disabled:opacity-60">{refreshing ? 'Atualizando...' : 'Atualizar conversas'}</button></header>;
}

type ListProps = { orders: WhatsAppOrder[]; total: number; selectedId: string | null; tab: InboxTab; filter: InboxFilter; counts: Record<InboxFilter, number>; query: string; hiddenOnMobile: boolean; onTab: (value: InboxTab) => void; onFilter: (value: InboxFilter) => void; onQuery: (value: string) => void; onSelect: (id: string) => void };
function ConversationList({ orders, total, selectedId, tab, filter, counts, query, hiddenOnMobile, onTab, onFilter, onQuery, onSelect }: ListProps) {
  return <aside aria-label="Conversas" className={`${hiddenOnMobile ? 'hidden' : 'flex'} min-h-0 flex-col border-stone-200 bg-stone-50/70 lg:flex lg:border-r`}>
    <div className="border-b border-stone-200 bg-white p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-black text-brand-950">Conversas</h2><span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-black text-brand-900">{total}</span></div>
      <div role="tablist" aria-label="Tipo de conversa" className="mt-4 grid grid-cols-2 rounded-xl bg-stone-100 p-1"><InboxTabButton active={tab === 'contacts'} onClick={() => onTab('contacts')}>Contatos</InboxTabButton><InboxTabButton active={tab === 'groups'} onClick={() => onTab('groups')}>Grupos</InboxTabButton></div>
      <label className="relative mt-4 block"><span className="sr-only">Pesquisar conversa</span><span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-500">⌕</span><input value={query} onChange={event => onQuery(event.target.value)} placeholder="Pesquisar conversa..." className={`${field} min-h-11 w-full pl-9`} /></label>
      <div aria-label="Filtrar conversas" className="mt-3 flex gap-2 overflow-x-auto pb-1">{inboxFilters.map(item => <button key={item.id} aria-pressed={filter === item.id} onClick={() => onFilter(item.id)} className={`min-h-9 shrink-0 rounded-full border px-3 text-xs font-black transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-900 ${filter === item.id ? 'border-brand-900 bg-brand-900 text-white' : 'border-stone-300 bg-white text-stone-700 hover:border-brand-700 hover:text-brand-900'}`}>{item.label} <span className={filter === item.id ? 'text-white/85' : 'text-stone-500'}>{counts[item.id]}</span></button>)}</div>
      <p className="mt-2 text-[11px] font-medium text-stone-600">Estados derivados do andamento dos pedidos.</p>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto">{tab === 'groups' ? <EmptyList title="Nenhum grupo" description="Grupos estarão disponíveis quando houver uma integração compatível." /> : orders.length === 0 ? <EmptyList title="Nenhuma conversa" description="As mensagens dos seus clientes aparecerão aqui quando a integração estiver ativa." /> : <ul>{orders.map(order => <ConversationItem key={order.id} order={order} selected={order.id === selectedId} onSelect={() => onSelect(order.id)} />)}</ul>}</div>
  </aside>;
}

function InboxTabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button role="tab" aria-selected={active} onClick={onClick} className={`min-h-10 rounded-lg px-3 text-sm font-black transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-900 ${active ? 'bg-white text-brand-950 shadow-sm' : 'text-stone-600 hover:text-brand-900'}`}>{children}</button>;
}

function ConversationItem({ order, selected, onSelect }: { order: WhatsAppOrder; selected: boolean; onSelect: () => void }) {
  return <li className="border-b border-stone-200"><button aria-current={selected ? 'true' : undefined} onClick={onSelect} className={`w-full border-l-4 p-4 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-brand-900 ${selected ? 'border-l-brand-900 bg-brand-50' : 'border-l-transparent bg-white hover:bg-stone-50'}`}><div className="flex items-start justify-between gap-3"><span className="min-w-0"><strong className="block truncate text-sm text-stone-950">{order.customer_name_snapshot}</strong><span className="mt-0.5 block truncate text-xs font-medium text-stone-600">{order.whatsapp_snapshot}</span></span><time className="shrink-0 text-[11px] font-bold text-stone-600">{time.format(new Date(order.created_at))}</time></div><div className="mt-2 flex items-center justify-between gap-2"><span className="text-xs font-black text-terracotta-700">Pedido #{order.order_number}</span><OrderStatus status={order.status} compact /></div><p className="mt-2 truncate text-xs text-stone-600">Pedido {ORDER_STATUS_LABELS[order.status].toLocaleLowerCase('pt-BR')} · {order.delivery_method === 'delivery' ? 'Entrega' : 'Retirada'}</p></button></li>;
}

function EmptyList({ title, description }: { title: string; description: string }) {
  return <div className="grid min-h-64 place-items-center p-8 text-center"><div><span aria-hidden="true" className="mx-auto grid size-12 place-items-center rounded-full bg-stone-100 text-2xl text-stone-600">◎</span><h3 className="mt-3 font-black text-stone-900">{title}</h3><p className="mt-1 max-w-56 text-sm leading-relaxed text-stone-600">{description}</p></div></div>;
}

type ChatProps = { order: WhatsAppOrder | null; template: WhatsAppTemplateId; message: string; hiddenOnMobile: boolean; onBack: () => void; onTemplate: (value: WhatsAppTemplateId) => void; onMessage: (value: string) => void };
function ChatPanel({ order, template, message, hiddenOnMobile, onBack, onTemplate, onMessage }: ChatProps) {
  if (!order) return <main className={`${hiddenOnMobile ? 'hidden' : 'grid'} min-h-[520px] place-items-center bg-[#f8f5ed] p-8 text-center lg:grid`}><EmptyConversation /></main>;
  const normalized = normalizeBrazilianWhatsApp(order.whatsapp_snapshot); const url = createWhatsAppUrl(order.whatsapp_snapshot, message);
  return <main className={`${hiddenOnMobile ? 'hidden' : 'flex'} min-h-0 flex-col bg-[#f8f5ed] lg:flex`}>
    <ChatHeader order={order} onBack={onBack} />
    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6"><div className="mx-auto max-w-3xl"><div className="mx-auto w-fit rounded-full border border-stone-200 bg-white/90 px-3 py-1 text-[11px] font-bold text-stone-600 shadow-sm">{dateTime.format(new Date(order.created_at))}</div><div className="mt-5 max-w-[88%] rounded-2xl rounded-bl-md border border-stone-200 bg-white p-4 text-sm text-stone-700 shadow-sm sm:max-w-[70%]"><p className="font-black text-brand-950">Contexto do pedido</p><p className="mt-1">Pedido #{order.order_number} · {ORDER_STATUS_LABELS[order.status]}</p><p>{order.delivery_method === 'delivery' ? 'Entrega' : 'Retirada'} · {PAYMENT_LABELS[order.payment_method]}</p><p className="mt-2 font-black text-brand-900"><Money value={order.total_cents / 100} /></p></div><div className="ml-auto mt-5 max-w-[92%] rounded-2xl rounded-br-md border border-emerald-200 bg-[#dcf8c6] p-4 text-sm text-stone-900 shadow-sm sm:max-w-[76%]"><div className="mb-2 flex items-center justify-between gap-3 text-[11px] font-black uppercase tracking-wide text-green-900"><span>Prévia — não enviada</span><span>{message.length}/{WHATSAPP_MESSAGE_MAX_LENGTH}</span></div><p className="whitespace-pre-wrap leading-relaxed">{message || 'Digite uma mensagem no campo abaixo.'}</p></div><OrderContext order={order} normalized={normalized} /></div></div>
    <MessageComposer template={template} message={message} normalized={normalized} url={url} onTemplate={onTemplate} onMessage={onMessage} />
  </main>;
}

function EmptyConversation() {
  return <div><span aria-hidden="true" className="mx-auto grid size-16 place-items-center rounded-full border border-stone-200 bg-white text-3xl text-brand-900 shadow-sm">◌</span><h2 className="mt-5 text-xl font-black text-brand-950">Suas conversas</h2><p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-stone-700">Selecione um contato na lista ao lado para visualizar o contexto e preparar uma resposta.</p><p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-stone-600">As novas mensagens aparecerão automaticamente quando a integração oficial estiver ativa.</p></div>;
}

function ChatHeader({ order, onBack }: { order: WhatsAppOrder; onBack: () => void }) {
  return <header className="flex min-h-[76px] items-center gap-3 border-b border-stone-200 bg-white px-4 py-3 sm:px-5"><button onClick={onBack} className="min-h-11 rounded-xl px-2 text-sm font-black text-brand-900 hover:bg-brand-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-900 lg:hidden">← Voltar</button><div className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-900 font-black text-white">{order.customer_name_snapshot.trim().charAt(0).toLocaleUpperCase('pt-BR')}</div><div className="min-w-0 flex-1"><h2 className="truncate font-black text-stone-950">{order.customer_name_snapshot}</h2><p className="truncate text-xs font-medium text-stone-600">{order.whatsapp_snapshot} · Pedido #{order.order_number}</p></div><OrderStatus status={order.status} /><a href="/admin/pedidos" className="hidden min-h-10 items-center rounded-xl border border-stone-300 bg-white px-3 text-xs font-black text-brand-900 hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-900 sm:flex">Abrir pedido</a></header>;
}

type ComposerProps = { template: WhatsAppTemplateId; message: string; normalized: string | null; url: string | null; onTemplate: (value: WhatsAppTemplateId) => void; onMessage: (value: string) => void };
function MessageComposer({ template, message, normalized, url, onTemplate, onMessage }: ComposerProps) {
  return <footer className="border-t border-stone-200 bg-white p-3 sm:p-4"><div className="mx-auto max-w-3xl"><div className="flex flex-wrap items-center gap-2"><label className="text-xs font-black text-stone-700">Mensagem rápida <select aria-label="Modelo de mensagem" value={template} onChange={event => onTemplate(event.target.value as WhatsAppTemplateId)} className={`${field} ml-2 min-h-10 py-1.5`}>{WHATSAPP_TEMPLATE_IDS.map(value => <option key={value} value={value}>{WHATSAPP_TEMPLATE_LABELS[value]}</option>)}</select></label><span className="text-[11px] font-medium text-stone-600">Anexos estarão disponíveis com a API oficial.</span></div><div className="mt-3 flex items-end gap-2"><label className="min-w-0 flex-1"><span className="sr-only">Digite uma mensagem</span><textarea aria-label="Mensagem" value={message} maxLength={WHATSAPP_MESSAGE_MAX_LENGTH} onChange={event => onMessage(event.target.value)} rows={2} placeholder="Digite uma mensagem..." className={`${field} block max-h-36 min-h-[52px] w-full resize-y`} /></label>{url ? <a href={url} target="_blank" rel="noopener noreferrer" className="grid min-h-[52px] shrink-0 place-items-center rounded-xl bg-green-800 px-4 text-sm font-black text-white transition hover:bg-green-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-900">Continuar no WhatsApp</a> : <button disabled className="min-h-[52px] shrink-0 rounded-xl bg-stone-300 px-4 text-sm font-black text-stone-600">Continuar</button>}</div>{!normalized && <p role="alert" className="mt-2 text-xs font-semibold text-red-800">O telefone deste pedido não é um número brasileiro válido para WhatsApp.</p>}{normalized && !url && <p role="alert" className="mt-2 text-xs font-semibold text-red-800">A mensagem deve conter entre 1 e {WHATSAPP_MESSAGE_MAX_LENGTH} caracteres.</p>}<p className="mt-2 text-[11px] font-medium text-stone-600">A mensagem será aberta para revisão e envio manual. Nada é enviado ou registrado automaticamente.</p></div></footer>;
}

function OrderContext({ order, normalized }: { order: WhatsAppOrder; normalized: string | null }) {
  return <details className="mt-5 rounded-2xl border border-stone-200 bg-white/90 text-sm shadow-sm"><summary className="cursor-pointer px-4 py-3 font-black text-brand-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-900">Ver contexto completo do pedido</summary><div className="grid gap-4 border-t border-stone-200 p-4 sm:grid-cols-2"><Info label="Destino" value={normalized ? `+${normalized}` : 'Telefone inválido'} /><Info label="Pagamento" value={PAYMENT_LABELS[order.payment_method]} /><Info label="Modalidade" value={order.delivery_method === 'delivery' ? 'Entrega' : 'Retirada'} /><Info label="Total" value={<Money value={order.total_cents / 100} />} />{order.delivery_method === 'delivery' && <Info label="Endereço" value={order.address_snapshot || 'Não informado'} />}<Info label="Observações" value={order.notes || 'Nenhuma'} /><div className="sm:col-span-2"><b className="text-xs uppercase tracking-wide text-stone-700">Itens</b><ul className="mt-2 space-y-2 text-stone-800">{order.items.map(item => <li key={item.id} className="rounded-xl bg-stone-50 p-3"><strong>{item.quantity}× {item.product_name_snapshot}</strong>{item.size_snapshot && <span> — {item.size_snapshot === 'small' ? 'Pequena' : 'Grande'}</span>}{item.addons.map(addon => <small className="block text-stone-600" key={addon.id}>+ {addon.quantity}× {addon.addon_name_snapshot}</small>)}{item.notes && <small className="block whitespace-pre-wrap text-stone-600">Obs.: {item.notes}</small>}</li>)}</ul></div></div></details>;
}

function Info({ label, value }: { label: string; value: ReactNode }) { return <p className="whitespace-pre-wrap text-stone-800"><b className="block text-xs uppercase tracking-wide text-stone-700">{label}</b>{value}</p>; }
function OrderStatus({ status, compact = false }: { status: OrderStatus; compact?: boolean }) {
  const tone = status === 'cancelled' ? 'border-red-300 bg-red-100 text-red-950' : status === 'delivered' ? 'border-emerald-300 bg-emerald-100 text-emerald-950' : 'border-orange-300 bg-orange-100 text-orange-950';
  return <span className={`shrink-0 rounded-full border font-black ${tone} ${compact ? 'px-2 py-0.5 text-[10px]' : 'hidden px-3 py-1 text-xs sm:inline-flex'}`}>{ORDER_STATUS_LABELS[status]}</span>;
}
function Unavailable({ refreshing, refresh, error }: { refreshing: boolean; refresh: () => Promise<void>; error: string | null }) { return <div><PageHeader refreshing={refreshing} refresh={refresh} /><div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-5"><p role="alert" className="font-medium text-red-800">{error ?? 'Central indisponível.'}</p></div></div>; }
