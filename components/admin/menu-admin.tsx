'use client';

import Image from 'next/image';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { copyYesterdayMenu, createAddon, createOption, createProduct, loadAdminMenu, updateAddon, updateAvailability, updateOption, updateProduct } from '@/app/admin/cardapio/actions';
import type { AdminMenuAddon, AdminMenuData, AdminMenuOption, AdminMenuProduct, AdminMenuResult, MenuMutationResult } from '@/lib/admin-menu-types';
import { createClient } from '@/lib/supabase/client';
import { Badge, Button, Card, Money } from '@/components/ui';

type Modal = { kind: 'product'; productType: 'meal' | 'beverage'; value?: AdminMenuProduct } | { kind: 'extras'; value: AdminMenuProduct };
const str = (form: FormData, key: string) => String(form.get(key) ?? '');
const num = (form: FormData, key: string) => Number(form.get(key));
const checked = (form: FormData, key: string) => form.get(key) === 'on';
const IMAGE_BUCKET = 'product-images';
const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
function storagePath(url: string | null) {
  if (!url) return null;
  try {
    const marker = `/storage/v1/object/public/${IMAGE_BUCKET}/`;
    const path = new URL(url).pathname;
    return path.includes(marker) ? decodeURIComponent(path.split(marker)[1] ?? '') || null : null;
  } catch { return null; }
}
function ProductImage({ product, className = 'h-20 w-20' }: { product: Pick<AdminMenuProduct, 'name' | 'image_url' | 'product_type'>; className?: string }) {
  return <div className={`${className} grid shrink-0 place-items-center overflow-hidden rounded-2xl border border-stone-100 bg-gradient-to-br from-orange-50 to-terracotta-100 text-3xl shadow-inner`}>
    {product.image_url && /^(https?:\/\/|\/)/.test(product.image_url)
      ? <Image src={product.image_url} alt={product.name} width={160} height={160} unoptimized className="h-full w-full object-cover" />
      : <span role="img" aria-label={product.product_type === 'beverage' ? 'Bebida sem imagem' : 'Prato sem imagem'}>{product.product_type === 'beverage' ? '🥤' : '🍲'}</span>}
  </div>;
}
function PriceBlock({ label, cents }: { label: string; cents: number }) {
  return <div className="min-w-0 rounded-2xl border border-emerald-100 bg-emerald-50/70 px-3 py-3 sm:px-4"><span className="block text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-800">{label}</span><strong className="mt-1 block text-base text-brand-700 sm:text-lg"><Money value={cents / 100}/></strong></div>;
}
function EmptyState({ title, description }: { title: string; description: string }) {
  return <Card className="border-dashed py-10 text-center"><div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-orange-50 text-2xl" aria-hidden="true">🍽️</div><h3 className="mt-3 font-black text-stone-800">{title}</h3><p className="mx-auto mt-1 max-w-md text-sm text-stone-500">{description}</p></Card>;
}

