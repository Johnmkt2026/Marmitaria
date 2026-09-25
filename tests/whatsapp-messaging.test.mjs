import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMetaTemplatePayload, buildMetaTextPayload, classifyProviderFailure, createProvider, DisabledWhatsAppProvider, isWhatsAppIntegrationReady, parseWebhookPayload, providerFailureMessage, retryDelaySeconds, validateWebhookIdentity, verifyMetaSignature, verifySharedSecret } from '../supabase/functions/_shared/whatsapp-core.ts';

const payload = { object: 'whatsapp_business_account', entry: [{ id: 'waba-test', changes: [{ field: 'messages', value: {
  metadata: { phone_number_id: 'phone-test' },
  messages: [{ from: '5511987654321', id: 'wamid.in.1', timestamp: '1789905600', type: 'text', text: { body: 'Boa tarde, meu pedido já saiu?' } }],
  statuses: [{ id: 'wamid.out.1', status: 'delivered', timestamp: '1789905660' }],
} }] }] };

test('parser extrai inbound e status sem depender da Meta', () => {
  const parsed = parseWebhookPayload(payload);
  assert.equal(parsed.inbound.length, 1); assert.equal(parsed.statuses.length, 1);
  assert.equal(parsed.inbound[0].businessAccountId, 'waba-test');
  assert.equal(parsed.inbound[0].phoneNumberId, 'phone-test');
  assert.equal(parsed.inbound[0].phoneE164, '+5511987654321');
  assert.equal(parsed.inbound[0].contentText, 'Boa tarde, meu pedido já saiu?');
  assert.equal(parsed.statuses[0].businessAccountId, 'waba-test');
  assert.equal(parsed.statuses[0].phoneNumberId, 'phone-test');
  assert.equal(parsed.statuses[0].status, 'delivered');
  assert.deepEqual(parseWebhookPayload({ object: 'other' }), { inbound: [], statuses: [], passiveMessages: [], accountUpdates: [], syncProgress: [], contacts: [], unknown: [], identities: [] });
});

const coexistencePayload = { object: 'whatsapp_business_account', entry: [{ id: 'waba-test', time: 1789905000, changes: [
  { field: 'account_update', value: { phone_number: '5511999999999', event: 'ACCOUNT_RECONNECTED' } },
  { field: 'history', value: { metadata: { display_phone_number: '5511999999999', phone_number_id: 'phone-test' }, history: [{ metadata: { phase: 1, chunk_order: 7, progress: 100 }, threads: [{ id: '5511987654321', messages: [
    { from: '5511987654321', id: 'wamid.history.in', timestamp: '1789800000', type: 'text', text: { body: 'Histórico recebido' }, history_context: { status: 'READ' } },
    { from: '5511999999999', to: '5511987654321', id: 'wamid.history.out', timestamp: '1789800000', type: 'text', text: { body: 'Histórico enviado' }, history_context: { status: 'DELIVERED' } },
  ] }] }] } },
  { field: 'smb_message_echoes', value: { metadata: { display_phone_number: '5511999999999', phone_number_id: 'phone-test' }, message_echoes: [
    { from: '5511999999999', to: '5511987654321', id: 'wamid.echo.1', timestamp: '1789905700', type: 'text', text: { body: 'Resposta pelo celular' } },
  ] } },
  { field: 'smb_app_state_sync', value: { metadata: { display_phone_number: '5511999999999', phone_number_id: 'phone-test' }, state_sync: [
    { type: 'contact', contact: { full_name: 'Cliente Teste', phone_number: '5511987654321' }, action: 'add', metadata: { timestamp: '1789905800' } },
  ] } },
  { field: 'campo_futuro', value: { metadata: { phone_number_id: 'phone-test' }, sensitive: 'não persistir' } },
] }] };

