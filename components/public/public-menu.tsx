'use client';

import Image from 'next/image';
import { useRef, useState, type FormEvent } from 'react';
import { placeOrder } from '@/app/cardapio/actions';
import type { DailyMenu, MenuProduct, OrderReceipt } from '@/lib/menu-types';
import { Badge, Button, Money } from '@/components/ui';

type Line = { product: MenuProduct; quantity: number; extras: string[]; note: string };
type DeliveryMethod = 'delivery' | 'pickup';
const money = (value: number) => <Money value={value / 100} />;
const lineTotal = (line: Line) => (line.product.price_cents + line.product.addons.filter(addon => line.extras.includes(addon.id)).reduce((sum, addon) => sum + addon.price_cents, 0)) * line.quantity;
function selectionError(line: Line) {
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
  const [receipt, setReceipt] = useState<OrderReceipt | null>(null);
  const [delivery, setDelivery] = useState<DeliveryMethod>('delivery');
  const lineTotals = cart.map(lineTotal);
  const subtotal = lineTotals.reduce((sum, value) => sum + value, 0);
  const fee = cart.length && delivery === 'delivery' ? restaurant.delivery_fee_cents : 0;
  const total = subtotal + fee;
  const invalidSelection = cart.map(selectionError).find(Boolean);
  const visibleCategories = categories.filter(category => products.some(product => product.category_id === category.id));
  const update = (index: number, change: Partial<Line>) => setCart(current => current.map((line, i) => i === index ? { ...line, ...change } : line));

  if (receipt) return <main className="grid min-h-screen place-items-center bg-orange-50 p-5">
    <div role="status" className="max-w-md rounded-3xl bg-white p-8 text-center shadow-xl">
      <div className="text-5xl">🎉</div><h1 className="mt-4 text-2xl font-black">Pedido recebido!</h1>
      <p className="mt-3 text-lg font-bold">Pedido #{receipt.order_number}</p>
      <p className="mt-2 text-stone-600">Seu pedido foi registrado com sucesso.</p>
      <dl className="mt-5 space-y-2 text-sm">
        <div className="flex justify-between gap-8"><dt>Subtotal</dt><dd>{money(receipt.subtotal_cents)}</dd></div>
        <div className="flex justify-between gap-8"><dt>Entrega</dt><dd>{money(receipt.delivery_fee_cents)}</dd></div>
        <div className="flex justify-between gap-8 text-lg font-black"><dt>Total confirmado</dt><dd>{money(receipt.total_cents)}</dd></div>
      </dl>
      <Button className="mt-6" onClick={() => { setReceipt(null); setCheckout(false); setCart([]); }}>Voltar ao cardápio</Button>
    </div>
  </main>;

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
        {!restaurant.is_open && <p role="status" className="mb-4 rounded-xl bg-orange-100 p-4">Estamos fechados no momento. Consulte nosso cardápio e volte mais tarde para pedir.</p>}
        <div className="mb-5 flex gap-2 overflow-x-auto">{visibleCategories.map(category => <a key={category.id} href={`#category-${category.id}`} className="rounded-full border bg-white px-4 py-2 text-sm font-semibold">{category.name}</a>)}</div>
        {products.length === 0 && <p className="rounded-2xl border border-dashed bg-white p-8 text-center text-stone-600">Ainda não há itens disponíveis hoje. Volte mais tarde.</p>}
        {visibleCategories.map(category => <div id={`category-${category.id}`} key={category.id} className="mb-8">
          <h2 className="mb-3 text-xl font-black">{category.name}</h2><div className="grid gap-3 sm:grid-cols-2">
            {products.filter(product => product.category_id === category.id).map(product => <article aria-label={product.name} className={`rounded-2xl border bg-white p-4 ${product.sold_out ? 'opacity-60' : ''}`} key={product.id}>
              <div className="flex gap-3"><div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl bg-orange-50 text-3xl">
                {product.image_url && /^(https?:\/\/|\/)/.test(product.image_url)
                  ? <Image src={product.image_url} alt={product.name} width={64} height={64} unoptimized className="h-full w-full object-cover" />
                  : <span aria-hidden="true">{product.image_url || '🍲'}</span>}
              </div><div className="min-w-0"><div className="flex flex-wrap gap-2"><b>{product.name}</b><b className="text-brand-600">{money(product.price_cents)}</b></div><p className="mt-1 text-sm text-stone-600">{product.description}</p></div></div>
              <div className="mt-3 flex justify-between"><Badge tone={product.sold_out ? 'red' : 'green'}>{product.sold_out ? 'Esgotado' : 'Disponível'}</Badge>
                <Button disabled={product.sold_out || !restaurant.is_open} onClick={() => setCart(current => [...current, { product, quantity: 1, extras: [], note: '' }])}>Adicionar</Button>
              </div>
            </article>)}
          </div>
        </div>)}
      </section>
      <aside aria-label="Carrinho" className="h-fit rounded-2xl border bg-white p-4 shadow-sm md:sticky md:top-20">
        <div className="flex justify-between"><h2 className="text-lg font-black">Seu pedido</h2><span className="text-sm text-stone-500">{cart.reduce((sum, line) => sum + line.quantity, 0)} itens</span></div>
        {cart.length === 0 ? <p className="py-8 text-center text-sm text-stone-500">Escolha uma marmita para começar.</p> : <>
          <div className="my-4 space-y-3">{cart.map((line, index) => <div key={`${line.product.id}-${index}`} className="border-b pb-3">
            <div className="flex justify-between"><span><b>{line.product.name}</b><br /><small>{line.quantity}× {money(line.product.price_cents)}</small></span><button onClick={() => setCart(current => current.filter((_, i) => i !== index))} className="text-xs text-red-600">Remover</button></div>
            <div className="mt-2 flex gap-2"><button aria-label={`Diminuir quantidade de ${line.product.name}`} onClick={() => update(index, { quantity: Math.max(1, line.quantity - 1) })} className="rounded border px-2">−</button><b aria-label="Quantidade">{line.quantity}</b><button aria-label={`Aumentar quantidade de ${line.product.name}`} disabled={line.quantity >= 999} onClick={() => update(index, { quantity: line.quantity + 1 })} className="rounded border px-2">+</button></div>
            {line.product.options.map(option => <p key={option.id} className="mt-2 text-xs text-stone-500">{option.name}: {Math.max(option.min_choices, option.required ? 1 : 0)} a {option.max_choices} opções por unidade</p>)}
            <div className="mt-2 flex flex-wrap gap-1">{line.product.addons.map(extra => <button key={extra.id} aria-pressed={line.extras.includes(extra.id)} onClick={() => update(index, { extras: line.extras.includes(extra.id) ? line.extras.filter(id => id !== extra.id) : [...line.extras, extra.id] })} className={`rounded-lg px-2 py-1 text-xs ${line.extras.includes(extra.id) ? 'bg-orange-100' : 'bg-stone-100'}`}>+ {extra.name} ({money(extra.price_cents)}/un.)</button>)}</div>
            <input aria-label={`Observação de ${line.product.name}`} maxLength={500} value={line.note} onChange={event => update(index, { note: event.target.value })} placeholder="Observação" className="mt-2 w-full rounded border px-2 py-1 text-xs" />
            <p className="mt-2 text-right text-xs font-semibold">Total do item: {money(lineTotals[index])}</p>
          </div>)}</div>
          <div className="space-y-2 border-t pt-3 text-sm"><p className="flex justify-between"><span>Subtotal</span>{money(subtotal)}</p><p className="flex justify-between"><span>{delivery === 'delivery' ? 'Entrega' : 'Retirada'}</span>{money(fee)}</p><p className="flex justify-between text-base font-black"><span>Total</span>{money(total)}</p></div>
          {invalidSelection && <p role="alert" className="mt-3 text-xs text-red-700">{invalidSelection}</p>}
          <Button disabled={!restaurant.is_open || !!invalidSelection} className="mt-4 w-full" onClick={() => setCheckout(true)}>Finalizar pedido</Button>
        </>}
      </aside>
    </div>
    {checkout && <Checkout cart={cart} subtotal={subtotal} fee={fee} total={total} delivery={delivery} setDelivery={setDelivery} close={() => setCheckout(false)} confirm={result => { setReceipt(result); setCheckout(false); setCart([]); }} />}
  </main>;
}