export function MenuAdmin({ initial }: { initial: AdminMenuResult }) {
  const [data, setData] = useState<AdminMenuData | null>(initial.data ?? null);
  const [error, setError] = useState(initial.error ?? null);
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState<Modal | null>(null);
  const [view, setView] = useState<'today' | 'meals' | 'beverages'>('today');
  const [search, setSearch] = useState('');

  async function refresh() {
    const result = await loadAdminMenu();
    if (result.data) { setData(result.data); setError(null); }
    else setError(result.error);
  }
  async function mutate(operation: Promise<MenuMutationResult>, close = false) {
    if (saving) return null;
    setSaving(true); setError(null); setNotice('');
    try {
      const result = await operation;
      if (result.data) { setNotice(result.data.message); await refresh(); if (close) setModal(null); }
      else { setError(result.error); if (result.conflict) await refresh(); }
      return result;
    } catch { setError('A conexão foi interrompida. Atualize os dados e tente novamente.'); return null; }
    finally { setSaving(false); }
  }
  async function saveProduct(form: FormData, value?: AdminMenuProduct) {
    if (saving) return;
    const productId = value?.id ?? crypto.randomUUID();
    const file = form.get('image');
    const removeImage = checked(form, 'removeImage');
    let nextImage = removeImage ? '' : value?.image_url ?? '';
    let uploadedPath: string | null = null;
    if (file instanceof File && file.size > 0) {
      if (!imageTypes.has(file.type)) { setError('Formato de imagem não suportado. Use JPEG, PNG ou WebP.'); return; }
      if (file.size > 5 * 1024 * 1024) { setError('Imagem muito grande. O limite é 5 MB.'); return; }
      const extension = file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1];
      uploadedPath = `products/${productId}/${crypto.randomUUID()}.${extension}`;
      setSaving(true); setError(null); setNotice('Enviando imagem...');
      const storage = createClient().storage.from(IMAGE_BUCKET);
      const { error: uploadError } = await storage.upload(uploadedPath, file, { contentType: file.type, upsert: false });
      if (uploadError) { setSaving(false); setNotice(''); setError('Não foi possível enviar a imagem. Verifique sua sessão e tente novamente.'); return; }
      nextImage = storage.getPublicUrl(uploadedPath).data.publicUrl;
      setSaving(false);
    }
    const productType = (value?.product_type ?? str(form, 'productType')) as 'meal' | 'beverage';
    const input = { productType, name: str(form,'name'), description: str(form,'description'), price: productType === 'beverage' ? str(form,'price') : null, smallPrice: productType === 'meal' ? str(form,'smallPrice') : null, largePrice: productType === 'meal' ? str(form,'largePrice') : null, imageUrl: nextImage, active: checked(form,'active') };
    const result = await mutate(value ? updateProduct({ ...input, id: value.id, updatedAt: value.updated_at }) : createProduct({ ...input, id: productId }), productType === 'beverage');
    const storage = createClient().storage.from(IMAGE_BUCKET);
    if (!result?.data && uploadedPath) await storage.remove([uploadedPath]);
    if (result?.data) {
      const oldPath = storagePath(value?.image_url ?? null);
      if (oldPath && (removeImage || uploadedPath)) {
        const { error: removeError } = await storage.remove([oldPath]);
        if (removeError) setError('Produto salvo, mas a imagem anterior não pôde ser removida.');
      }
      if (productType === 'meal') {
        const availability = await mutate(updateAvailability({
          productId,
          availableToday: checked(form, 'availableToday'),
          soldOut: checked(form, 'availableToday') && checked(form, 'soldOut'),
          sortOrder: value?.availability?.sort_order ?? value?.sort_order ?? 0,
          updatedAt: value?.availability?.updated_at ?? null,
        }), true);
        if (!availability?.data) return;
      }
    }
  }
  if (!data) return <Card><p role="alert" className="text-red-700">{error ?? 'Cardápio indisponível.'}</p><Button onClick={() => void refresh()} className="mt-3">Tentar novamente</Button></Card>;
  const dateLabel = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' }).format(new Date(`${data.date}T12:00:00-03:00`));
  const library = data.products.filter(product => product.product_type === 'meal' && product.name.toLocaleLowerCase('pt-BR').includes(search.trim().toLocaleLowerCase('pt-BR')));
  const beverages = data.products.filter(product => product.product_type === 'beverage' && product.name.toLocaleLowerCase('pt-BR').includes(search.trim().toLocaleLowerCase('pt-BR')));
  const todayProducts = data.products.filter(product => product.active && product.product_type === 'meal' && product.availability?.available_today);
  const renderCard = (product: AdminMenuProduct, todayView: boolean) => {
    const daily = product.availability;
    const available = daily?.available_today ?? false;
    const soldOut = available && (daily?.sold_out ?? false);
    const setDaily = (availableToday: boolean, sold: boolean) => void mutate(updateAvailability({ productId: product.id, availableToday, soldOut: sold, sortOrder: daily?.sort_order ?? product.sort_order, updatedAt: daily?.updated_at ?? null }));
    const isMeal = product.product_type === 'meal';
    return <Card key={product.id} className="overflow-hidden p-0">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:p-5">
        <ProductImage product={product} className="aspect-[4/3] h-auto w-full sm:h-32 sm:w-40"/>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-black leading-tight text-stone-900">{product.name}</h3><Badge tone={product.active ? 'green' : 'stone'}>{product.active ? 'Ativo' : 'Inativo'}</Badge>{isMeal && available && <Badge tone={soldOut ? 'red' : 'blue'}>{soldOut ? 'Esgotado' : 'No cardápio de hoje'}</Badge>}</div>
          {isMeal && <p className="mt-1 text-xs font-bold text-emerald-800">Cliente verá: {product.public_name}</p>}
          {isMeal && <p className="mt-2 text-sm leading-relaxed text-stone-600">{product.description || 'Sem descrição.'}</p>}
          {isMeal ? <div className="mt-4 grid grid-cols-2 gap-3"><PriceBlock label="Pequena" cents={product.small_price_cents ?? product.price_cents}/><PriceBlock label="Grande" cents={product.large_price_cents ?? product.price_cents}/></div> : <div className="mt-4 inline-block min-w-40 rounded-2xl border border-emerald-100 bg-emerald-50/70 px-4 py-3"><span className="block text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-800">Preço</span><strong className="mt-1 block text-xl text-brand-700"><Money value={product.price_cents / 100}/></strong></div>}
        </div>
      </div>
      <div className="flex flex-col gap-2 border-t border-stone-100 bg-stone-50/70 p-3 sm:flex-row sm:flex-wrap sm:px-5">
        <button onClick={() => setModal({ kind: 'product', productType: product.product_type, value: product })} className="min-h-11 rounded-xl bg-white px-4 text-sm font-bold shadow-sm ring-1 ring-stone-200">Editar</button>
        {isMeal && !todayView && <button disabled={saving} onClick={() => setDaily(!available, false)} className={`min-h-11 rounded-xl px-4 text-sm font-bold disabled:opacity-50 ${available ? 'bg-orange-50 text-terracotta-700 ring-1 ring-orange-200' : 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200'}`}>{available ? 'Retirar de hoje' : 'Ativar hoje'}</button>}
        {isMeal && <button onClick={() => setModal({ kind: 'extras', value: product })} className="min-h-11 rounded-xl bg-white px-4 text-sm font-bold shadow-sm ring-1 ring-stone-200">Opções e adicionais ({product.addons.length})</button>}
        {isMeal && todayView && <button disabled={saving} aria-pressed={soldOut} onClick={() => setDaily(true, !soldOut)} className={`min-h-11 rounded-xl px-4 text-sm font-bold disabled:opacity-50 ${soldOut ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200' : 'bg-red-50 text-red-700 ring-1 ring-red-200'}`}>{soldOut ? 'Marcar disponível' : 'Marcar esgotado'}</button>}
      </div>
    </Card>;
  };
  return <div className="mx-auto max-w-5xl">
    <header className="rounded-3xl border border-emerald-950/10 bg-gradient-to-br from-brand-900 to-brand-700 p-5 text-white shadow-[0_18px_50px_rgba(24,74,55,0.16)] sm:p-7"><div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-100">Operação do dia</p><h1 className="mt-1 text-2xl font-black sm:text-3xl">Cardápio</h1><p className="mt-2 capitalize text-sm text-emerald-50">{dateLabel}</p></div><Button onClick={() => setModal({ kind: 'product', productType: view === 'beverages' ? 'beverage' : 'meal' })} className="w-full bg-white text-brand-900 hover:bg-orange-50 sm:w-auto">{view === 'beverages' ? '+ Adicionar bebida' : '+ Adicionar prato'}</Button></div></header>
    {error && <p role="alert" className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</p>}
    <p role="status" className="mt-3 min-h-5 text-sm font-semibold text-emerald-800">{saving ? 'Salvando alteração...' : notice}</p>
    <div className="mt-2 grid grid-cols-3 gap-1 rounded-2xl border border-stone-200 bg-white p-1.5 shadow-sm" role="tablist" aria-label="Seções do cardápio"><button role="tab" aria-selected={view === 'today'} onClick={() => { setView('today'); setSearch(''); }} className={`min-h-12 rounded-xl px-2 text-sm font-bold transition sm:text-base ${view === 'today' ? 'bg-brand-700 text-white shadow-sm' : 'text-stone-600 hover:bg-stone-50'}`}>Hoje</button><button role="tab" aria-selected={view === 'meals'} onClick={() => { setView('meals'); setSearch(''); }} className={`min-h-12 rounded-xl px-2 text-sm font-bold transition sm:text-base ${view === 'meals' ? 'bg-brand-700 text-white shadow-sm' : 'text-stone-600 hover:bg-stone-50'}`}>Pratos</button><button role="tab" aria-selected={view === 'beverages'} onClick={() => { setView('beverages'); setSearch(''); }} className={`min-h-12 rounded-xl px-2 text-sm font-bold transition sm:text-base ${view === 'beverages' ? 'bg-brand-700 text-white shadow-sm' : 'text-stone-600 hover:bg-stone-50'}`}>Bebidas</button></div>
    {view === 'today' ? <section className="mt-4"><div className="mb-4 flex flex-col gap-3 rounded-2xl border border-stone-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-black text-stone-900">Pratos disponíveis hoje</h2><p className="mt-1 text-sm text-stone-500">Gerencie a disponibilidade na aba Pratos. Aqui você pode marcar um item como esgotado.</p></div><button disabled={saving} onClick={() => void mutate(copyYesterdayMenu())} className="min-h-11 shrink-0 rounded-xl border border-emerald-200 bg-emerald-50 px-4 text-sm font-bold text-emerald-900 disabled:opacity-50">Copiar cardápio anterior</button></div><div className="space-y-4">{todayProducts.map(product => renderCard(product, true))}{todayProducts.length === 0 && <EmptyState title="Nenhum prato ativo hoje." description="Abra a aba Pratos para escolher o que será servido na data atual."/>}</div></section>
      : <section className="mt-4"><div className="mb-4 rounded-2xl border border-stone-200 bg-white p-3 shadow-sm"><input aria-label={view === 'beverages' ? 'Buscar bebidas' : 'Buscar pratos'} value={search} onChange={event => setSearch(event.target.value)} placeholder={view === 'beverages' ? 'Buscar bebida pelo nome' : 'Buscar prato pelo nome interno'} className="min-h-12 w-full rounded-xl border border-stone-200 bg-stone-50 px-4 outline-none transition focus:border-emerald-700 focus:bg-white focus:ring-2 focus:ring-emerald-100"/></div><div className="space-y-4">{(view === 'beverages' ? beverages : library).map(product => renderCard(product, false))}{(view === 'beverages' ? beverages : library).length === 0 && <EmptyState title={view === 'beverages' ? 'Nenhuma bebida encontrada.' : 'Nenhum prato encontrado.'} description={search ? 'Tente buscar por outro nome.' : `Use o botão acima para cadastrar ${view === 'beverages' ? 'a primeira bebida' : 'o primeiro prato'}.`}/>}</div></section>}
    {modal?.kind === 'product' && <ProductModal productType={modal.productType} value={modal.value} saving={saving} close={() => setModal(null)} submit={(form, value) => void saveProduct(form, value)} />}
    {modal?.kind === 'extras' && <ExtrasModal product={data.products.find(product => product.id === modal.value.id) ?? modal.value} saving={saving} close={() => setModal(null)} mutate={async operation => { await mutate(operation); }} />}
  </div>;
}
function Overlay({ title, close, children }: { title: string; close: () => void; children: ReactNode }) { return <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-30 grid place-items-center bg-emerald-950/55 p-3 backdrop-blur-sm sm:p-5"><Card className="max-h-[94dvh] w-full max-w-2xl overflow-y-auto p-4 sm:p-6"><div className="flex items-center justify-between border-b border-stone-100 pb-4"><h2 className="text-xl font-black text-stone-900">{title}</h2><button aria-label="Fechar" onClick={close} className="grid h-11 w-11 place-items-center rounded-full bg-stone-100 text-lg">✕</button></div>{children}</Card></div>; }
const field = 'mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100';
function ProductModal({ productType, value, saving, close, submit }: { productType: 'meal' | 'beverage'; value?: AdminMenuProduct; saving: boolean; close: () => void; submit: (form: FormData, value?: AdminMenuProduct) => void }) {
  const [preview, setPreview] = useState<string | null>(value?.image_url ?? null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  useEffect(() => () => { if (objectUrl) URL.revokeObjectURL(objectUrl); }, [objectUrl]);
  const isMeal = productType === 'meal';
  const image = useMemo(() => ({ name: value?.name || (isMeal ? 'Prévia do prato' : 'Prévia da bebida'), image_url: preview, product_type: productType }), [preview, value?.name, isMeal, productType]);
  return <Overlay title={value ? `Editar ${isMeal ? 'prato' : 'bebida'}` : `Nova ${isMeal ? 'refeição' : 'bebida'}`} close={close}>
    <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); submit(new FormData(event.currentTarget), value); }}>
      <input type="hidden" name="productType" value={productType}/>
      <div className="flex items-center gap-4 rounded-2xl bg-stone-50 p-3 sm:col-span-2"><ProductImage product={image} className="h-24 w-24"/><div><b>Imagem {isMeal ? 'do prato' : 'da bebida'}</b><p className="mt-1 text-xs text-stone-500">JPEG, PNG ou WebP · máximo 5 MB.</p></div></div>
      <label className="text-sm">{isMeal ? 'Identificação interna' : 'Nome da bebida'}<input name="name" defaultValue={value?.name} minLength={2} maxLength={120} required className={field}/>{isMeal && <span className="mt-1 block text-xs text-emerald-800">No cardápio público: Prato do dia</span>}</label>
      {isMeal && <label className="text-sm sm:col-span-2">Descrição<textarea name="description" defaultValue={value?.description ?? ''} maxLength={500} rows={3} className={field}/></label>}
      {isMeal ? <><label className="text-sm">Preço pequeno (R$)<input name="smallPrice" inputMode="decimal" defaultValue={value ? ((value.small_price_cents ?? value.price_cents) / 100).toFixed(2).replace('.', ',') : ''} required placeholder="0,00" className={field}/></label><label className="text-sm">Preço grande (R$)<input name="largePrice" inputMode="decimal" defaultValue={value ? ((value.large_price_cents ?? value.price_cents) / 100).toFixed(2).replace('.', ',') : ''} required placeholder="0,00" className={field}/></label></> : <label className="text-sm sm:col-span-2">Preço (R$)<input name="price" inputMode="decimal" defaultValue={value ? (value.price_cents / 100).toFixed(2).replace('.', ',') : ''} required placeholder="0,00" className={field}/></label>}
      <label className="cursor-pointer rounded-xl border border-dashed border-emerald-300 bg-emerald-50/50 p-4 text-center text-sm font-bold text-emerald-900 sm:col-span-2">Escolher imagem<input name="image" type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={event => { const file = event.target.files?.[0]; if (!file) return; if (objectUrl) URL.revokeObjectURL(objectUrl); const url = URL.createObjectURL(file); setObjectUrl(url); setPreview(url); }}/></label>
      {value?.image_url && <label className="flex min-h-11 items-center gap-2 rounded-xl border p-3 text-sm sm:col-span-2"><input name="removeImage" type="checkbox" onChange={event => setPreview(event.target.checked ? null : objectUrl ?? value.image_url)}/> Remover imagem atual</label>}
      {isMeal && <><label className="flex min-h-12 items-center gap-3 rounded-xl border p-3 text-sm"><input name="availableToday" type="checkbox" defaultChecked={value?.availability?.available_today ?? false} className="h-5 w-5 accent-brand-600"/> Disponível hoje</label><label className="flex min-h-12 items-center gap-3 rounded-xl border p-3 text-sm"><input name="soldOut" type="checkbox" defaultChecked={value?.availability?.sold_out ?? false} className="h-5 w-5 accent-terracotta-500"/> Esgotado</label></>}
      <label className="flex min-h-11 items-center gap-2"><input name="active" type="checkbox" defaultChecked={value?.active ?? true}/> Ativo na biblioteca</label>
      <Button disabled={saving} type="submit">{saving ? 'Salvando...' : `Salvar ${isMeal ? 'prato' : 'bebida'}`}</Button>
    </form>
  </Overlay>;
}

