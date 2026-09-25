'use server';

import { z } from 'zod';
import { AdminAccessError, requireAdminClient } from '@/lib/admin-orders';
import { getWhatsAppCenterResult, getWhatsAppMessagesResult } from '@/lib/admin-whatsapp';
import type { QueueWhatsAppResult, WhatsAppCenterResult, WhatsAppMessagesResult } from '@/lib/admin-whatsapp-types';
import { normalizeWhatsAppIdentity, WHATSAPP_MESSAGE_MAX_LENGTH } from '@/lib/whatsapp';

export async function loadWhatsAppCenter(): Promise<WhatsAppCenterResult> { return getWhatsAppCenterResult(); }

const messagesSchema = z.object({ conversationId: z.string().uuid(), beforeCreatedAt: z.string().datetime({ offset: true }).optional(), beforeId: z.string().uuid().optional() })
  .refine(value => Boolean(value.beforeCreatedAt) === Boolean(value.beforeId), 'Cursor incompleto');
export async function loadWhatsAppMessages(input: unknown): Promise<WhatsAppMessagesResult> {
  const parsed = messagesSchema.safeParse(input);
  if (!parsed.success) return { error: 'Conversa ou paginação inválida.' };
  return getWhatsAppMessagesResult(parsed.data.conversationId, parsed.data.beforeCreatedAt, parsed.data.beforeId);
}

const queueSchema = z.object({ conversationId: z.string().uuid(), orderId: z.string().uuid().nullable().optional(),
  content: z.string().trim().min(1).max(WHATSAPP_MESSAGE_MAX_LENGTH), idempotencyKey: z.string().trim().min(1).max(250) });
export async function queueWhatsAppMessage(input: unknown): Promise<QueueWhatsAppResult> {
  const parsed = queueSchema.safeParse(input);
  if (!parsed.success) return { error: `A mensagem deve conter entre 1 e ${WHATSAPP_MESSAGE_MAX_LENGTH} caracteres.` };
  try {
    const db = await requireAdminClient();
    if (process.env.WHATSAPP_INTEGRATION_ENABLED !== 'true') return { error: 'A integração oficial ainda não está configurada.' };
    const { data: conversation, error: conversationError } = await db.from('whatsapp_conversations')
      .select('id,wa_id,service_window_expires_at,latest_order_id').eq('id',parsed.data.conversationId).maybeSingle<{
        id: string; wa_id: string; service_window_expires_at: string | null; latest_order_id: string | null;
      }>();
    if (conversationError || !conversation) return { error: 'Conversa não encontrada.' };
    if (!normalizeWhatsAppIdentity(conversation.wa_id)) return { error: 'A identidade WhatsApp da conversa é inválida.' };
    if (!conversation.service_window_expires_at || new Date(conversation.service_window_expires_at) <= new Date())
      return { error: 'A janela de atendimento de 24 horas está encerrada. Use um template aprovado.' };
    if (parsed.data.orderId && parsed.data.orderId !== conversation.latest_order_id)
      return { error: 'O pedido informado não corresponde à conversa.' };
    const { data, error } = await db.rpc('queue_whatsapp_message', { p_conversation_id: parsed.data.conversationId,
      p_content_text: parsed.data.content, p_order_id: parsed.data.orderId ?? null, p_idempotency_key: parsed.data.idempotencyKey });
    if (error || typeof data !== 'string') return { error: 'Não foi possível enfileirar a mensagem.' };
    return { data: { message_id: data } };
  } catch (error) {
    return error instanceof AdminAccessError ? { error: error.message, unauthorized: true } : { error: 'Não foi possível enfileirar a mensagem.' };
  }
}
