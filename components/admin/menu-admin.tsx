'use client';

import Image from 'next/image';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { copyYesterdayMenu, createAddon, createCategory, createOption, createProduct, loadAdminMenu, updateAddon, updateAvailability, updateCategory, updateOption, updateProduct } from '@/app/admin/cardapio/actions';
import type { AdminMenuAddon, AdminMenuCategory, AdminMenuData, AdminMenuOption, AdminMenuProduct, AdminMenuResult, MenuMutationResult } from '@/lib/admin-menu-types';
import { createClient } from '@/lib/supabase/client';
import { Button, Card, Money } from '@/components/ui';

type Modal = { kind: 'category'; value?: AdminMenuCategory } | { kind: 'product'; productType: 'meal' | 'beverage'; value?: AdminMenuProduct } | { kind: 'extras'; value: AdminMenuProduct };
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
function ProductImage({ product, className = 'h-20 w-20' }: { product: Pick<AdminMenuProduct, 'name' | 'image_url'>; className?: string }) {
  return <div className={`${className} grid shrink-0 place-items-center overflow-hidden rounded-2xl bg-terracotta-100 text-3xl`}>
    {product.image_url && /^(https?:\/\/|\/)/.test(product.image_url)
      ? <Image src={product.image_url} alt={product.name} width={160} height={160} unoptimized className="h-full w-full object-cover" />
      : <span aria-hidden="true">{product.image_url || '🍲'}</span>}
  </div>;
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
    const input = { productType, categoryId: productType === 'meal' ? str(form,'categoryId') : null, name: str(form,'name'), description: str(form,'description'), price: productType === 'beverage' ? str(form,'price') : null, smallPrice: productType === 'meal' ? str(form,'smallPrice') : null, largePrice: productType === 'meal' ? str(form,'largePrice') : null, imageUrl: nextImage, active: checked(form,'active') };
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
  const categoryName = new Map(data.categories.map(category => [category.id, category.name]));
  const dateLabel = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' }).format(new Date(`${data.date}T12:00:00-03:00`));
  const library = data.products.filter(product => product.product_type === 'meal' && product.name.toLocaleLowerCase('pt-BR').includes(search.trim().toLocaleLowerCase('pt-BR')));
  const beverages = data.products.filter(product => product.product_type === 'beverage' && product.name.toLocaleLowerCase('pt-BR').includes(search.trim().toLocaleLowerCase('pt-BR')));
  const todayProducts = data.products.filter(product => product.active && product.product_type === 'meal');
  const renderCard = (product: AdminMenuProduct, showDaily: boolean) => {
    const daily = product.availability;
    const available = daily?.available_today ?? false;
    const soldOut = available && (daily?.sold_out ?? false);
    const setDaily = (availableToday: boolean, sold: boolean) => void mutate(updateAvailability({ productId: product.id, availableToday, soldOut: sold, sortOrder: daily?.sort_order ?? product.sort_order, updatedAt: daily?.updated_at ?? null }));
    return <Card key={product.id} className="p-4"><div className="flex gap-3"><ProductImage product={product}/><div className="min-w-0 flex-1"><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-black leading-tight">{product.name}</h3>{product.product_type === 'meal' && <p className="mt-1 text-xs font-semibold text-emerald-800">Cliente verá: {product.public_name}</p>}<p className="mt-1 line-clamp-2 text-sm text-stone-600">{product.description || (product.product_type === 'beverage' ? 'Bebida' : 'Sem descrição.')}</p></div><div className="text-right text-sm font-bold text-brand-700">{product.product_type === 'meal' ? <><div>P <Money value={(product.small_price_cents ?? product.price_cents) / 100}/></div><div>G <Money value={(product.large_price_cents ?? product.price_cents) / 100}/></div></> : <Money value={product.price_cents / 100}/>}</div></div><p className="mt-2 text-xs text-stone-500">{product.product_type === 'meal' ? categoryName.get(product.category_id) ?? 'Sem categoria' : product.active ? 'Ativa' : 'Inativa'}</p></div></div>
      {showDaily && <div className="mt-4 grid gap-2 sm:grid-cols-2"><button type="button" disabled={saving} aria-pressed={available} onClick={() => setDaily(!available, false)} className={`min-h-12 rounded-xl border px-3 py-2 text-left text-sm font-bold ${available ? 'border-emerald-400 bg-emerald-50 text-emerald-800' : 'bg-white text-stone-700'}`}><span className="float-right">{available ? 'ON' : 'OFF'}</span>Disponível hoje</button><button type="button" disabled={saving || !available} aria-pressed={soldOut} onClick={() => setDaily(true, !soldOut)} className={`min-h-12 rounded-xl border px-3 py-2 text-left text-sm font-bold ${soldOut ? 'border-red-400 bg-red-50 text-red-700' : 'bg-white text-stone-700'}`}><span className="float-right">{soldOut ? 'ON' : 'OFF'}</span>Esgotado</button></div>}
      <div className="mt-3 flex flex-wrap gap-2"><button onClick={() => setModal({ kind: 'product', productType: product.product_type, value: product })} className="min-h-11 rounded-xl bg-stone-100 px-4 text-sm font-bold">Editar</button>{product.product_type === 'meal' && <button onClick={() => setModal({ kind: 'extras', value: product })} className="min-h-11 rounded-xl bg-stone-100 px-4 text-sm font-bold">Opções e adicionais ({product.addons.length})</button>}{!showDaily && <button disabled={saving} onClick={() => setDaily(!available, false)} className="min-h-11 rounded-xl border px-4 text-sm font-bold">{available ? 'Retirar de hoje' : 'Ativar hoje'}</button>}</div></Card>;
  };
  return <>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-black">Cardápio</h1><p className="mt-1 capitalize text-stone-600">{dateLabel}</p></div><Button onClick={() => setModal({ kind: 'product', productType: view === 'beverages' ? 'beverage' : 'meal' })}>{view === 'beverages' ? '+ Adicionar bebida' : '+ Adicionar prato'}</Button></div>
    {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <p role="status" className="mt-3 min-h-5 text-sm text-green-700">{saving ? 'Salvando...' : notice}</p>
    <div className="mt-3 grid grid-cols-3 rounded-2xl bg-stone-100 p-1"><button onClick={() => setView('today')} className={`min-h-12 rounded-xl font-bold ${view === 'today' ? 'bg-white shadow-sm' : ''}`}>Hoje</button><button onClick={() => setView('meals')} className={`min-h-12 rounded-xl font-bold ${view === 'meals' ? 'bg-white shadow-sm' : ''}`}>Pratos</button><button onClick={() => setView('beverages')} className={`min-h-12 rounded-xl font-bold ${view === 'beverages' ? 'bg-white shadow-sm' : ''}`}>Bebidas</button></div>
    {view === 'today' ? <section className="mt-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-black">Seleção da data</h2><p className="text-sm text-stone-500">Ative os pratos que serão vendidos hoje. Esgotados continuam visíveis no público.</p></div><button disabled={saving} onClick={() => void mutate(copyYesterdayMenu())} className="min-h-11 rounded-xl border px-4 text-sm font-bold">Copiar cardápio de ontem</button></div><div className="grid gap-4 lg:grid-cols-2">{todayProducts.map(product => renderCard(product, true))}{todayProducts.length === 0 && <Card><p className="text-stone-500">Nenhum prato ativo na biblioteca.</p></Card>}</div></section>
      : <section className="mt-5"><div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><input aria-label={view === 'beverages' ? 'Buscar bebidas' : 'Buscar pratos'} value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar pelo nome" className="min-h-12 w-full rounded-xl border px-4 sm:max-w-sm"/>{view === 'meals' && <button onClick={() => setModal({ kind: 'category' })} className="min-h-11 rounded-xl border px-4 text-sm font-bold">+ Categoria</button>}</div>{view === 'meals' && <div className="mb-4 flex flex-wrap gap-2">{data.categories.filter(category => category.name.toLocaleLowerCase('pt-BR') !== 'bebidas').map(category => <button key={category.id} onClick={() => setModal({ kind: 'category', value: category })} className="min-h-10 rounded-full border bg-white px-4 text-sm"><b>{category.name}</b> · {category.active ? 'ativa' : 'inativa'}</button>)}</div>}<div className="grid gap-4 lg:grid-cols-2">{(view === 'beverages' ? beverages : library).map(product => renderCard(product, false))}{(view === 'beverages' ? beverages : library).length === 0 && <Card><p className="text-stone-500">Nenhum item encontrado.</p></Card>}</div></section>}
    {modal?.kind === 'category' && <CategoryModal value={modal.value} saving={saving} close={() => setModal(null)} submit={(form, value) => void mutate(value ? updateCategory({ id: value.id, name: str(form,'name'), active: checked(form,'active'), updatedAt: value.updated_at }) : createCategory({ name: str(form,'name') }), true)} />}
    {modal?.kind === 'product' && <ProductModal productType={modal.productType} value={modal.value} categories={data.categories} saving={saving} close={() => setModal(null)} submit={(form, value) => void saveProduct(form, value)} />}
    {modal?.kind === 'extras' && <ExtrasModal product={data.products.find(product => product.id === modal.value.id) ?? modal.value} saving={saving} close={() => setModal(null)} mutate={async operation => { await mutate(operation); }} />}
  </>;
}
function Overlay({ title, close, children }: { title: string; close: () => void; children: ReactNode }) { return <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-30 grid place-items-center bg-black/40 p-4"><Card className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto"><div className="flex justify-between"><h2 className="text-lg font-black">{title}</h2><button aria-label="Fechar" onClick={close}>✕</button></div>{children}</Card></div>; }
const field = 'w-full rounded-xl border p-2';
function CategoryModal({ value, saving, close, submit }: { value?: AdminMenuCategory; saving: boolean; close: () => void; submit: (form: FormData, value?: AdminMenuCategory) => void }) { return <Overlay title={value ? 'Editar categoria' : 'Nova categoria'} close={close}><form className="mt-4 space-y-3" onSubmit={event => { event.preventDefault(); submit(new FormData(event.currentTarget), value); }}><label className="block text-sm font-semibold">Nome<input name="name" defaultValue={value?.name} required minLength={2} maxLength={80} className={field}/></label>{value && <label className="flex min-h-11 items-center gap-2"><input name="active" type="checkbox" defaultChecked={value.active}/> Categoria ativa</label>}<Button disabled={saving} type="submit">Salvar categoria</Button></form></Overlay>; }
function ProductModal({ productType, value, categories, saving, close, submit }: { productType: 'meal' | 'beverage'; value?: AdminMenuProduct; categories: AdminMenuCategory[]; saving: boolean; close: () => void; submit: (form: FormData, value?: AdminMenuProduct) => void }) {
  const [preview, setPreview] = useState<string | null>(value?.image_url ?? null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  useEffect(() => () => { if (objectUrl) URL.revokeObjectURL(objectUrl); }, [objectUrl]);
  const image = useMemo(() => ({ name: value?.name || 'Prévia do prato', image_url: preview }), [preview, value?.name]);
  const mealCategories = categories.filter(category => category.name.toLocaleLowerCase('pt-BR') !== 'bebidas');
  const isMeal = productType === 'meal';
  return <Overlay title={value ? `Editar ${isMeal ? 'prato' : 'bebida'}` : `Nova ${isMeal ? 'refeição' : 'bebida'}`} close={close}>
    <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); submit(new FormData(event.currentTarget), value); }}>
      <input type="hidden" name="productType" value={productType}/>
      {isMeal && <div className="flex items-center gap-4 sm:col-span-2"><ProductImage product={image} className="h-28 w-28"/><div><b>Imagem do prato</b><p className="mt-1 text-xs text-stone-500">JPEG, PNG ou WebP · máximo 5 MB.</p></div></div>}
      <label className="text-sm">{isMeal ? 'Identificação interna' : 'Nome da bebida'}<input name="name" defaultValue={value?.name} minLength={2} maxLength={120} required className={field}/>{isMeal && <span className="mt-1 block text-xs text-emerald-800">No cardápio público: Prato do dia</span>}</label>
      {isMeal && <label className="text-sm">Categoria<select name="categoryId" defaultValue={value?.category_id} required className={field}>{mealCategories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>}
      {isMeal && <label className="text-sm sm:col-span-2">Descrição<textarea name="description" defaultValue={value?.description ?? ''} maxLength={500} rows={3} className={field}/></label>}
      {isMeal ? <><label className="text-sm">Preço pequeno (R$)<input name="smallPrice" inputMode="decimal" defaultValue={value ? ((value.small_price_cents ?? value.price_cents) / 100).toFixed(2).replace('.', ',') : ''} required placeholder="0,00" className={field}/></label><label className="text-sm">Preço grande (R$)<input name="largePrice" inputMode="decimal" defaultValue={value ? ((value.large_price_cents ?? value.price_cents) / 100).toFixed(2).replace('.', ',') : ''} required placeholder="0,00" className={field}/></label></> : <label className="text-sm sm:col-span-2">Preço (R$)<input name="price" inputMode="decimal" defaultValue={value ? (value.price_cents / 100).toFixed(2).replace('.', ',') : ''} required placeholder="0,00" className={field}/></label>}
      {isMeal && <label className="cursor-pointer rounded-xl border border-dashed border-emerald-300 bg-emerald-50/50 p-4 text-center text-sm font-bold text-emerald-900 sm:col-span-2">Escolher imagem<input name="image" type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={event => { const file = event.target.files?.[0]; if (!file) return; if (objectUrl) URL.revokeObjectURL(objectUrl); const url = URL.createObjectURL(file); setObjectUrl(url); setPreview(url); }}/></label>}
      {isMeal && value?.image_url && <label className="flex min-h-11 items-center gap-2 rounded-xl border p-3 text-sm sm:col-span-2"><input name="removeImage" type="checkbox" onChange={event => setPreview(event.target.checked ? null : objectUrl ?? value.image_url)}/> Remover imagem atual</label>}
      {isMeal && <><label className="flex min-h-12 items-center gap-3 rounded-xl border p-3 text-sm"><input name="availableToday" type="checkbox" defaultChecked={value?.availability?.available_today ?? false} className="h-5 w-5 accent-brand-600"/> Disponível hoje</label><label className="flex min-h-12 items-center gap-3 rounded-xl border p-3 text-sm"><input name="soldOut" type="checkbox" defaultChecked={value?.availability?.sold_out ?? false} className="h-5 w-5 accent-terracotta-500"/> Esgotado</label></>}
      <label className="flex min-h-11 items-center gap-2"><input name="active" type="checkbox" defaultChecked={value?.active ?? true}/> Ativo na biblioteca</label>
      <Button disabled={saving || (isMeal && mealCategories.length === 0)} type="submit">{saving ? 'Salvando...' : `Salvar ${isMeal ? 'prato' : 'bebida'}`}</Button>
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
