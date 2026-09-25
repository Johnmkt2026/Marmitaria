export type WhatsAppRuntimeConfig = {
  enabled: boolean;
  accessToken?: string;
  appSecret?: string;
  verifyToken?: string;
  phoneNumberId?: string;
  businessAccountId?: string;
  graphApiVersion: string;
};

export function isWhatsAppIntegrationReady(config: WhatsAppRuntimeConfig): boolean {
  return config.enabled && Boolean(config.accessToken && config.phoneNumberId);
}

export type ParsedInboundMessage = {
  eventKey: string;
  externalMessageId: string;
  businessAccountId: string;
  phoneNumberId: string;
  waId: string;
  phoneE164: string;
  messageType: string;
  contentText: string;
  occurredAt: string;
  payload: Record<string, unknown>;
};

export type ParsedStatusEvent = {
  eventKey: string;
  externalMessageId: string;
  businessAccountId: string;
  phoneNumberId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  occurredAt: string;
  failureCode?: string;
  failureMessage?: string;
  payload: Record<string, unknown>;
};

type WebhookChange = { field?: string; value?: { metadata?: { phone_number_id?: string }; messages?: unknown[]; statuses?: unknown[] } };
type WebhookEntry = { id?: string; changes?: WebhookChange[] };

function timestamp(value: unknown): string {
  const seconds = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : new Date().toISOString();
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function messageText(message: Record<string, unknown>): string {
  const text = object(message.text)?.body;
  if (typeof text === 'string') return text;
  const button = object(message.button)?.text;
  if (typeof button === 'string') return button;
  const interactive = object(message.interactive);
  const reply = object(interactive?.button_reply) ?? object(interactive?.list_reply);
  if (typeof reply?.title === 'string') return reply.title;
  return '';
}

export function parseWebhookPayload(payload: unknown): { inbound: ParsedInboundMessage[]; statuses: ParsedStatusEvent[] } {
  const root = object(payload);
  const inbound: ParsedInboundMessage[] = [];
  const statuses: ParsedStatusEvent[] = [];
  if (root?.object !== 'whatsapp_business_account' || !Array.isArray(root.entry)) return { inbound, statuses };
  for (const rawEntry of root.entry as WebhookEntry[]) {
    if (typeof rawEntry.id !== 'string' || !rawEntry.id) continue;
    for (const change of rawEntry.changes ?? []) {
      if (change.field !== 'messages') continue;
      const phoneNumberId = change.value?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;
      for (const rawMessage of change.value?.messages ?? []) {
        const message = object(rawMessage);
        if (!message || typeof message.id !== 'string' || typeof message.from !== 'string') continue;
        const type = typeof message.type === 'string' ? message.type : 'unknown';
        inbound.push({
          eventKey: `message:${message.id}`,
          externalMessageId: message.id,
          businessAccountId: rawEntry.id,
          phoneNumberId,
          waId: message.from,
          phoneE164: `+${message.from}`,
          messageType: ['text','image','document','audio','video','location','interactive','reaction'].includes(type) ? type : 'unknown',
          contentText: messageText(message),
          occurredAt: timestamp(message.timestamp),
          payload: { id: message.id, type, timestamp: message.timestamp },
        });
      }
      for (const rawStatus of change.value?.statuses ?? []) {
        const status = object(rawStatus);
        if (!status || typeof status.id !== 'string' || !['sent','delivered','read','failed'].includes(String(status.status))) continue;
        const errors = Array.isArray(status.errors) ? object(status.errors[0]) : null;
        statuses.push({
          eventKey: `status:${status.id}:${String(status.status)}:${String(status.timestamp ?? '')}`,
          externalMessageId: status.id,
          businessAccountId: rawEntry.id,
          phoneNumberId,
          status: status.status as ParsedStatusEvent['status'],
          occurredAt: timestamp(status.timestamp),
          failureCode: errors?.code === undefined ? undefined : String(errors.code),
          failureMessage: typeof errors?.title === 'string' ? errors.title : undefined,
          payload: { id: status.id, status: status.status, timestamp: status.timestamp, errors: status.errors },
        });
      }
    }
  }
  return { inbound, statuses };
}

export async function verifyMetaSignature(rawBody: string, signature: string | null, appSecret: string): Promise<boolean> {
  if (!signature?.startsWith('sha256=') || !appSecret) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)));
  const expected = `sha256=${Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')}`;
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) mismatch |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  return mismatch === 0;
}

export function verifySharedSecret(provided: string | null, expected: string): boolean {
  if (!provided || !expected || provided.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) mismatch |= provided.charCodeAt(index) ^ expected.charCodeAt(index);
  return mismatch === 0;
}

