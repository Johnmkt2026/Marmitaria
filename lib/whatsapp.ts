export const WHATSAPP_TEMPLATE_IDS = ['confirmation', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled', 'custom'] as const;
export type WhatsAppTemplateId = typeof WHATSAPP_TEMPLATE_IDS[number];
export type MessageContext = {
  customerName: string; orderNumber: number; totalCents: number; deliveryMethod: 'delivery' | 'pickup';
  restaurantName: string; deliveryMinutesMin: number | null; deliveryMinutesMax: number | null;
};
export const WHATSAPP_MESSAGE_MAX_LENGTH = 2000;
const BRAZILIAN_AREA_CODES = new Set([
  '11','12','13','14','15','16','17','18','19','21','22','24','27','28','31','32','33','34','35','37','38',
  '41','42','43','44','45','46','47','48','49','51','53','54','55','61','62','63','64','65','66','67','68','69',
  '71','73','74','75','77','79','81','82','83','84','85','86','87','88','89','91','92','93','94','95','96','97','98','99',
]);

export const WHATSAPP_TEMPLATE_LABELS: Record<WhatsAppTemplateId, string> = {
  confirmation: 'Confirmação do pedido', preparing: 'Pedido em preparo', ready: 'Pedido pronto',
  out_for_delivery: 'Saiu para entrega', delivered: 'Finalização', cancelled: 'Cancelamento', custom: 'Mensagem personalizada',
};

export function normalizeBrazilianWhatsApp(value: string): string | null {
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  if (!digits.startsWith('55')) return null;
  const local = digits.slice(2);
  if (!BRAZILIAN_AREA_CODES.has(local.slice(0, 2)) || !/^(?:\d{2})(?:[2-5]\d{7}|9\d{8})$/.test(local)) return null;
  return digits;
}

export function formatBRLCents(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

function greeting(context: MessageContext) { return `Olá, ${context.customerName}!`; }
function orderSummary(context: MessageContext) { return `pedido #${context.orderNumber} (${context.deliveryMethod === 'delivery' ? 'entrega' : 'retirada'}), no total de ${formatBRLCents(context.totalCents)}`; }
function deadline(context: MessageContext) {
  if (context.deliveryMethod !== 'delivery') return 'Avisaremos assim que estiver pronto para retirada.';
  if (context.deliveryMinutesMin !== null && context.deliveryMinutesMax !== null) return `O prazo estimado é de ${context.deliveryMinutesMin} a ${context.deliveryMinutesMax} minutos.`;
  if (context.deliveryMinutesMax !== null) return `O prazo estimado é de até ${context.deliveryMinutesMax} minutos.`;
  return 'Avisaremos quando o pedido sair para entrega.';
}

export function buildWhatsAppMessage(template: Exclude<WhatsAppTemplateId, 'custom'>, context: MessageContext): string {
  const order = orderSummary(context);
  const brand = context.restaurantName;
  switch (template) {
    case 'confirmation': return `${greeting(context)} Confirmamos o ${order}. ${deadline(context)} — ${brand}`;
    case 'preparing': return `${greeting(context)} O ${order} já está em preparo. Em breve enviaremos uma nova atualização. — ${brand}`;
    case 'ready': return `${greeting(context)} O ${order} está pronto${context.deliveryMethod === 'pickup' ? ' para retirada' : ' e será encaminhado para entrega'}. — ${brand}`;
    case 'out_for_delivery': return `${greeting(context)} O ${order} saiu para entrega e chegará em breve. — ${brand}`;
    case 'delivered': return `${greeting(context)} Finalizamos o ${order}. Agradecemos a preferência e esperamos que aproveite! — ${brand}`;
    case 'cancelled': return `${greeting(context)} O ${order} foi cancelado. Se precisar de ajuda ou quiser fazer um novo pedido, estamos à disposição. — ${brand}`;
  }
}

export function suggestedTemplate(status: 'new' | 'confirmed' | 'preparing' | 'ready' | 'out_for_delivery' | 'delivered' | 'cancelled'): Exclude<WhatsAppTemplateId, 'custom'> {
  if (status === 'new' || status === 'confirmed') return 'confirmation';
  if (status === 'preparing') return 'preparing';
  if (status === 'ready') return 'ready';
  if (status === 'out_for_delivery') return 'out_for_delivery';
  if (status === 'delivered') return 'delivered';
  return 'cancelled';
}

export function createWhatsAppUrl(phone: string, message: string): string | null {
  const normalized = normalizeBrazilianWhatsApp(phone);
  const text = message.trim();
  if (!normalized || !text || text.length > WHATSAPP_MESSAGE_MAX_LENGTH) return null;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(text)}`;
}
