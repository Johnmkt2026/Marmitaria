'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import type { OrderReceipt } from '@/lib/menu-types';

const orderSchema = z.object({
  customer_name: z.string().trim().min(2, 'Informe seu nome.').max(120),
  whatsapp: z.string().transform(value => value.replace(/[^0-9+]/g, '')).pipe(z.string().regex(/^\+?[0-9]{10,15}$/, 'Informe um WhatsApp válido.')),
  delivery_method: z.enum(['delivery', 'pickup']),
  payment_method: z.enum(['pix', 'card', 'cash']),
  address: z.string().trim().max(500),
  notes: z.string().trim().max(1000),
  change_for_cents: z.number().int().nonnegative().max(2147483647).nullable(),
  items: z.array(z.object({
    product_id: z.string().uuid(), quantity: z.number().int().min(1).max(999),
    size: z.enum(['small', 'large']).nullable(), addon_ids: z.array(z.string().uuid()).max(100), notes: z.string().trim().max(500),
  })).min(1).max(100),
}).refine(value => value.delivery_method !== 'delivery' || value.address.length >= 5, 'Informe o endereço de entrega.');

const receiptSchema = z.object({
  order_id: z.string().uuid(), order_number: z.number().int().positive(),
  subtotal_cents: z.number().int().nonnegative(), delivery_fee_cents: z.number().int().nonnegative(),
  total_cents: z.number().int().nonnegative(),
  items: z.array(z.object({ product_id: z.string().uuid(), name: z.string(), size: z.enum(['small','large']).nullable(), unit_price_cents: z.number().int().nonnegative(), quantity: z.number().int().positive(), notes: z.string().nullable(), addons: z.array(z.object({ name: z.string(), unit_price_cents: z.number().int().nonnegative(), quantity: z.number().int().positive() })) })),
});

export async function placeOrder(input: unknown): Promise<{ receipt: OrderReceipt; error?: never } | { error: string; receipt?: never }> {
  const parsed = orderSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Confira os dados do pedido.' };
  const db = await createClient();
  if (!db) return { error: 'Serviço de pedidos indisponível. Tente novamente mais tarde.' };
  const order = parsed.data;
  const { data, error } = await db.rpc('create_order', {
    p_customer_name: order.customer_name, p_whatsapp: order.whatsapp,
    p_delivery_method: order.delivery_method, p_payment_method: order.payment_method,
    p_address: order.address, p_notes: order.notes, p_items: order.items,
    p_change_for_cents: order.change_for_cents,
  });
  if (error) {
    return { error: error.code === 'P0001' ? error.message : 'Não foi possível confirmar o pedido. Confira os dados e tente novamente.' };
  }
  const receipt = receiptSchema.safeParse(data);
  if (!receipt.success) return { error: 'Não foi possível ler a confirmação. Consulte o restaurante antes de repetir o pedido.' };
  return { receipt: receipt.data };
}
