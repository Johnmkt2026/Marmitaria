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
const categoryCreate = z.object({ name: name.max(80), sortOrder: order });
const categoryUpdate = categoryCreate.extend({ id, active: z.boolean(), updatedAt: version });
const productCreate = z.object({ categoryId: id, name, description: z.string().trim().max(500), price: price, imageUrl: z.string().trim().max(500), sortOrder: order, active: z.boolean() });
const productUpdate = productCreate.extend({ id, updatedAt: version });
const availabilitySchema = z.object({ productId: id, availableToday: z.boolean(), soldOut: z.boolean(), sortOrder: order, updatedAt: version.nullable() });
const optionBase = z.object({ productId: id, name, required: z.boolean(), minChoices: z.number().int().min(0).max(100), maxChoices: z.number().int().min(0).max(100) });
const optionCreate = optionBase.refine(value => value.maxChoices >= value.minChoices, 'Máximo deve ser maior ou igual ao mínimo.');
const optionUpdate = optionBase.extend({ id, updatedAt: version }).refine(value => value.maxChoices >= value.minChoices, 'Máximo deve ser maior ou igual ao mínimo.');
const addonCreate = z.object({ productId: id, optionId: id.nullable(), name, price: price, active: z.boolean(), sortOrder: order });
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
  try { const db = await requireAdminClient(); const { error } = await db.from('categories').insert({ name: parsed.data.name, sort_order: parsed.data.sortOrder }); if (error) return dbError(error.code); return { data: { message: 'Categoria criada.' } }; } catch (error) { return failure(error); }
}

export async function updateCategory(input: unknown): Promise<MenuMutationResult> {
  const parsed = categoryUpdate.safeParse(input); if (!parsed.success) return { error: 'Categoria inválida.' };
  try { const db = await requireAdminClient(); const value = parsed.data; const { data, error } = await db.from('categories').update({ name: value.name, sort_order: value.sortOrder, active: value.active }).eq('id', value.id).eq('updated_at', value.updatedAt).select('id').maybeSingle(); if (error) return dbError(error.code); if (!data) return { error: 'Categoria alterada por outro administrador.', conflict: true }; return { data: { message: 'Categoria atualizada.' } }; } catch (error) { return failure(error); }
}

async function categoryExists(db: Awaited<ReturnType<typeof requireAdminClient>>, categoryId: string) { const { data } = await db.from('categories').select('id').eq('id', categoryId).maybeSingle(); return !!data; }
export async function createProduct(input: unknown): Promise<MenuMutationResult> {
  const parsed = productCreate.safeParse(input); if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Produto inválido.' };
  try { const db = await requireAdminClient(); const value = parsed.data; if (!await categoryExists(db, value.categoryId)) return { error: 'Categoria inexistente.' }; const { error } = await db.from('products').insert({ category_id: value.categoryId, name: value.name, description: value.description || null, price_cents: value.price, image_url: value.imageUrl || null, sort_order: value.sortOrder, active: value.active }); if (error) return dbError(error.code); return { data: { message: 'Produto criado.' } }; } catch (error) { return failure(error); }
}
export async function updateProduct(input: unknown): Promise<MenuMutationResult> {
  const parsed = productUpdate.safeParse(input); if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Produto inválido.' };
  try { const db = await requireAdminClient(); const value = parsed.data; if (!await categoryExists(db, value.categoryId)) return { error: 'Categoria inexistente.' }; const { data, error } = await db.from('products').update({ category_id: value.categoryId, name: value.name, description: value.description || null, price_cents: value.price, image_url: value.imageUrl || null, sort_order: value.sortOrder, active: value.active }).eq('id', value.id).eq('updated_at', value.updatedAt).select('id').maybeSingle(); if (error) return dbError(error.code); if (!data) return { error: 'Produto alterado por outro administrador.', conflict: true }; return { data: { message: 'Produto atualizado.' } }; } catch (error) { return failure(error); }
}