test('parser separa eventos oficiais de coexistência e sanitiza desconhecidos', () => {
  const parsed = parseWebhookPayload(coexistencePayload);
  assert.equal(parsed.accountUpdates.length, 1); assert.equal(parsed.accountUpdates[0].event, 'ACCOUNT_RECONNECTED');
  assert.equal(parsed.accountUpdates[0].occurredAt, new Date(1789905000 * 1000).toISOString());
  assert.equal(parsed.passiveMessages.length, 3);
  const historyInbound = parsed.passiveMessages.find(item => item.externalMessageId === 'wamid.history.in');
  const historyOutbound = parsed.passiveMessages.find(item => item.externalMessageId === 'wamid.history.out');
  const echo = parsed.passiveMessages.find(item => item.externalMessageId === 'wamid.echo.1');
  assert.deepEqual({ direction: historyInbound.direction, origin: historyInbound.origin, status: historyInbound.status }, { direction: 'inbound', origin: 'history', status: 'received' });
  assert.deepEqual({ direction: historyOutbound.direction, origin: historyOutbound.origin, status: historyOutbound.status }, { direction: 'outbound', origin: 'history', status: 'delivered' });
  assert.deepEqual({ direction: echo.direction, origin: echo.origin, status: echo.status }, { direction: 'outbound', origin: 'business_app', status: 'sent' });
  assert.equal(historyInbound.occurredAt, historyOutbound.occurredAt, 'timestamps históricos iguais foram alterados');
  assert.equal(parsed.syncProgress[0].state, 'completed'); assert.equal(parsed.syncProgress[0].itemsProcessed, 2);
  assert.equal(parsed.contacts.length, 1); assert.equal(parsed.contacts[0].waId, '5511987654321');
  assert.equal(parsed.syncProgress.find(item => item.syncType === 'contacts').state, 'completed');
  assert.equal(parsed.unknown.length, 1); assert.equal(parsed.unknown[0].payload.sensitive, undefined);
});

test('parser aceita complemento de mídia do histórico sem expor conteúdo bruto no evento', () => {
  const parsed = parseWebhookPayload({ object: 'whatsapp_business_account', entry: [{ id: 'waba-test', changes: [{ field: 'history', value: {
    metadata: { display_phone_number: '5511999999999', phone_number_id: 'phone-test' },
    messages: [{ from: '5511987654321', id: 'wamid.history.media', timestamp: '1789800100', type: 'image', image: { caption: 'Foto do pedido', id: 'media-test' } }],
  } }] }] });
  assert.equal(parsed.passiveMessages.length, 1); assert.equal(parsed.passiveMessages[0].messageType, 'image');
  assert.equal(parsed.passiveMessages[0].contentText, 'Foto do pedido');
  assert.equal(parsed.passiveMessages[0].payload.id, 'wamid.history.media');
  assert.equal(parsed.passiveMessages[0].payload.caption, undefined);
});

test('parser aceita progresso textual e infere direção histórica pelo thread quando necessário', () => {
  const parsed = parseWebhookPayload({ object: 'whatsapp_business_account', entry: [{ id: 'waba-test', time: 1789906200, changes: [{ field: 'history', value: {
    metadata: { phone_number_id: 'phone-test' }, history: [{ metadata: { phase: 0, chunk_order: 2, progress: '75' }, threads: [{ id: '5511987654321', messages: [
      { from: '5511999999999', to: '5511987654321', id: 'wamid.history.no-display', timestamp: '1789906100', type: 'text', text: { body: 'Enviada' } },
    ] }] }],
  } }] }] });
  assert.equal(parsed.passiveMessages[0].direction, 'outbound');
  assert.equal(parsed.passiveMessages[0].waId, '5511987654321');
  assert.equal(parsed.syncProgress[0].progress, 75);
});

test('parser registra recusa de histórico sem exigir mensagens', () => {
  const parsed = parseWebhookPayload({ object: 'whatsapp_business_account', entry: [{ id: 'waba-test', changes: [{ field: 'history', value: {
    metadata: { phone_number_id: 'phone-test' }, history: [{ errors: [{ code: 2593109, message: 'History sharing is turned off' }] }],
  } }] }] });
  assert.equal(parsed.passiveMessages.length, 0); assert.equal(parsed.syncProgress.length, 1);
  assert.equal(parsed.syncProgress[0].state, 'failed'); assert.equal(parsed.syncProgress[0].failureCode, '2593109');
});