function metaRecipient(value: string): string {
  const recipient = value.startsWith('+') ? value.slice(1) : value;
  if (!/^[1-9][0-9]{7,19}$/.test(recipient)) throw new Error('invalid_recipient');
  return recipient;
}

export function buildMetaTextPayload(recipient: string, contentText: string) {
  return { messaging_product: 'whatsapp', recipient_type: 'individual', to: metaRecipient(recipient), type: 'text', text: { preview_url: false, body: contentText } };
}
export function buildMetaTemplatePayload(recipient: string, templateName: string, language: string, components: unknown[] = []) {
  return { messaging_product: 'whatsapp', recipient_type: 'individual', to: metaRecipient(recipient), type: 'template',
    template: { name: templateName, language: { code: language }, components } };
}

export function classifyProviderFailure(status: number): { retryable: boolean; code: string } {
  return { retryable: status === 408 || status === 429 || status >= 500, code: `http_${status}` };
}

export function providerFailureMessage(status: number): string {
  if (status === 429) return 'Limite temporário de envio atingido. A mensagem será tentada novamente.';
  if (status === 408 || status >= 500) return 'Serviço do WhatsApp temporariamente indisponível.';
  if (status === 400 || status === 404) return 'Número ou modelo indisponível para envio.';
  if (status === 401 || status === 403) return 'Configuração da integração recusada pela Meta.';
  return 'A Meta recusou esta mensagem.';
}

export function retryDelaySeconds(attempt: number): number {
  return Math.min(3600, 30 * 2 ** Math.max(1, attempt));
}

export type ProviderResult = { ok: true; externalMessageId: string } | { ok: false; disabled?: boolean; retryable: boolean; code: string; message: string };
export interface WhatsAppProvider {
  sendText(phoneE164: string, contentText: string): Promise<ProviderResult>;
  sendTemplate(phoneE164: string, templateName: string, language: string, components?: unknown[]): Promise<ProviderResult>;
}

export class DisabledWhatsAppProvider implements WhatsAppProvider {
  async sendText(phoneE164?: string, contentText?: string): Promise<ProviderResult> {
    void phoneE164; void contentText;
    return { ok: false, disabled: true, retryable: false, code: 'integration_disabled', message: 'Integração oficial ainda não configurada' };
  }
  async sendTemplate(): Promise<ProviderResult> { return this.sendText(); }
}

export class MetaWhatsAppProvider implements WhatsAppProvider {
  private readonly config: WhatsAppRuntimeConfig;
  private readonly fetcher: typeof fetch;
  constructor(config: WhatsAppRuntimeConfig, fetcher: typeof fetch = fetch) { this.config = config; this.fetcher = fetcher; }
  async sendText(phoneE164: string, contentText: string): Promise<ProviderResult> {
    if (!this.config.enabled || !this.config.accessToken || !this.config.phoneNumberId) return new DisabledWhatsAppProvider().sendText(phoneE164, contentText);
    try {
      return await this.sendPayload(buildMetaTextPayload(phoneE164, contentText));
    } catch { return { ok: false, retryable: true, code: 'network_error', message: 'Falha temporária de rede' }; }
  }
  async sendTemplate(phoneE164: string, templateName: string, language: string, components: unknown[] = []): Promise<ProviderResult> {
    if (!this.config.enabled || !this.config.accessToken || !this.config.phoneNumberId) return new DisabledWhatsAppProvider().sendTemplate();
    try { return await this.sendPayload(buildMetaTemplatePayload(phoneE164, templateName, language, components)); }
    catch { return { ok: false, retryable: true, code: 'network_error', message: 'Falha temporária de rede' }; }
  }
  private async sendPayload(payload: unknown): Promise<ProviderResult> {
      const response = await this.fetcher(`https://graph.facebook.com/${this.config.graphApiVersion}/${this.config.phoneNumberId}/messages`, {
        method: 'POST', headers: { authorization: `Bearer ${this.config.accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(10_000), });
      const body = await response.json().catch(() => ({})) as { messages?: { id?: string }[]; error?: { code?: number; message?: string } };
      const externalMessageId = body.messages?.[0]?.id;
      if (response.ok && externalMessageId) return { ok: true, externalMessageId };
      const classification = classifyProviderFailure(response.status);
      return { ok: false, ...classification, message: providerFailureMessage(response.status) };
  }
}

export function createProvider(config: WhatsAppRuntimeConfig, fetcher: typeof fetch = fetch): WhatsAppProvider {
  return isWhatsAppIntegrationReady(config) ? new MetaWhatsAppProvider(config, fetcher) : new DisabledWhatsAppProvider();
}
