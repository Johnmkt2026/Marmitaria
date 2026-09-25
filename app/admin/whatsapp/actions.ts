'use server';

import { z } from 'zod';
import { AdminAccessError, requireAdminClient } from '@/lib/admin-orders';
import { getWhatsAppCenterResult, getWhatsAppMessagesResult } from '@/lib/admin-whatsapp';
import type { QueueWhatsAppResult, WhatsAppCenterResult, WhatsAppMessagesResult } from '@/lib/admin-whatsapp-types';
import { buildOfficialTemplateComponents, normalizeWhatsAppIdentity, resolveWhatsAppOutboundMode, WHATSAPP_MESSAGE_MAX_LENGTH, WHATSAPP_OFFICIAL_TEMPLATES, WHATSAPP_TEMPLATE_IDS, type MessageContext } from '@/lib/whatsapp';

export async function loadWhatsAppCenter(): Promise<WhatsAppCenterResult> { return getWhatsAppCenterResult(); }

const messagesSchema = z.object({ conversationId: z.string().uuid(), beforeCreatedAt: z.string().datetime({ offset: true }).optional(), beforeId: z.string().uuid().optional() })
  .refine(value => Boolean(value.beforeCreatedAt) === Boolean(value.beforeId), 'Cursor incompleto');
export async function loadWhatsAppMessages(input: unknown): Promise<WhatsAppMessagesResult> {
  const parsed = messagesSchema.safeParse(input);
  if (!parsed.success) return { error: 'Conversa ou paginação inválida.' };
  return getWhatsAppMessagesResult(parsed.data.conversationId, parsed.data.beforeCreatedAt, parsed.data.beforeId);
}

const queueSchema = z.object({ conversationId: z.string().uuid(), orderId: z.string().uuid().nullable().optional(),
  content: z.string().trim().min(1).max(WHATSAPP_MESSAGE_MAX_LENGTH), templateId: z.enum(WHATSAPP_TEMPLATE_IDS),
  idempotencyKey: z.string().trim().min(1).max(250) });
export async function queueWhatsAppMessage(input: unknown): Promise<QueueWhatsAppResult> {
  const parsed = queueSchema.safeParse(input);
  if (!parsed.success) return { error: `A mensagem deve conter entre 1 e ${WHATSAPP_MESSAGE_MAX_LENGTH} caracteres.` };
  try {
    const db = await requireAdminClient();
    const integrationEnabled = process.env.WHATSAPP_INTEGRATION_ENABLED === 'true';
    if (!integrationEnabled) return { error: 'Envio oficial ainda não ativado.' };
    const [conversationResult, settingsResult] = await Promise.all([
      db.from('whatsapp_conversations').select('id,wa_id,service_window_expires_at,latest_order_id')
        .eq('id',parsed.data.conversationId).maybeSingle<{
          id: string; wa_id: string; service_window_expires_at: string | null; latest_order_id: string | null;
        }>(),
      db.from('whatsapp_settings').select('connection_state').eq('singleton',true).single<{ connection_state: string }>(),
    ]);
    const { data: conversation, error: conversationError } = conversationResult;
    if (conversationError || !conversation) return { error: 'Conversa não encontrada.' };
    if (settingsResult.error || !settingsResult.data) return { error: 'Não foi possível validar o estado da integração.' };
    if (['removed','attention'].includes(settingsResult.data.connection_state))
      return { error: 'A integração do WhatsApp foi removida ou requer atenção.' };
    if (!normalizeWhatsAppIdentity(conversation.wa_id)) return { error: 'A identidade WhatsApp da conversa é inválida.' };
    if (parsed.data.orderId && parsed.data.orderId !== conversation.latest_order_id)
      return { error: 'O pedido informado não corresponde à conversa.' };
    const outbound = resolveWhatsAppOutboundMode({ integrationEnabled, serviceWindowExpiresAt: conversation.service_window_expires_at,
      templateId: parsed.data.templateId });
    if (outbound.mode === 'blocked' || outbound.mode === 'disabled') return { error: outbound.message };
    let templateName: string | null = null; let templateLanguage: string | null = null; let templateComponents: unknown[] | null = null;
    if (outbound.mode === 'template') {
      const orderId = parsed.data.orderId ?? conversation.latest_order_id;
      if (!orderId) return { error: 'Selecione um pedido para usar um modelo aprovado.' };
      const [orderResult, settingsResult] = await Promise.all([
        db.from('orders').select('id,order_number,customer_id,customer_name_snapshot,total_cents,delivery_method').eq('id', orderId).maybeSingle<{
          id: string; order_number: number; customer_id: string; customer_name_snapshot: string; total_cents: number; delivery_method: 'delivery' | 'pickup';
        }>(),
        db.from('restaurant_settings').select('name,delivery_minutes_min,delivery_minutes_max').limit(1).single<{
          name: string; delivery_minutes_min: number | null; delivery_minutes_max: number | null;
        }>(),
      ]);
      if (orderResult.error || !orderResult.data || settingsResult.error || !settingsResult.data)
        return { error: 'Não foi possível preparar o modelo oficial.' };
      const definition = WHATSAPP_OFFICIAL_TEMPLATES[outbound.templateId];
      const context: MessageContext = { customerName: orderResult.data.customer_name_snapshot, orderNumber: orderResult.data.order_number,
        totalCents: orderResult.data.total_cents, deliveryMethod: orderResult.data.delivery_method, restaurantName: settingsResult.data.name,
        deliveryMinutesMin: settingsResult.data.delivery_minutes_min, deliveryMinutesMax: settingsResult.data.delivery_minutes_max };
      templateName = definition.name; templateLanguage = definition.language; templateComponents = buildOfficialTemplateComponents(context);
    }
    const { data, error } = await db.rpc('queue_whatsapp_outbound', { p_conversation_id: parsed.data.conversationId,
      p_message_type: outbound.mode, p_content_text: outbound.mode === 'text' ? parsed.data.content : null,
      p_template_name: templateName, p_template_language: templateLanguage, p_template_components: templateComponents,
      p_order_id: parsed.data.orderId ?? null, p_idempotency_key: parsed.data.idempotencyKey });
    if (error || typeof data !== 'string') return { error: 'Não foi possível enfileirar a mensagem.' };
    return { data: { message_id: data } };
  } catch (error) {
    return error instanceof AdminAccessError ? { error: error.message, unauthorized: true } : { error: 'Não foi possível enfileirar a mensagem.' };
  }
}
