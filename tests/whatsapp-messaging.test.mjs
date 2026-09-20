import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMetaTemplatePayload, buildMetaTextPayload, classifyProviderFailure, createProvider, DisabledWhatsAppProvider, isWhatsAppIntegrationReady, parseWebhookPayload, retryDelaySeconds, verifyMetaSignature, verifySharedSecret } from '../supabase/functions/_shared/whatsapp-core.ts';

const payload = { object: 'whatsapp_business_account', entry: [{ id: 'waba-test', changes: [{ field: 'messages', value: {
  metadata: { phone_number_id: 'phone-test' },
  messages: [{ from: '5511987654321', id: 'wamid.in.1', timestamp: '1789905600', type: 'text', text: { body: 'Boa tarde, meu pedido já saiu?' } }],
  statuses: [{ id: 'wamid.out.1', status: 'delivered', timestamp: '1789905660' }],
} }] }] };

test('parser extrai inbound e status sem depender da Meta', () => {
  const parsed = parseWebhookPayload(payload);
  assert.equal(parsed.inbound.length, 1); assert.equal(parsed.statuses.length, 1);
  assert.equal(parsed.inbound[0].phoneE164, '+5511987654321');
  assert.equal(parsed.inbound[0].contentText, 'Boa tarde, meu pedido já saiu?');
  assert.equal(parsed.statuses[0].status, 'delivered');
  assert.deepEqual(parseWebhookPayload({ object: 'other' }), { inbound: [], statuses: [] });
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

test('payload outbound remove pontuação e classificação diferencia retry', () => {
  assert.deepEqual(buildMetaTextPayload('+55 (11) 98765-4321', 'Olá'), { messaging_product: 'whatsapp', recipient_type: 'individual', to: '5511987654321', type: 'text', text: { preview_url: false, body: 'Olá' } });
  assert.deepEqual(buildMetaTemplatePayload('+5511987654321','order_ready','pt_BR'), { messaging_product: 'whatsapp', recipient_type: 'individual', to: '5511987654321', type: 'template', template: { name: 'order_ready', language: { code: 'pt_BR' }, components: [] } });
  assert.equal(classifyProviderFailure(429).retryable, true); assert.equal(classifyProviderFailure(503).retryable, true);
  assert.equal(classifyProviderFailure(400).retryable, false); assert.equal(retryDelaySeconds(1), 60); assert.equal(retryDelaySeconds(20), 3600);
});
