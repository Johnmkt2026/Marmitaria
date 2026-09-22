import { createClient } from 'npm:@supabase/supabase-js@2';
import { parseWebhookPayload, verifyMetaSignature } from '../_shared/whatsapp-core.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

Deno.serve(async request => {
  const url = new URL(request.url);
  const webhookEnabled = Deno.env.get('WHATSAPP_WEBHOOK_ENABLED') === 'true';
  const verifyToken = Deno.env.get('WHATSAPP_VERIFY_TOKEN') ?? '';
  const appSecret = Deno.env.get('WHATSAPP_APP_SECRET') ?? '';
  const expectedPhoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') ?? '';
  const expectedBusinessAccountId = Deno.env.get('WHATSAPP_BUSINESS_ACCOUNT_ID') ?? '';

  if (request.method === 'GET') {
    if (!verifyToken) return json({ error: 'Verificação ainda não configurada' }, 503);
    if (url.searchParams.get('hub.mode') !== 'subscribe' || url.searchParams.get('hub.verify_token') !== verifyToken) return json({ error: 'Verificação inválida' }, 403);
    return new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200 });
  }
  if (request.method !== 'POST') return json({ error: 'Método não permitido' }, 405);
  if (!webhookEnabled) return json({ error: 'Recebimento oficial ainda não configurado' }, 503);

  const rawBody = await request.text();
  if (!await verifyMetaSignature(rawBody, request.headers.get('x-hub-signature-256'), appSecret)) return json({ error: 'Assinatura inválida' }, 401);
  let payload: unknown;
  try { payload = JSON.parse(rawBody); } catch { return json({ error: 'JSON inválido' }, 400); }
  const parsed = parseWebhookPayload(payload);
  const events = [...parsed.inbound, ...parsed.statuses];
  if (expectedBusinessAccountId && events.some(event => event.businessAccountId !== expectedBusinessAccountId))
    return json({ error: 'Conta comercial inesperada' }, 403);
  if (expectedPhoneNumberId && events.some(event => event.phoneNumberId !== expectedPhoneNumberId))
    return json({ error: 'Número comercial inesperado' }, 403);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  for (const message of parsed.inbound) {
    const { error } = await db.rpc('record_whatsapp_inbound', {
      p_external_event_key: message.eventKey, p_external_message_id: message.externalMessageId,
      p_phone_number_id: message.phoneNumberId, p_wa_id: message.waId, p_phone_e164: message.phoneE164,
      p_message_type: message.messageType, p_content_text: message.contentText, p_occurred_at: message.occurredAt, p_payload: message.payload,
    });
    if (error) return json({ error: 'Falha ao persistir evento' }, 500);
  }
  for (const status of parsed.statuses) {
    const { error } = await db.rpc('update_whatsapp_message_status', {
      p_external_event_key: status.eventKey, p_external_message_id: status.externalMessageId,
      p_status: status.status, p_occurred_at: status.occurredAt, p_failure_code: status.failureCode ?? null,
      p_failure_message: status.failureMessage ?? null, p_payload: status.payload,
    });
    if (error) return json({ error: 'Falha ao persistir status' }, 500);
  }
  return json({ received: true });
});
