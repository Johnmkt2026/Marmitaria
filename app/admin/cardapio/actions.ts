'use server';

import { z } from 'zod';
import { AdminAccessError, requireAdminClient } from '@/lib/admin-orders';
import { getAdminMenu } from '@/lib/admin-menu';
import type { AdminMenuResult, MenuMutationResult } from '@/lib/admin-menu-types';

const id = z.string().uuid();
const version = z.string().datetime({ offset: true });
const name = z.string().trim().min(2).max(120);
const order = z.number().int().min(-32768).max(32767);
function toCents(value: string) {
  const [whole, fraction = ''] = value.replace(',', '.').split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
const price = z.string().trim().regex(/^\d{1,8}([,.]\d{1,2})?$/, 'Informe um preço válido.').transform(toCents).refine(value => value <= 2147483647, 'Preço excede o limite.');
const categoryCreate = z.object({ name: name.max(80) });
const categoryUpdate = categoryCreate.extend({ id, active: z.boolean(), updatedAt: version });
const productCreate = z.object({
  id, productType: z.enum(['meal', 'beverage']), name,
  description: z.string().trim().max(500), price: price.nullable(), smallPrice: price.nullable(), largePrice: price.nullable(),
  imageUrl: z.string().trim().max(500), active: z.boolean(),
});
const productUpdate = productCreate.extend({ id, updatedAt: version });
const availabilitySchema = z.object({ productId: id, availableToday: z.boolean(), soldOut: z.boolean(), sortOrder: order, updatedAt: version.nullable() });
const optionBase = z.object({ productId: id, name, required: z.boolean(), minChoices: z.number().int().min(0).max(100), maxChoices: z.number().int().min(0).max(100) });
const optionCreate = optionBase.refine(value => value.maxChoices >= value.minChoices, 'Máximo deve ser maior ou igual ao mínimo.');
const optionUpdate = optionBase.extend({ id, updatedAt: version }).refine(value => value.maxChoices >= value.minChoices, 'Máximo deve ser maior ou igual ao mínimo.');
const addonCreate = z.object({ productId: id, optionId: id.nullable(), name, price: price, active: z.boolean() });
const addonUpdate = addonCreate.extend({ id, updatedAt: version });

function failure(error: unknown): MenuMutationResult {
  if (error instanceof AdminAccessError) return { error: error.message, unauthorized: true };
  return { error: 'Não foi possível salvar a alteração.' };
}
function dbError(code?: string): MenuMutationResult {
  return { error: code === '23505' ? 'Já existe um registro com esses dados.' : code === '23503' || code === '23514' ? 'Os dados informados são incompatíveis.' : 'Não foi possível salvar a alteração.' };
}

export async function loadAdminMenu(): Promise<AdminMenuResult> {
  try { return { data: await getAdminMenu() }; }
  catch (error) { return error instanceof AdminAccessError ? { error: error.message, unauthorized: true } : { error: 'Não foi possível carregar o cardápio.' }; }
}

export async function createCategory(input: unknown): Promise<MenuMutationResult> {
  const parsed = categoryCreate.safeParse(input); if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Categoria inválida.' };
  try { const db = await requireAdminClient(); const { data: last } = await db.from('categories').select('sort_order').order('sort_order', { ascending: false }).limit(1).maybeSingle(); const { error } = await db.from('categories').insert({ name: parsed.data.name, sort_order: (last?.sort_order ?? -1) + 1 }); if (error) return dbError(error.code); return { data: { message: 'Categoria criada.' } }; } catch (error) { return failure(error); }
}

export async function updateCategory(input: unknown): Promise<MenuMutationResult> {
  const parsed = categoryUpdate.safeParse(input); if (!parsed.success) return { error: 'Categoria inválida.' };
  try { const db = await requireAdminClient(); const value = parsed.data; const { data, error } = await db.from('categories').update({ name: value.name, active: value.active }).eq('id', value.id).eq('updated_at', value.updatedAt).select('id').maybeSingle(); if (error) return dbError(error.code); if (!data) return { error: 'Categoria alterada por outro administrador.', conflict: true }; return { data: { message: 'Categoria atualizada.' } }; } catch (error) { return failure(error); }
}

async function nextProductOrder(db: Awaited<ReturnType<typeof requireAdminClient>>) { const { data } = await db.from('products').select('sort_order').order('sort_order', { ascending: false }).limit(1).maybeSingle(); return (data?.sort_order ?? -1) + 1; }
async function technicalCategory(db: Awaited<ReturnType<typeof requireAdminClient>>, name: 'Pratos do dia' | 'Bebidas') {
  const find = async () => {
    const { data, error } = await db.from('categories').select('id,name,active');
    if (error) throw error;
    return data?.find(category => category.name.trim().toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR')) ?? null;
  };
  const existing = await find();
  if (existing) {
    if (!existing.active) {
      const { error } = await db.from('categories').update({ active: true }).eq('id', existing.id);
      if (error) throw error;
    }
    return existing.id;
  }
  const { data: last } = await db.from('categories').select('sort_order').order('sort_order', { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await db.from('categories').insert({ name, sort_order: (last?.sort_order ?? -1) + 1 }).select('id').single();
  if (error?.code === '23505') return (await find())?.id ?? null;
  if (error) throw error;
  return data.id;
}
export async function createProduct(input: unknown): Promise<MenuMutationResult> {
  const parsed = productCreate.safeParse(input); if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Produto inválido.' };
  if (parsed.data.productType === 'meal' && (parsed.data.smallPrice === null || parsed.data.largePrice === null)) return { error: 'Informe os preços Pequena e Grande.' };
  if (parsed.data.productType === 'beverage' && parsed.data.price === null) return { error: 'Informe o preço da bebida.' };
  try { const db = await requireAdminClient(); const value = parsed.data; const categoryId = await technicalCategory(db, value.productType === 'meal' ? 'Pratos do dia' : 'Bebidas'); if (!categoryId) return { error: 'Não foi possível preparar o catálogo.' }; const basePrice = value.productType === 'meal' ? value.smallPrice! : value.price!; const { error } = await db.from('products').insert({ id: value.id, category_id: categoryId, name: value.name, public_name: value.productType === 'meal' ? 'Prato do dia' : value.name, product_type: value.productType, description: value.productType === 'meal' ? value.description || null : null, price_cents: basePrice, small_price_cents: value.productType === 'meal' ? value.smallPrice : null, large_price_cents: value.productType === 'meal' ? value.largePrice : null, image_url: value.productType === 'meal' ? value.imageUrl || null : null, sort_order: await nextProductOrder(db), active: value.active }); if (error) return dbError(error.code); return { data: { message: value.productType === 'meal' ? 'Prato criado.' : 'Bebida criada.' } }; } catch (error) { return failure(error); }
}
export async function updateProduct(input: unknown): Promise<MenuMutationResult> {
  const parsed = productUpdate.safeParse(input); if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Produto inválido.' };
  if (parsed.data.productType === 'meal' && (parsed.data.smallPrice === null || parsed.data.largePrice === null)) return { error: 'Informe os preços Pequena e Grande.' };
  if (parsed.data.productType === 'beverage' && parsed.data.price === null) return { error: 'Informe o preço da bebida.' };
  try { const db = await requireAdminClient(); const value = parsed.data; const { data: current } = await db.from('products').select('product_type').eq('id', value.id).maybeSingle(); if (!current || current.product_type !== value.productType) return { error: 'O tipo do produto não pode ser alterado.' }; const categoryId = await technicalCategory(db, value.productType === 'meal' ? 'Pratos do dia' : 'Bebidas'); if (!categoryId) return { error: 'Não foi possível preparar o catálogo.' }; const basePrice = value.productType === 'meal' ? value.smallPrice! : value.price!; const { data, error } = await db.from('products').update({ category_id: categoryId, name: value.name, public_name: value.productType === 'meal' ? 'Prato do dia' : value.name, description: value.productType === 'meal' ? value.description || null : null, price_cents: basePrice, small_price_cents: value.productType === 'meal' ? value.smallPrice : null, large_price_cents: value.productType === 'meal' ? value.largePrice : null, image_url: value.productType === 'meal' ? value.imageUrl || null : null, active: value.active }).eq('id', value.id).eq('updated_at', value.updatedAt).select('id').maybeSingle(); if (error) return dbError(error.code); if (!data) return { error: 'Produto alterado por outro administrador.', conflict: true }; return { data: { message: value.productType === 'meal' ? 'Prato atualizado.' : 'Bebida atualizada.' } }; } catch (error) { return failure(error); }
}

export async function updateAvailability(input: unknown): Promise<MenuMutationResult> {
  const parsed = availabilitySchema.safeParse(input); if (!parsed.success) return { error: 'Disponibilidade inválida.' };
  try { const db = await requireAdminClient(); const value = parsed.data; const { data: today, error: dateError } = await db.rpc('menu_date'); if (dateError || typeof today !== 'string') return { error: 'Data comercial indisponível.' }; if (value.updatedAt) { const { data, error } = await db.from('product_daily_availability').update({ available_today: value.availableToday, sold_out: value.soldOut, sort_order: value.sortOrder }).eq('product_id', value.productId).eq('date', today).eq('updated_at', value.updatedAt).select('id').maybeSingle(); if (error) return dbError(error.code); if (!data) return { error: 'Disponibilidade alterada por outro administrador.', conflict: true }; } else { const { error } = await db.from('product_daily_availability').insert({ product_id: value.productId, date: today, available_today: value.availableToday, sold_out: value.soldOut, sort_order: value.sortOrder }); if (error) return dbError(error.code); } return { data: { message: 'Disponibilidade atualizada.' } }; } catch (error) { return failure(error); }
}

export async function copyYesterdayMenu(): Promise<MenuMutationResult> {
  try {
    const db = await requireAdminClient();
    const { data: today, error: dateError } = await db.rpc('menu_date');
    if (dateError || typeof today !== 'string') return { error: 'Data comercial indisponível.' };
    const yesterday = new Date(`${today}T12:00:00-03:00`);
    yesterday.setDate(yesterday.getDate() - 1);
    const sourceDate = yesterday.toISOString().slice(0, 10);
    const { data: source, error: sourceError } = await db.from('product_daily_availability')
      .select('product_id,sort_order').eq('date', sourceDate).eq('available_today', true);
    if (sourceError) return { error: 'Não foi possível consultar o cardápio de ontem.' };
    if (!source?.length) return { error: 'Ontem não houve pratos disponíveis para copiar.' };
    const { error } = await db.from('product_daily_availability').upsert(
      source.map(item => ({ product_id: item.product_id, date: today, available_today: true, sold_out: false, sort_order: item.sort_order })),
      { onConflict: 'product_id,date' },
    );
    if (error) return dbError(error.code);
    return { data: { message: `${source.length} prato(s) copiado(s) de ontem.` } };
  } catch (error) { return failure(error); }
}

async function mealExists(db: Awaited<ReturnType<typeof requireAdminClient>>, productId: string) { const { data } = await db.from('products').select('id').eq('id', productId).eq('product_type', 'meal').maybeSingle(); return !!data; }
export async function createOption(input: unknown): Promise<MenuMutationResult> {
  const parsed = optionCreate.safeParse(input); if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Opção inválida.' };
  try { const db = await requireAdminClient(); const value = parsed.data; if (!await mealExists(db, value.productId)) return { error: 'Apenas refeições aceitam opções.' }; const { error } = await db.from('product_options').insert({ product_id: value.productId, name: value.name, required: value.required, min_choices: value.minChoices, max_choices: value.maxChoices }); if (error) return dbError(error.code); return { data: { message: 'Opção criada.' } }; } catch (error) { return failure(error); }
}
export async function updateOption(input: unknown): Promise<MenuMutationResult> {
  const parsed = optionUpdate.safeParse(input); if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Opção inválida.' };
  try { const db = await requireAdminClient(); const value = parsed.data; if (!await mealExists(db, value.productId)) return { error: 'Apenas refeições aceitam opções.' }; const { data, error } = await db.from('product_options').update({ name: value.name, required: value.required, min_choices: value.minChoices, max_choices: value.maxChoices }).eq('id', value.id).eq('product_id', value.productId).eq('updated_at', value.updatedAt).select('id').maybeSingle(); if (error) return dbError(error.code); if (!data) return { error: 'Opção alterada por outro administrador.', conflict: true }; return { data: { message: 'Opção atualizada.' } }; } catch (error) { return failure(error); }
}

async function optionBelongs(db: Awaited<ReturnType<typeof requireAdminClient>>, optionId: string | null, productId: string) { if (!optionId) return true; const { data } = await db.from('product_options').select('id').eq('id', optionId).eq('product_id', productId).maybeSingle(); return !!data; }
export async function createAddon(input: unknown): Promise<MenuMutationResult> {
  const parsed = addonCreate.safeParse(input); if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Adicional inválido.' };
  try { const db = await requireAdminClient(); const value = parsed.data; if (!await mealExists(db, value.productId) || !await optionBelongs(db, value.optionId, value.productId)) return { error: 'Apenas refeições aceitam adicionais compatíveis.' }; const { data: last } = await db.from('product_addons').select('sort_order').eq('product_id', value.productId).order('sort_order', { ascending: false }).limit(1).maybeSingle(); const { error } = await db.from('product_addons').insert({ product_id: value.productId, option_id: value.optionId, name: value.name, price_cents: value.price, active: value.active, sort_order: (last?.sort_order ?? -1) + 1 }); if (error) return dbError(error.code); return { data: { message: 'Adicional criado.' } }; } catch (error) { return failure(error); }
}
export async function updateAddon(input: unknown): Promise<MenuMutationResult> {
  const parsed = addonUpdate.safeParse(input); if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Adicional inválido.' };
  try { const db = await requireAdminClient(); const value = parsed.data; if (!await mealExists(db, value.productId) || !await optionBelongs(db, value.optionId, value.productId)) return { error: 'Opção não pertence a uma refeição compatível.' }; const { data, error } = await db.from('product_addons').update({ option_id: value.optionId, name: value.name, price_cents: value.price, active: value.active }).eq('id', value.id).eq('product_id', value.productId).eq('updated_at', value.updatedAt).select('id').maybeSingle(); if (error) return dbError(error.code); if (!data) return { error: 'Adicional alterado por outro administrador.', conflict: true }; return { data: { message: 'Adicional atualizado.' } }; } catch (error) { return failure(error); }
}