function ExtrasModal({ product, saving, close, mutate }: { product: AdminMenuProduct; saving: boolean; close: () => void; mutate: (operation: Promise<MenuMutationResult>) => Promise<void> }) {
  const submitOption = (event: FormEvent<HTMLFormElement>, option?: AdminMenuOption) => { event.preventDefault(); const form = new FormData(event.currentTarget); const input = { productId: product.id, name: str(form,'name'), required: checked(form,'required'), minChoices: num(form,'minChoices'), maxChoices: num(form,'maxChoices') }; void mutate(option ? updateOption({ ...input, id: option.id, updatedAt: option.updated_at }) : createOption(input)); };
  const submitAddon = (event: FormEvent<HTMLFormElement>, addon?: AdminMenuAddon) => { event.preventDefault(); const form = new FormData(event.currentTarget); const optionId = str(form,'optionId') || null; const input = { productId: product.id, optionId, name: str(form,'name'), price: str(form,'price'), active: checked(form,'active') }; void mutate(addon ? updateAddon({ ...input, id: addon.id, updatedAt: addon.updated_at }) : createAddon(input)); };
  return <Overlay title={`Opções e adicionais · ${product.name}`} close={close}><section className="mt-4"><h3 className="font-bold">Grupos de opções</h3><div className="mt-2 space-y-3">{product.options.map(option => <OptionForm key={option.id} option={option} saving={saving} submit={submitOption}/>)}<OptionForm saving={saving} submit={submitOption}/></div></section><section className="mt-6 border-t pt-4"><h3 className="font-bold">Adicionais</h3><div className="mt-2 space-y-3">{product.addons.map(addon => <AddonForm key={addon.id} addon={addon} options={product.options} saving={saving} submit={submitAddon}/>)}<AddonForm options={product.options} saving={saving} submit={submitAddon}/></div></section></Overlay>;
}
function OptionForm({ option, saving, submit }: { option?: AdminMenuOption; saving: boolean; submit: (event: FormEvent<HTMLFormElement>, option?: AdminMenuOption) => void }) { return <form onSubmit={event => submit(event, option)} className="grid gap-2 rounded-xl border p-3 sm:grid-cols-5"><input aria-label="Nome da opção" name="name" defaultValue={option?.name} placeholder="Nome do grupo" required className={`${field} sm:col-span-2`}/><input aria-label="Mínimo" name="minChoices" type="number" min="0" defaultValue={option?.min_choices ?? 0} required className={field}/><input aria-label="Máximo" name="maxChoices" type="number" min="0" defaultValue={option?.max_choices ?? 1} required className={field}/><label className="flex items-center gap-1 text-sm"><input name="required" type="checkbox" defaultChecked={option?.required}/> Obrigatório</label><Button disabled={saving} type="submit" className="sm:col-span-5">{option ? 'Atualizar opção' : '+ Criar opção'}</Button></form>; }
function AddonForm({ addon, options, saving, submit }: { addon?: AdminMenuAddon; options: AdminMenuOption[]; saving: boolean; submit: (event: FormEvent<HTMLFormElement>, addon?: AdminMenuAddon) => void }) { return <form onSubmit={event => submit(event, addon)} className="grid gap-2 rounded-xl border p-3 sm:grid-cols-4"><input aria-label="Nome do adicional" name="name" defaultValue={addon?.name} placeholder="Nome" required className={field}/><select aria-label="Grupo do adicional" name="optionId" defaultValue={addon?.option_id ?? ''} className={field}><option value="">Sem grupo</option>{options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</select><input aria-label="Preço do adicional em reais" name="price" inputMode="decimal" defaultValue={addon ? (addon.price_cents / 100).toFixed(2).replace('.', ',') : '0,00'} required className={field}/><label className="flex items-center gap-1 text-sm"><input name="active" type="checkbox" defaultChecked={addon?.active ?? true}/> Ativo</label><Button disabled={saving} type="submit" className="sm:col-span-4">{addon ? 'Atualizar adicional' : '+ Criar adicional'}</Button></form>; }
