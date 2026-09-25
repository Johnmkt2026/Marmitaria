import { createClient } from 'npm:@supabase/supabase-js@2';
import { createProvider, isWhatsAppIntegrationReady, verifySharedSecret, type WhatsAppRuntimeConfig } from '../_shared/whatsapp-core.ts';

type OutboxRow = { id: string; payload: { wa_id?: string; phone_e164?: string; content_text?: string; template_name?: string; template_language?: string; template_components?: unknown[] }; attempt_count: number };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

Deno.serve(async request => {
  if (request.method !== 'POST') return json({ error: 'Método não permitido' }, 405);
  if (!verifySharedSecret(request.headers.get('x-worker-secret'), Deno.env.get('WHATSAPP_WORKER_SECRET') ?? '')) return json({ error: 'Não autorizado' }, 401);
  const config: WhatsAppRuntimeConfig = {
    enabled: Deno.env.get('WHATSAPP_INTEGRATION_ENABLED') === 'true',
    accessToken: Deno.env.get('WHATSAPP_ACCESS_TOKEN'), appSecret: Deno.env.get('WHATSAPP_APP_SECRET'),
    verifyToken: Deno.env.get('WHATSAPP_VERIFY_TOKEN'), phoneNumberId: Deno.env.get('WHATSAPP_PHONE_NUMBER_ID'),
    businessAccountId: Deno.env.get('WHATSAPP_BUSINESS_ACCOUNT_ID'), graphApiVersion: Deno.env.get('WHATSAPP_GRAPH_API_VERSION') ?? 'v23.0',
  };
  if (!isWhatsAppIntegrationReady(config)) return json({ processed: 0, disabled: true, message: 'Integração oficial ainda não configurada' });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const workerId = crypto.randomUUID();
  const { data, error } = await db.rpc('claim_whatsapp_outbox', { p_worker_id: workerId, p_limit: 20 });
  if (error) return json({ error: 'Falha ao reservar outbox' }, 500);
  const provider = createProvider(config);
  let completed = 0;
  for (const item of (data ?? []) as OutboxRow[]) {
    const recipient = item.payload.wa_id ?? item.payload.phone_e164; const content = item.payload.content_text; const templateName = item.payload.template_name;
    if (!recipient || (!content && !templateName)) {
      await db.rpc('fail_whatsapp_outbox', { p_outbox_id: item.id, p_error_code: 'invalid_payload', p_error_message: 'Payload incompleto', p_retryable: false, p_max_attempts: 5 });
      continue;
    }
    const result = templateName
      ? await provider.sendTemplate(recipient, templateName, item.payload.template_language ?? 'pt_BR', item.payload.template_components ?? [])
      : await provider.sendText(recipient, content!);
    if (result.ok) { await db.rpc('complete_whatsapp_outbox', { p_outbox_id: item.id, p_external_message_id: result.externalMessageId }); completed += 1; }
    else await db.rpc('fail_whatsapp_outbox', { p_outbox_id: item.id, p_error_code: result.code, p_error_message: result.message, p_retryable: result.retryable, p_max_attempts: 5 });
  }
  return json({ processed: (data ?? []).length, completed });
});