test('parser aceita recusa de histórico no value e separa execuções por timestamp', () => {
  const failed = parseWebhookPayload({ object: 'whatsapp_business_account', entry: [{ id: 'waba-test', time: 1789906000, changes: [{ field: 'history', value: {
    metadata: { phone_number_id: 'phone-test' }, errors: [{ code: 2593109, message: 'History sharing is turned off' }],
  } }] }] });
  assert.equal(failed.syncProgress.length, 1); assert.equal(failed.syncProgress[0].state, 'failed');
  assert.equal(failed.syncProgress[0].failureCode, '2593109');
  const first = parseWebhookPayload(coexistencePayload).syncProgress.find(item => item.syncType === 'history');
  const secondPayload = structuredClone(coexistencePayload); secondPayload.entry[0].time += 1;
  const second = parseWebhookPayload(secondPayload).syncProgress.find(item => item.syncType === 'history');
  assert.notEqual(first.externalBatchId, second.externalBatchId);
});

test('parser trata atualização de contato como upsert idempotente', () => {
  const parsed = parseWebhookPayload({ object: 'whatsapp_business_account', entry: [{ id: 'waba-test', time: 1789906100, changes: [{ field: 'smb_app_state_sync', value: {
    metadata: { phone_number_id: 'phone-test' }, state_sync: [{ type: 'contact', action: 'update',
      contact: { first_name: 'Cliente', phone_number: '+55 (11) 98765-4321' }, metadata: { timestamp: '1789906100' } }],
  } }] }] });
  assert.equal(parsed.contacts.length, 1); assert.equal(parsed.contacts[0].action, 'add');
  assert.equal(parsed.contacts[0].waId, '5511987654321'); assert.equal(parsed.contacts[0].displayName, 'Cliente');
});

test('identidade valida WABA sempre e Phone Number ID quando o campo oficial existe', () => {
  const identities = parseWebhookPayload(coexistencePayload).identities;
  assert.equal(validateWebhookIdentity(identities, 'waba-test', 'phone-test'), true);
  assert.equal(validateWebhookIdentity(identities, 'waba-errada', 'phone-test'), false);
  assert.equal(validateWebhookIdentity(identities, 'waba-test', 'phone-errado'), false);
  const accountOnly = parseWebhookPayload({ object: 'whatsapp_business_account', entry: [{ id: 'waba-test', changes: [{ field: 'account_update', value: { event: 'PARTNER_REMOVED' } }] }] }).identities;
  assert.equal(validateWebhookIdentity(accountOnly, 'waba-test', 'phone-test'), true, 'account_update sem metadata gerou falso 403');
  const partnerAdded = parseWebhookPayload({ object: 'whatsapp_business_account', entry: [{ id: 'business-portfolio-test', changes: [{ field: 'account_update', value: {
    event: 'PARTNER_ADDED', waba_info: { waba_id: 'waba-test', owner_business_id: 'business-portfolio-test' },
  } }] }] });
  assert.equal(partnerAdded.accountUpdates[0].businessAccountId, 'waba-test');
  assert.equal(validateWebhookIdentity(partnerAdded.identities, 'waba-test', 'phone-test'), true, 'WABA de waba_info não foi reconhecida');
});

test('account_update removido preserva motivo técnico sanitizado', () => {
  const parsed = parseWebhookPayload({ object: 'whatsapp_business_account', entry: [{ id: 'waba-test', time: 1789905900, changes: [{ field: 'account_update', value: {
    phone_number: '5511999999999', event: 'PARTNER_REMOVED', disconnection_info: { reason: 'PRIMARY_INACTIVITY', initiated_by: 'SYSTEM' },
  } }] }] });
  assert.equal(parsed.accountUpdates.length, 1);
  assert.deepEqual({ event: parsed.accountUpdates[0].event, reason: parsed.accountUpdates[0].disconnectionReason, initiatedBy: parsed.accountUpdates[0].initiatedBy },
    { event: 'PARTNER_REMOVED', reason: 'PRIMARY_INACTIVITY', initiatedBy: 'SYSTEM' });
});

test('assinatura HMAC aceita segredo fictício e rejeita alteração', async () => {
  const raw = JSON.stringify(payload); const secret = 'segredo-somente-teste';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)));
  const signature = `sha256=${Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')}`;
  assert.equal(await verifyMetaSignature(raw, signature, secret), true);
  assert.equal(await verifyMetaSignature(`${raw} `, signature, secret), false);
  assert.equal(await verifyMetaSignature(raw, null, secret), false);
});

