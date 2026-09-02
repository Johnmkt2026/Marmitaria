'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { AdminAccessError, requireAdminClient } from '@/lib/admin-orders';
import { getAdminSettings } from '@/lib/admin-settings';
import type { AdminSettings, AdminSettingsResult, SettingsMutationResult } from '@/lib/admin-settings-types';

function toCents(value: string) {
  const [whole, fraction = ''] = value.replace(',', '.').split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
const fee = z.string().trim().regex(/^\d{1,8}([,.]\d{1,2})?$/, 'Informe uma taxa válida.').transform(toCents).refine(value => value <= 2147483647, 'Taxa excede o limite.');
const settingsSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(2, 'Informe o nome da marmitaria.').max(120),
  isOpen: z.boolean(),
  deliveryFee: fee,
  deliveryMinutesMin: z.number().int().min(0, 'O prazo mínimo não pode ser negativo.').max(32767),
  deliveryMinutesMax: z.number().int().min(0, 'O prazo máximo não pode ser negativo.').max(32767),
  updatedAt: z.string().datetime({ offset: true }),
}).refine(value => value.deliveryMinutesMax >= value.deliveryMinutesMin, { message: 'O prazo máximo deve ser maior ou igual ao mínimo.', path: ['deliveryMinutesMax'] });

export async function loadAdminSettings(): Promise<AdminSettingsResult> {
  try { return { data: await getAdminSettings() }; }
  catch (error) {
    return error instanceof AdminAccessError
      ? { error: error.message, unauthorized: true }
      : { error: 'Não foi possível carregar as configurações.' };
  }
}

export async function updateSettings(input: unknown): Promise<SettingsMutationResult> {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Configurações inválidas.' };
  try {
    const db = await requireAdminClient();
    const value = parsed.data;
    const { data, error } = await db.from('restaurant_settings').update({
      name: value.name,
      is_open: value.isOpen,
      delivery_fee_cents: value.deliveryFee,
      delivery_minutes_min: value.deliveryMinutesMin,
      delivery_minutes_max: value.deliveryMinutesMax,
    }).eq('id', value.id).eq('updated_at', value.updatedAt)
      .select('id,name,is_open,delivery_fee_cents,delivery_minutes_min,delivery_minutes_max,updated_at')
      .maybeSingle<AdminSettings>();
    if (error) return { error: error.code === '23514' ? 'Os valores informados são incompatíveis.' : 'Não foi possível salvar as configurações.' };
    if (!data) return { error: 'As configurações foram alteradas por outro administrador. Recarregue antes de salvar.', conflict: true };
    revalidatePath('/admin/configuracoes');
    revalidatePath('/cardapio');
    return { data, message: 'Configurações atualizadas.' };
  } catch (error) {
    return error instanceof AdminAccessError
      ? { error: error.message, unauthorized: true }
      : { error: 'Não foi possível salvar as configurações.' };
  }
}
