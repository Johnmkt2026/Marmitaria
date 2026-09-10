'use client';

import Image from 'next/image';
import { useRef, useState, type FormEvent } from 'react';
import { placeOrder } from '@/app/cardapio/actions';
import type { DailyMenu, MenuProduct, OrderReceipt } from '@/lib/menu-types';
import { Badge, Button, Money } from '@/components/ui';

type Size = 'small' | 'large';
type Line = { product: MenuProduct; size: Size | null; quantity: number; extras: string[]; note: string };
type DeliveryMethod = 'delivery' | 'pickup';
type ReceiptView = { receipt: OrderReceipt; delivery: DeliveryMethod };
const money = (value: number) => <Money value={value / 100} />;
const sizeLabel = (size: Size | null) => size === 'small' ? 'Pequena' : size === 'large' ? 'Grande' : null;
const lineUnitPrice = (line: Line) => line.product.product_type === 'meal' ? (line.size === 'small' ? line.product.small_price_cents : line.size === 'large' ? line.product.large_price_cents : 0) ?? 0 : line.product.price_cents;
const lineTotal = (line: Line) => (lineUnitPrice(line) + line.product.addons.filter(addon => line.extras.includes(addon.id)).reduce((sum, addon) => sum + addon.price_cents, 0)) * line.quantity;
function selectionError(line: Line) {
  if (line.product.product_type === 'meal' && !line.size) return `${line.product.name}: escolha Pequena ou Grande.`;
  for (const option of line.product.options) {
    const count = line.product.addons.filter(addon => addon.option_id === option.id && line.extras.includes(addon.id)).length;
    const min = Math.max(option.min_choices, option.required ? 1 : 0);
    if (count < min || count > option.max_choices) return `${line.product.name}: selecione de ${min} a ${option.max_choices} em ${option.name}.`;
  }
  return null;
}