test('worker exige secret interno exato', () => {
  assert.equal(verifySharedSecret('segredo-interno-teste','segredo-interno-teste'), true);
  assert.equal(verifySharedSecret('segredo-incorreto','segredo-interno-teste'), false);
  assert.equal(verifySharedSecret(null,'segredo-interno-teste'), false);
});

test('provider disabled nunca chama rede nem falsifica envio', async () => {
  let calls = 0; const fetcher = async () => { calls += 1; throw new Error('rede não deveria ser chamada'); };
  const provider = createProvider({ enabled: false, graphApiVersion: 'v23.0' }, fetcher);
  const result = await provider.sendText('+5511987654321', 'teste');
  assert.equal(calls, 0); assert.equal(result.ok, false); assert.equal(result.disabled, true);
  assert.ok(provider instanceof DisabledWhatsAppProvider);
  assert.equal(isWhatsAppIntegrationReady({ enabled: false, accessToken: 'ficticio', phoneNumberId: 'phone', graphApiVersion: 'v23.0' }), false);
  assert.equal(isWhatsAppIntegrationReady({ enabled: true, graphApiVersion: 'v23.0' }), false);
});

test('provider Meta simulado persiste o identificador aceito sem rede real', async () => {
  let request;
  const provider = createProvider({ enabled: true, accessToken: 'token-ficticio', phoneNumberId: 'phone-test', graphApiVersion: 'v23.0' }, async (url, init) => {
    request = { url, body: JSON.parse(init.body), signal: init.signal };
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.simulado' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const result = await provider.sendText('+5511987654321', 'Mensagem simulada');
  assert.deepEqual(result, { ok: true, externalMessageId: 'wamid.simulado' });
  assert.match(request.url, /phone-test\/messages$/); assert.equal(request.body.to, '5511987654321');
  assert.ok(request.signal instanceof AbortSignal); assert.equal(request.signal.aborted, false);
});

test('provider Meta monta template oficial e captura external_message_id sem rede', async () => {
  let request;
  const provider = createProvider({ enabled: true, accessToken: 'token-ficticio', phoneNumberId: 'phone-test', graphApiVersion: 'v23.0' }, async (url, init) => {
    request = { url, headers: init.headers, body: JSON.parse(init.body) };
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.template.simulado' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const components = [{ type: 'body', parameters: [{ type: 'text', text: 'Cliente' }] }];
  const result = await provider.sendTemplate('5511987654321', 'order_ready', 'pt_BR', components);
  assert.deepEqual(result, { ok: true, externalMessageId: 'wamid.template.simulado' });
  assert.equal(request.body.messaging_product, 'whatsapp'); assert.equal(request.body.recipient_type, 'individual');
  assert.equal(request.body.to, '5511987654321'); assert.equal(request.body.type, 'template');
  assert.deepEqual(request.body.template, { name: 'order_ready', language: { code: 'pt_BR' }, components });
  assert.match(request.headers.authorization, /^Bearer /);
});

test('payload outbound preserva identidade validada e classificação diferencia retry', () => {
  assert.deepEqual(buildMetaTextPayload('+5511987654321', 'Olá'), { messaging_product: 'whatsapp', recipient_type: 'individual', to: '5511987654321', type: 'text', text: { preview_url: false, body: 'Olá' } });
  assert.deepEqual(buildMetaTemplatePayload('+5511987654321','order_ready','pt_BR'), { messaging_product: 'whatsapp', recipient_type: 'individual', to: '5511987654321', type: 'template', template: { name: 'order_ready', language: { code: 'pt_BR' }, components: [] } });
  assert.equal(classifyProviderFailure(429).retryable, true); assert.equal(classifyProviderFailure(503).retryable, true);
  assert.equal(classifyProviderFailure(400).retryable, false); assert.equal(retryDelaySeconds(1), 60); assert.equal(retryDelaySeconds(20), 3600);
  assert.match(providerFailureMessage(429), /Limite temporário/); assert.match(providerFailureMessage(503), /temporariamente/);
  assert.match(providerFailureMessage(400), /Número ou modelo/);
  assert.throws(() => buildMetaTextPayload('55 (11) 98765-4321', 'não sanitizar identidade'), /invalid_recipient/);
});
