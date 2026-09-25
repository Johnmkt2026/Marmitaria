import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWhatsAppManualLink, buildWhatsAppMessage, createWhatsAppUrl, formatBRLCents, normalizeCustomerPhone, normalizeWhatsAppIdentity, suggestedTemplate, WHATSAPP_MESSAGE_MAX_LENGTH } from '../lib/whatsapp.ts';

const context = { customerName: 'Cliente Snapshot', orderNumber: 42, totalCents: 3090, deliveryMethod: 'delivery', restaurantName: 'Marmitaria Local', deliveryMinutesMin: 35, deliveryMinutesMax: 50 };

test('normaliza telefones brasileiros válidos e rejeita inválidos', () => {
  assert.equal(normalizeCustomerPhone('(11) 98765-4321'), '5511987654321');
  assert.equal(normalizeCustomerPhone('+55 11 98765-4321'), '5511987654321');
  assert.equal(normalizeCustomerPhone('005511987654321'), '5511987654321');
  assert.equal(normalizeCustomerPhone('11.2345 6789'), '551123456789');
  assert.equal(normalizeCustomerPhone('5511987654321'), '5511987654321');
  assert.equal(normalizeCustomerPhone('119876543'), null);
  assert.equal(normalizeCustomerPhone('2012345678'), null);
  assert.equal(normalizeCustomerPhone('011987654321'), null);
  assert.equal(normalizeCustomerPhone('5511012345678'), null);
  assert.equal(normalizeCustomerPhone('12125551234'), null);
});

test('preserva identidade oficial Meta sem fabricar o nono dígito', () => {
  const sanitizedInboundFixture = '555198765432';
  assert.equal(normalizeCustomerPhone(sanitizedInboundFixture), null);
  assert.equal(normalizeWhatsAppIdentity(sanitizedInboundFixture), sanitizedInboundFixture);
  assert.equal(normalizeWhatsAppIdentity('5511987654321'), '5511987654321');
  assert.equal(normalizeWhatsAppIdentity('+555198765432'), null);
  assert.equal(normalizeWhatsAppIdentity('55519876-5432'), null);
  assert.equal(normalizeWhatsAppIdentity('5511012345678'), null);
  assert.equal(normalizeWhatsAppIdentity('12125551234'), null);
});

test('templates preservam snapshots, número, total e contexto operacional', () => {
  const confirmation = buildWhatsAppMessage('confirmation', context);
  assert.match(confirmation, /Cliente Snapshot/); assert.match(confirmation, /#42/); assert.match(confirmation, /R\$\s?30,90/); assert.match(confirmation, /35 a 50 minutos/);
  assert.match(buildWhatsAppMessage('preparing', context), /em preparo/);
  assert.match(buildWhatsAppMessage('ready', { ...context, deliveryMethod: 'pickup' }), /pronto para retirada/);
  assert.match(buildWhatsAppMessage('out_for_delivery', context), /saiu para entrega/);
  assert.match(buildWhatsAppMessage('delivered', context), /Finalizamos/);
  assert.match(buildWhatsAppMessage('cancelled', context), /foi cancelado/);
  for (const template of ['confirmation','preparing','ready','out_for_delivery','delivered','cancelled']) {
    const value = buildWhatsAppMessage(template, context);
    assert.match(value, /Cliente Snapshot/); assert.match(value, /#42/); assert.match(value, /entrega/); assert.match(value, /R\$\s?30,90/);
  }
  assert.equal(formatBRLCents(3090).replace(/\u00a0/g, ' '), 'R$ 30,90');
});

test('status sugere o template correspondente', () => {
  assert.equal(suggestedTemplate('new'), 'confirmation'); assert.equal(suggestedTemplate('confirmed'), 'confirmation');
  assert.equal(suggestedTemplate('preparing'), 'preparing'); assert.equal(suggestedTemplate('ready'), 'ready');
  assert.equal(suggestedTemplate('out_for_delivery'), 'out_for_delivery'); assert.equal(suggestedTemplate('delivered'), 'delivered'); assert.equal(suggestedTemplate('cancelled'), 'cancelled');
});

test('link wa.me contém somente telefone e mensagem corretamente codificada', () => {
  const message = 'Pedido #42? R$ 30,90 & entrega pronta!\nOlá 😊';
  const url = createWhatsAppUrl('(11) 98765-4321', message);
  assert.equal(url, `https://wa.me/5511987654321?text=${encodeURIComponent(message)}`);
  assert.equal(new URL(url).searchParams.get('text'), message);
  assert.equal(createWhatsAppUrl('telefone inválido', message), null);
  assert.equal(createWhatsAppUrl('(11) 98765-4321', '   '), null);
  assert.ok(createWhatsAppUrl('(11) 98765-4321', 'a'.repeat(WHATSAPP_MESSAGE_MAX_LENGTH)));
  assert.equal(createWhatsAppUrl('(11) 98765-4321', 'a'.repeat(WHATSAPP_MESSAGE_MAX_LENGTH + 1)), null);
});

test('link manual usa wa_id oficial diretamente e falha fechado sem destino seguro', () => {
  const message = 'Teste & confirmação? #42\nOlá 😊';
  const identity = '555198765432';
  const officialUrl = buildWhatsAppManualLink({ whatsappIdentity: identity }, message);
  assert.equal(officialUrl, `https://wa.me/${identity}?text=${encodeURIComponent(message)}`);
  assert.equal(buildWhatsAppManualLink({ whatsappIdentity: '+555198765432' }, message), null);
  assert.equal(buildWhatsAppManualLink({ whatsappIdentity: '55519876-5432' }, message), null);
  assert.equal(buildWhatsAppManualLink({}, message), null);
});