export function PublicMenu({ restaurant, categories, products }: DailyMenu) {
  const [cart, setCart] = useState<Line[]>([]);
  const [checkout, setCheckout] = useState(false);
  const [receiptView, setReceiptView] = useState<ReceiptView | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<MenuProduct | null>(null);
  const [delivery, setDelivery] = useState<DeliveryMethod>('delivery');
  const lineTotals = cart.map(lineTotal);
  const subtotal = lineTotals.reduce((sum, value) => sum + value, 0);
  const fee = cart.length && delivery === 'delivery' ? restaurant.delivery_fee_cents : 0;
  const total = subtotal + fee;
  const invalidSelection = cart.map(selectionError).find(Boolean);
  const meals = products.filter(product => product.product_type === 'meal');
  const beverages = products.filter(product => product.product_type === 'beverage');
  const visibleCategories = categories.filter(category => meals.some(product => product.category_id === category.id));
  const update = (index: number, change: Partial<Line>) => setCart(current => current.map((line, i) => i === index ? { ...line, ...change } : line));

  if (receiptView) {
    const { receipt, delivery: confirmedDelivery } = receiptView;
    return <main className="grid min-h-screen place-items-center bg-orange-50 p-5">
    <div role="status" className="max-w-md rounded-3xl bg-white p-8 text-center shadow-xl">
      <div className="text-5xl" aria-hidden="true">🎉</div><h1 className="mt-4 text-2xl font-black">Pedido recebido</h1>
      <p className="mt-3 text-lg font-bold">Pedido #{receipt.order_number}</p>
      <p className="mt-2 text-stone-600">Seu pedido foi registrado com sucesso.</p>
      <ul className="mt-5 space-y-2 text-left text-sm">{receipt.items.map((item, index) => <li key={`${item.product_id}-${index}`} className="rounded-xl bg-stone-50 p-3"><b>{item.quantity}× {item.name}</b>{item.size && <span className="block">Tamanho: {sizeLabel(item.size)}</span>}<span className="block">{money(item.unit_price_cents)} por unidade</span>{item.addons.map((addon, addonIndex) => <small key={addonIndex} className="block text-stone-600">+ {addon.quantity}× {addon.name} · {money(addon.unit_price_cents)}</small>)}</li>)}</ul>
      <dl className="mt-5 space-y-2 text-sm">
        <div className="flex justify-between gap-8"><dt>Modalidade</dt><dd>{confirmedDelivery === 'delivery' ? 'Entrega' : 'Retirada'}</dd></div>
        {confirmedDelivery === 'delivery' && restaurant.delivery_minutes_min !== null && restaurant.delivery_minutes_max !== null && <div className="flex justify-between gap-8"><dt>Prazo estimado</dt><dd>{restaurant.delivery_minutes_min}–{restaurant.delivery_minutes_max} min</dd></div>}
        <div className="flex justify-between gap-8"><dt>Subtotal</dt><dd>{money(receipt.subtotal_cents)}</dd></div>
        <div className="flex justify-between gap-8"><dt>{confirmedDelivery === 'delivery' ? 'Taxa de entrega' : 'Taxa de retirada'}</dt><dd>{money(receipt.delivery_fee_cents)}</dd></div>
        <div className="flex justify-between gap-8 text-lg font-black"><dt>Total confirmado</dt><dd>{money(receipt.total_cents)}</dd></div>
      </dl>
      <Button className="mt-6 min-h-12" onClick={() => { setReceiptView(null); setCheckout(false); setCart([]); }}>Voltar ao cardápio</Button>
    </div>
  </main>;
  }

  return <main className="min-h-screen bg-stone-50">
    <header className="bg-brand-600 px-5 py-7 text-white"><div className="mx-auto max-w-6xl">
      <p className="text-sm font-semibold text-orange-100">Comida caseira, feita hoje</p><h1 className="text-3xl font-black">{restaurant.name}</h1>
      <div className="mt-4 flex flex-wrap gap-2">
        <Badge tone={restaurant.is_open ? 'green' : 'red'}>● {restaurant.is_open ? 'Aberto' : 'Fechado'}</Badge>
        <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">Cardápio de hoje</span>
        {restaurant.delivery_minutes_min !== null && restaurant.delivery_minutes_max !== null && <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">Entrega em {restaurant.delivery_minutes_min}–{restaurant.delivery_minutes_max} min</span>}
      </div>
    </div></header>
    <div className="mx-auto grid max-w-6xl gap-6 p-4 md:grid-cols-[1fr_340px] md:p-6">
      <section aria-label="Produtos do dia">
        {!restaurant.is_open && <p role="status" className="mb-4 rounded-2xl border border-orange-300 bg-orange-100 p-4 font-semibold text-orange-950">Estamos fechados no momento. Você pode consultar o cardápio, mas os pedidos estão pausados.</p>}
        <div className="mb-5 flex gap-2 overflow-x-auto">{visibleCategories.map(category => <a key={category.id} href={`#category-${category.id}`} className="rounded-full border bg-white px-4 py-2 text-sm font-semibold">{category.name}</a>)}{beverages.length > 0 && <a href="#beverages" className="rounded-full border bg-white px-4 py-2 text-sm font-semibold">Bebidas</a>}</div>
        {products.length === 0 && <p className="rounded-2xl border border-dashed bg-white p-8 text-center text-stone-600">Ainda não há itens disponíveis hoje. Volte mais tarde.</p>}
        {visibleCategories.map(category => <div id={`category-${category.id}`} key={category.id} className="mb-8">
          <h2 className="mb-3 text-xl font-black">{category.name}</h2><div className="grid gap-3 sm:grid-cols-2">
            {meals.filter(product => product.category_id === category.id).map(product => <article aria-label={product.name} className={`rounded-2xl border bg-white p-4 ${product.sold_out ? 'opacity-60' : ''}`} key={product.id}>
              <div className="flex gap-3"><div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl bg-orange-50 text-3xl">
                {product.image_url && /^(https?:\/\/|\/)/.test(product.image_url)
                  ? <Image src={product.image_url} alt={product.name} width={64} height={64} unoptimized className="h-full w-full object-cover" />
                  : <span aria-hidden="true">{product.image_url || '🍲'}</span>}
              </div><div className="min-w-0"><b>{product.name}</b>{product.product_type === 'meal' ? <div className="mt-1 flex flex-wrap gap-2 text-sm font-bold text-brand-700"><span>Pequena {money(product.small_price_cents ?? 0)}</span><span>Grande {money(product.large_price_cents ?? 0)}</span></div> : <b className="mt-1 block text-brand-600">{money(product.price_cents)}</b>}<p className="mt-1 text-sm text-stone-600">{product.description}</p></div></div>
              <div className="mt-3 flex justify-between"><Badge tone={product.sold_out ? 'red' : 'green'}>{product.sold_out ? 'Esgotado' : 'Disponível'}</Badge>
                <Button className="min-h-11" disabled={product.sold_out || !restaurant.is_open} onClick={() => setSelectedProduct(product)}>{product.product_type === 'meal' ? 'Escolher' : 'Adicionar'}</Button>
              </div>
            </article>)}
          </div>
        </div>)}
        {beverages.length > 0 && <div id="beverages" className="mb-8"><h2 className="mb-3 text-xl font-black">Bebidas</h2><div className="grid gap-3 sm:grid-cols-2">{beverages.map(product => <article aria-label={product.name} className="rounded-2xl border bg-white p-4" key={product.id}><div className="flex gap-3"><div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl bg-orange-50 text-3xl"><span aria-hidden="true">🥤</span></div><div className="min-w-0"><b>{product.name}</b><b className="mt-1 block text-brand-600">{money(product.price_cents)}</b></div></div><div className="mt-3 flex justify-between"><Badge tone="green">Disponível</Badge><Button className="min-h-11" disabled={!restaurant.is_open} onClick={() => setSelectedProduct(product)}>Adicionar</Button></div></article>)}</div></div>}
      </section>
      <aside id="carrinho" aria-label="Carrinho" className="h-fit scroll-mt-4 rounded-2xl border bg-white p-4 shadow-sm md:sticky md:top-20">
        <div className="flex justify-between"><h2 className="text-lg font-black">Seu pedido</h2><span className="text-sm text-stone-500">{cart.reduce((sum, line) => sum + line.quantity, 0)} itens</span></div>
        {cart.length === 0 ? <p className="py-8 text-center text-sm text-stone-500">Escolha uma marmita para começar.</p> : <>
          <div className="my-4 space-y-3">{cart.map((line, index) => <div key={`${line.product.id}-${index}`} className="border-b pb-3">
            <div className="flex justify-between gap-2"><span><b>{line.product.name}</b>{line.size && <small className="block">Tamanho: {sizeLabel(line.size)}</small>}<small className="block">{line.quantity}× {money(lineUnitPrice(line))}</small></span><button onClick={() => setCart(current => current.filter((_, i) => i !== index))} className="text-xs text-red-600">Remover</button></div>
            <div className="mt-2 flex items-center gap-2"><button aria-label={`Diminuir quantidade de ${line.product.name}`} onClick={() => update(index, { quantity: Math.max(1, line.quantity - 1) })} className="grid min-h-11 min-w-11 place-items-center rounded-xl border text-lg">−</button><b aria-label="Quantidade">{line.quantity}</b><button aria-label={`Aumentar quantidade de ${line.product.name}`} disabled={line.quantity >= 999} onClick={() => update(index, { quantity: line.quantity + 1 })} className="grid min-h-11 min-w-11 place-items-center rounded-xl border text-lg">+</button></div>
            {line.extras.length > 0 && <ul className="mt-2 text-xs text-stone-600">{line.product.addons.filter(addon => line.extras.includes(addon.id)).map(addon => <li key={addon.id}>+ {addon.name} · {money(addon.price_cents)} por unidade</li>)}</ul>}
            {line.note && <p className="mt-2 rounded-lg bg-stone-50 p-2 text-xs"><b>Observação:</b> {line.note}</p>}
            <p className="mt-2 text-right text-xs font-semibold">Total do item: {money(lineTotals[index])}</p>
          </div>)}</div>
          <div className="space-y-2 border-t pt-3 text-sm"><p className="flex justify-between"><span>Subtotal</span>{money(subtotal)}</p><p className="flex justify-between"><span>{delivery === 'delivery' ? 'Entrega' : 'Retirada'}</span>{money(fee)}</p><p className="flex justify-between text-base font-black"><span>Total</span>{money(total)}</p></div>
          {invalidSelection && <p role="alert" className="mt-3 text-xs text-red-700">{invalidSelection}</p>}
          <Button disabled={!restaurant.is_open || !!invalidSelection} className="mt-4 min-h-12 w-full" onClick={() => setCheckout(true)}>Revisar e finalizar</Button>
        </>}
      </aside>
    </div>
    {cart.length > 0 && !checkout && <a href="#carrinho" className="fixed inset-x-4 bottom-4 z-20 flex min-h-12 items-center justify-between rounded-2xl bg-brand-600 px-5 font-bold text-white shadow-xl md:hidden"><span>Ver pedido · {cart.reduce((sum, line) => sum + line.quantity, 0)} item(ns)</span><span>{money(total)}</span></a>}
    {selectedProduct && <ProductCustomizer product={selectedProduct} close={() => setSelectedProduct(null)} add={line => { setCart(current => [...current, line]); setSelectedProduct(null); }} />}
    {checkout && <Checkout cart={cart} subtotal={subtotal} fee={fee} total={total} deliveryFee={restaurant.delivery_fee_cents} delivery={delivery} setDelivery={setDelivery} close={() => setCheckout(false)} confirm={result => { setReceiptView({ receipt: result, delivery }); setCheckout(false); setCart([]); }} />}
  </main>;
}

function ProductCustomizer({ product, close, add }: { product: MenuProduct; close: () => void; add: (line: Line) => void }) {
  const [size, setSize] = useState<Size | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [extras, setExtras] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const line = { product, size: product.product_type === 'meal' ? size : null, quantity, extras, note };
  const error = selectionError(line);
  const groupedIds = new Set(product.options.map(option => option.id));
  const looseAddons = product.addons.filter(addon => !addon.option_id || !groupedIds.has(addon.option_id));
  const toggle = (addonId: string, optionId: string | null) => {
    if (extras.includes(addonId)) { setExtras(current => current.filter(id => id !== addonId)); return; }
    const option = product.options.find(item => item.id === optionId);
    if (option) {
      const selected = product.addons.filter(addon => addon.option_id === option.id && extras.includes(addon.id));
      if (selected.length >= option.max_choices) return;
    }
    setExtras(current => [...current, addonId]);
  };
  return <div className="fixed inset-0 z-30 grid place-items-end bg-black/40 sm:place-items-center" onKeyDown={event => { if (event.key === 'Escape') close(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="product-title" className="max-h-[95dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 sm:rounded-3xl sm:p-6">
      <div className="flex items-start justify-between gap-4"><div><p className="text-sm font-semibold text-brand-700">{product.product_type === 'meal' ? 'Personalize seu prato' : 'Adicionar bebida'}</p><h2 id="product-title" className="text-xl font-black">{product.name}</h2></div><button type="button" aria-label="Fechar detalhes" onClick={close} className="grid min-h-11 min-w-11 place-items-center rounded-xl border">✕</button></div>
      {product.image_url && /^(https?:\/\/|\/)/.test(product.image_url) && <Image src={product.image_url} alt={product.name} width={480} height={240} unoptimized className="mt-4 h-44 w-full rounded-2xl object-cover"/>}
      {product.description && <p className="mt-2 text-sm text-stone-600">{product.description}</p>}
      <p className="mt-3 font-black text-brand-700">{product.product_type === 'meal' ? <>A partir de {money(product.small_price_cents ?? 0)}</> : money(product.price_cents)}</p>
      <div className="mt-5 space-y-5">
        {product.product_type === 'meal' && <fieldset><legend className="font-bold">Escolha o tamanho</legend><div className="mt-2 grid grid-cols-2 gap-2"><ChoiceButton selected={size === 'small'} onClick={() => setSize('small')} title="Pequena" detail={money(product.small_price_cents ?? 0)}/><ChoiceButton selected={size === 'large'} onClick={() => setSize('large')} title="Grande" detail={money(product.large_price_cents ?? 0)}/></div></fieldset>}
        {product.product_type === 'meal' && product.options.map(option => {
          const min = Math.max(option.min_choices, option.required ? 1 : 0);
          const selectedCount = product.addons.filter(addon => addon.option_id === option.id && extras.includes(addon.id)).length;
          const instruction = min === option.max_choices ? `Escolha ${min} opção${min === 1 ? '' : 'ões'}` : min > 0 ? `Escolha de ${min} a ${option.max_choices} opções` : `Escolha até ${option.max_choices} opções`;
          return <fieldset key={option.id}><legend className="w-full"><span className="font-bold">{option.name}</span><span className="ml-2 text-xs text-stone-500">{instruction} · {selectedCount}/{option.max_choices}</span></legend><div className="mt-2 grid gap-2">{product.addons.filter(addon => addon.option_id === option.id).map(addon => <AddonChoice key={addon.id} addon={addon} selected={extras.includes(addon.id)} toggle={() => toggle(addon.id, option.id)} />)}</div></fieldset>;
        })}
        {product.product_type === 'meal' && looseAddons.length > 0 && <fieldset><legend className="font-bold">Adicionais</legend><div className="mt-2 grid gap-2">{looseAddons.map(addon => <AddonChoice key={addon.id} addon={addon} selected={extras.includes(addon.id)} toggle={() => toggle(addon.id, null)} />)}</div></fieldset>}
        <label className="block text-sm font-semibold">Observação do item<textarea value={note} onChange={event => setNote(event.target.value)} maxLength={500} rows={3} placeholder="Ex.: sem cebola" className="mt-1 w-full rounded-xl border p-3 font-normal" /></label>
        <div><span className="text-sm font-semibold">Quantidade</span><div className="mt-2 flex items-center gap-3"><button type="button" aria-label="Diminuir quantidade" onClick={() => setQuantity(current => Math.max(1, current - 1))} className="grid min-h-12 min-w-12 place-items-center rounded-xl border text-xl">−</button><b aria-live="polite">{quantity}</b><button type="button" aria-label="Aumentar quantidade" disabled={quantity >= 999} onClick={() => setQuantity(current => current + 1)} className="grid min-h-12 min-w-12 place-items-center rounded-xl border text-xl">+</button></div></div>
      </div>
      {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <Button className="mt-5 min-h-12 w-full" disabled={!!error} onClick={() => add(line)}>Adicionar ao pedido · {money(lineTotal(line))}</Button>
    </section>
  </div>;
}

function AddonChoice({ addon, selected, toggle }: { addon: MenuProduct['addons'][number]; selected: boolean; toggle: () => void }) {
  return <button type="button" aria-pressed={selected} onClick={toggle} className={`flex min-h-12 items-center justify-between rounded-xl border p-3 text-left text-sm ${selected ? 'border-brand-500 bg-orange-50' : 'bg-white'}`}><span>{addon.name}</span><b>+ {money(addon.price_cents)}</b></button>;
}

function Checkout({ cart, subtotal, fee, total, deliveryFee, delivery, setDelivery, close, confirm }: {
  cart: Line[]; subtotal: number; fee: number; total: number; deliveryFee: number; delivery: DeliveryMethod;
  setDelivery: (value: DeliveryMethod) => void; close: () => void; confirm: (receipt: OrderReceipt) => void;
}) {
  const [payment, setPayment] = useState<'pix' | 'card' | 'cash'>('pix');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? '');
    const change = text('change').trim();
    let changeCents: number | null = null;
    if (payment === 'cash' && change) {
      if (!/^\d+([,.]\d{1,2})?$/.test(change)) { setError('Informe um valor de troco válido.'); return; }
      const [whole, fraction = ''] = change.replace(',', '.').split('.');
      changeCents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    }
    submitting.current = true;
    setPending(true); setError(null);
    try {
      const result = await placeOrder({
        customer_name: text('name'), whatsapp: text('whatsapp'), delivery_method: delivery,
        payment_method: payment, address: text('address'), notes: text('notes'), change_for_cents: changeCents,
        items: cart.map(line => ({ product_id: line.product.id, size: line.size, quantity: line.quantity, addon_ids: line.extras, notes: line.note })),
      });
      if (result.error) setError(result.error);
      else if (result.receipt) confirm(result.receipt);
    } catch {
      setError('A conexão foi interrompida. Consulte o restaurante antes de repetir o pedido.');
    } finally { submitting.current = false; setPending(false); }
  }
  const field = 'w-full rounded-xl border p-3';
  return <div className="fixed inset-0 z-30 grid place-items-end bg-black/40 sm:place-items-center" onKeyDown={event => { if (event.key === 'Escape' && !pending) close(); }}>
    <form onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="checkout-title" aria-busy={pending} className="max-h-[95dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-6 sm:rounded-3xl">
      <div className="flex justify-between gap-3"><div><p className="text-sm font-semibold text-brand-700">Confira antes de enviar</p><h2 id="checkout-title" className="text-xl font-black">Finalizar pedido</h2></div><button type="button" aria-label="Fechar checkout" disabled={pending} onClick={close} className="grid min-h-11 min-w-11 place-items-center rounded-xl border">✕</button></div>
      <fieldset disabled={pending} className="mt-5 grid gap-4">
        <label className="text-sm font-semibold">Seu nome<input autoFocus required minLength={2} maxLength={120} name="name" autoComplete="name" placeholder="Como podemos chamar você?" className={`${field} mt-1 font-normal`} /></label>
        <label className="text-sm font-semibold">WhatsApp<input required name="whatsapp" autoComplete="tel" type="tel" inputMode="tel" placeholder="(DDD) número" className={`${field} mt-1 font-normal`} /></label>
        <fieldset><legend className="text-sm font-semibold">Como você quer receber?</legend><div className="mt-2 grid grid-cols-2 gap-2"><ChoiceButton selected={delivery === 'delivery'} onClick={() => setDelivery('delivery')} title="Entrega" detail={<>Taxa {money(deliveryFee)}</>} /><ChoiceButton selected={delivery === 'pickup'} onClick={() => setDelivery('pickup')} title="Retirada" detail="Taxa R$ 0,00" /></div></fieldset>
        {delivery === 'delivery' && <label className="text-sm font-semibold">Endereço de entrega<textarea required minLength={5} maxLength={500} name="address" autoComplete="street-address" rows={3} placeholder="Rua, número, complemento, bairro e referência" className={`${field} mt-1 font-normal`} /></label>}
        <fieldset><legend className="text-sm font-semibold">Forma de pagamento</legend><div className="mt-2 grid grid-cols-3 gap-2"><ChoiceButton selected={payment === 'pix'} onClick={() => setPayment('pix')} title="Pix"/><ChoiceButton selected={payment === 'card'} onClick={() => setPayment('card')} title="Cartão"/><ChoiceButton selected={payment === 'cash'} onClick={() => setPayment('cash')} title="Dinheiro"/></div></fieldset>
        {payment === 'cash' && <label className="text-sm font-semibold">Troco<input name="change" aria-label="Troco para quanto?" inputMode="decimal" placeholder="Troco para quanto? (opcional)" className={`${field} mt-1 font-normal`} /></label>}
        <label className="text-sm font-semibold">Observação do pedido<textarea name="notes" maxLength={1000} rows={2} placeholder="Alguma orientação para o pedido?" className={`${field} mt-1 font-normal`} /></label>
      </fieldset>
      {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <section aria-label="Resumo do pedido" className="mt-5 rounded-2xl bg-stone-50 p-4"><h3 className="font-bold">Resumo</h3><ul className="mt-2 space-y-2 text-sm">{cart.map((line, index) => <li key={`${line.product.id}-${index}`}><div className="flex justify-between gap-3"><span>{line.quantity}× {line.product.name}{line.size ? ` — ${sizeLabel(line.size)}` : ''}</span><b>{money(lineUnitPrice(line) * line.quantity)}</b></div>{line.product.addons.filter(addon => line.extras.includes(addon.id)).map(addon => <small key={addon.id} className="flex justify-between text-stone-600"><span>+ {line.quantity}× {addon.name}</span><span>{money(addon.price_cents * line.quantity)}</span></small>)}</li>)}</ul><div className="mt-3 space-y-1 border-t pt-3 text-sm"><p className="flex justify-between"><span>Subtotal</span>{money(subtotal)}</p><p className="flex justify-between"><span>{delivery === 'delivery' ? 'Taxa de entrega' : 'Taxa de retirada'}</span>{money(fee)}</p><p className="flex justify-between text-base font-black"><span>Total</span>{money(total)}</p></div></section>
      <Button className="mt-5 min-h-12 w-full" disabled={pending} type="submit">{pending ? 'Registrando pedido...' : <>Confirmar pedido · {money(total)}</>}</Button>
    </form>
  </div>;
}

function ChoiceButton({ selected, onClick, title, detail }: { selected: boolean; onClick: () => void; title: string; detail?: React.ReactNode }) {
  return <button type="button" aria-pressed={selected} onClick={onClick} className={`min-h-14 rounded-xl border p-2 text-sm ${selected ? 'border-brand-500 bg-orange-50 text-brand-900' : 'bg-white'}`}><b>{title}</b>{detail && <span className="mt-0.5 block text-xs font-normal">{detail}</span>}</button>;
}