export async function updateAvailability(input: unknown): Promise<MenuMutationResult> {
  const parsed = availabilitySchema.safeParse(input); if (!parsed.success) return { error: 'Disponibilidade inválida.' };
  try { const db = await requireAdminClient(); const value = parsed.data; const { data: today, error: dateError } = await db.rpc('menu_date'); if (dateError || typeof today !== 'string') return { error: 'Data comercial indisponível.' }; if (value.updatedAt) { const { data, error } = await db.from('product_daily_availability').update({ available_today: value.availableToday, sold_out: value.soldOut, sort_order: value.sortOrder }).eq('product_id', value.productId).eq('date', today).eq('updated_at', value.updatedAt).select('id').maybeSingle(); if (error) return dbError(error.code); if (!data) return { error: 'Disponibilidade alterada por outro administrador.', conflict: true }; } else { const { error } = await db.from('product_daily_availability').insert({ product_id: value.productId, date: today, available_today: value.availableToday, sold_out: value.soldOut, sort_order: value.sortOrder }); if (error) return dbError(error.code); } return { data: { message: 'Disponibilidade atualizada.' } }; } catch (error) { return failure(error); }
}

async function productExists(db: Awaited<ReturnType<typeof requireAdminClient>>, productId: string) { const { data } = await db.from('products').select('id').eq('id', productId).maybeSingle(); return !!data; }
export async function createOption(input: unknown): Promise<MenuMutationResult> {
  const parsed = optionCreate.safeParse(input); if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Opção inválida.' };
  try { const db = await requireAdminClient(); const value = parsed.data; if (!await productExists(db, value.productId)) return { error: 'Produto inexistente.' }; const { error } = await db.from('product_options').insert({ product_id: value.productId, name: value.name, required: value.required, min_choices: value.minChoices, max_choices: value.maxChoices }); if (error) return dbError(error.code); return { data: { message: 'Opção criada.' } }; } catch (error) { return failure(error); }
}
export async function updateOption(input: unknown): Promise<MenuMutationResult> {
  const parsed = optionUpdate.safeParse(input); if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Opção inválida.' };
  try { const db = await requireAdminClient(); const value = parsed.data; const { data, error } = await db.from('product_options').update({ name: value.name, required: value.required, min_choices: value.minChoices, max_choices: value.maxChoices }).eq('id', value.id).eq('product_id', value.productId).eq('updated_at', value.updatedAt).select('id').maybeSingle(); if (error) return dbError(error.code); if (!data) return { error: 'Opção alterada por outro administrador.', conflict: true }; return { data: { message: 'Opção atualizada.' } }; } catch (error) { return failure(error); }
}

async function optionBelongs(db: Awaited<ReturnType<typeof requireAdminClient>>, optionId: string | null, productId: string) { if (!optionId) return true; const { data } = await db.from('product_options').select('id').eq('id', optionId).eq('product_id', productId).maybeSingle(); return !!data; }
export async function createAddon(input: unknown): Promise<MenuMutationResult> {
  const parsed = addonCreate.safeParse(input); if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Adicional inválido.' };
  try { const db = await requireAdminClient(); const value = parsed.data; if (!await productExists(db, value.productId) || !await optionBelongs(db, value.optionId, value.productId)) return { error: 'Produto ou opção incompatível.' }; const { error } = await db.from('product_addons').insert({ product_id: value.productId, option_id: value.optionId, name: value.name, price_cents: value.price, active: value.active, sort_order: value.sortOrder }); if (error) return dbError(error.code); return { data: { message: 'Adicional criado.' } }; } catch (error) { return failure(error); }
}
export async function updateAddon(input: unknown): Promise<MenuMutationResult> {
  const parsed = addonUpdate.safeParse(input); if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Adicional inválido.' };
  try { const db = await requireAdminClient(); const value = parsed.data; if (!await optionBelongs(db, value.optionId, value.productId)) return { error: 'Opção não pertence ao produto.' }; const { data, error } = await db.from('product_addons').update({ option_id: value.optionId, name: value.name, price_cents: value.price, active: value.active, sort_order: value.sortOrder }).eq('id', value.id).eq('product_id', value.productId).eq('updated_at', value.updatedAt).select('id').maybeSingle(); if (error) return dbError(error.code); if (!data) return { error: 'Adicional alterado por outro administrador.', conflict: true }; return { data: { message: 'Adicional atualizado.' } }; } catch (error) { return failure(error); }
}