function Checkout({ cart, subtotal, fee, total, delivery, setDelivery, close, confirm }: {
  cart: Line[]; subtotal: number; fee: number; total: number; delivery: DeliveryMethod;
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
        items: cart.map(line => ({ product_id: line.product.id, quantity: line.quantity, addon_ids: line.extras, notes: line.note })),
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
      <div className="flex justify-between"><h2 id="checkout-title" className="text-xl font-black">Finalizar pedido</h2><button type="button" aria-label="Fechar checkout" disabled={pending} onClick={close}>✕</button></div>
      <fieldset disabled={pending} className="mt-5 grid gap-3">
        <input autoFocus required minLength={2} maxLength={120} name="name" aria-label="Seu nome" autoComplete="name" placeholder="Seu nome" className={field} />
        <input required name="whatsapp" aria-label="WhatsApp" autoComplete="tel" type="tel" placeholder="WhatsApp" className={field} />
        <select aria-label="Forma de recebimento" value={delivery} onChange={event => setDelivery(event.target.value as DeliveryMethod)} className={field}><option value="delivery">Entrega</option><option value="pickup">Retirada</option></select>
        {delivery === 'delivery' && <input required minLength={5} maxLength={500} name="address" aria-label="Endereço completo" autoComplete="street-address" placeholder="Endereço completo" className={field} />}
        <select aria-label="Forma de pagamento" value={payment} onChange={event => setPayment(event.target.value as typeof payment)} className={field}><option value="pix">Pix</option><option value="card">Cartão</option><option value="cash">Dinheiro</option></select>
        {payment === 'cash' && <input name="change" aria-label="Troco para quanto?" inputMode="decimal" placeholder="Troco para quanto? (opcional)" className={field} />}
        <textarea name="notes" aria-label="Observação do pedido" maxLength={1000} placeholder="Observação" className={field} />
      </fieldset>
      {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="mt-4 space-y-1 text-sm"><p className="flex justify-between"><span>Subtotal</span>{money(subtotal)}</p><p className="flex justify-between"><span>{delivery === 'delivery' ? 'Entrega' : 'Retirada'}</span>{money(fee)}</p></div>
      <div className="mt-5 flex items-center justify-between gap-3"><b>Total: {money(total)}</b><Button disabled={pending} type="submit">{pending ? 'Enviando pedido...' : 'Confirmar pedido'}</Button></div>
    </form>
  </div>;
}
