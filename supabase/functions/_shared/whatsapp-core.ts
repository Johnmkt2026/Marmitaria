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

export type WhatsAppMessageOrigin = 'cloud_api' | 'business_app' | 'history';
export type ParsedPassiveMessage = {
  eventKey: string;
  externalMessageId: string;
  businessAccountId: string;
  phoneNumberId: string;
  waId: string;
  phoneE164: string;
  direction: 'inbound' | 'outbound';
  origin: Extract<WhatsAppMessageOrigin, 'business_app' | 'history'>;
  messageType: string;
  contentText: string;
  status: 'received' | 'sent' | 'delivered' | 'read' | 'failed';
  occurredAt: string;
  payload: Record<string, unknown>;
};
export type ParsedAccountUpdate = {
  eventKey: string; businessAccountId: string; event: string; businessPhoneNumber?: string;
  occurredAt: string; disconnectionReason?: string; initiatedBy?: string; payload: Record<string, unknown>;
};
export type ParsedSyncProgress = {
  eventKey: string; businessAccountId: string; phoneNumberId: string; syncType: 'history' | 'contacts';
  externalBatchId: string; state: 'processing' | 'completed' | 'failed'; phase?: string; progress?: number;
  itemsProcessed: number; failureCode?: string; failureMessage?: string; payload: Record<string, unknown>;
};
export type ParsedContactSync = {
  eventKey: string; businessAccountId: string; phoneNumberId: string; waId: string; phoneE164: string;
  displayName?: string; action: 'add' | 'remove'; occurredAt: string; payload: Record<string, unknown>;
};
export type ParsedUnknownEvent = {
  eventKey: string; businessAccountId: string; phoneNumberId?: string; field: string; payload: Record<string, unknown>;
};
export type ParsedChangeIdentity = { businessAccountId: string; phoneNumberId?: string; field: string };
export type ParsedWebhookPayload = {
  inbound: ParsedInboundMessage[]; statuses: ParsedStatusEvent[]; passiveMessages: ParsedPassiveMessage[];
  accountUpdates: ParsedAccountUpdate[]; syncProgress: ParsedSyncProgress[]; contacts: ParsedContactSync[];
  unknown: ParsedUnknownEvent[]; identities: ParsedChangeIdentity[];
};

type WebhookValue = {
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  messages?: unknown[]; statuses?: unknown[]; message_echoes?: unknown[]; history?: unknown[]; state_sync?: unknown[];
  errors?: unknown[]; phone_number?: string; event?: string; disconnection_info?: unknown; waba_info?: unknown;
};
type WebhookChange = { field?: string; value?: WebhookValue };
type WebhookEntry = { id?: string; time?: unknown; changes?: WebhookChange[] };

function timestamp(value: unknown): string {
  const seconds = typeof value === 'number' && Number.isFinite(value)
    ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
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
  for (const key of ['image','document','video'] as const) {
    const caption = object(message[key])?.caption;
    if (typeof caption === 'string') return caption;
  }
  return '';
}

function digits(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const result = value.replace(/\D/g, '');
  return /^[1-9][0-9]{7,19}$/.test(result) ? result : null;
}

function messageType(value: unknown): string {
  const type = typeof value === 'string' ? value : 'unknown';
  return ['text','image','document','audio','video','location','interactive','reaction','media_placeholder'].includes(type) ? type : 'unknown';
}

function historyStatus(value: unknown, direction: 'inbound' | 'outbound'): ParsedPassiveMessage['status'] {
  if (direction === 'inbound') return 'received';
  const normalized = typeof value === 'string' ? value.toLowerCase() : '';
  if (normalized === 'read' || normalized === 'played') return 'read';
  if (normalized === 'delivered') return 'delivered';
  if (normalized === 'error') return 'failed';
  return 'sent';
}

export function parseWebhookPayload(payload: unknown): ParsedWebhookPayload {
  const root = object(payload);
  const inbound: ParsedInboundMessage[] = [];
  const statuses: ParsedStatusEvent[] = [];
  const passiveMessages: ParsedPassiveMessage[] = [];
  const accountUpdates: ParsedAccountUpdate[] = [];
  const syncProgress: ParsedSyncProgress[] = [];
  const contacts: ParsedContactSync[] = [];
  const unknown: ParsedUnknownEvent[] = [];
  const identities: ParsedChangeIdentity[] = [];
  const empty = { inbound, statuses, passiveMessages, accountUpdates, syncProgress, contacts, unknown, identities };
  if (root?.object !== 'whatsapp_business_account' || !Array.isArray(root.entry)) return empty;
  for (const [entryIndex, rawEntry] of (root.entry as WebhookEntry[]).entries()) {
    if (typeof rawEntry.id !== 'string' || !rawEntry.id) continue;
    for (const [changeIndex, change] of (rawEntry.changes ?? []).entries()) {
      const field = typeof change.field === 'string' ? change.field : 'unknown';
      const phoneNumberId = change.value?.metadata?.phone_number_id;
      const wabaInfo = object(change.value?.waba_info);
      const businessAccountId = field === 'account_update' && typeof wabaInfo?.waba_id === 'string'
        ? wabaInfo.waba_id : rawEntry.id;
      identities.push({ businessAccountId, phoneNumberId, field });
      if (field === 'messages' && phoneNumberId) {
        for (const rawMessage of change.value?.messages ?? []) {
          const message = object(rawMessage); const from = digits(message?.from);
          if (!message || typeof message.id !== 'string' || !from) continue;
          const type = messageType(message.type);
          inbound.push({ eventKey: `message:${message.id}`, externalMessageId: message.id,
            businessAccountId: rawEntry.id, phoneNumberId, waId: from, phoneE164: `+${from}`,
            messageType: type, contentText: messageText(message), occurredAt: timestamp(message.timestamp),
            payload: { id: message.id, type, timestamp: message.timestamp } });
        }
        for (const rawStatus of change.value?.statuses ?? []) {
          const status = object(rawStatus);
          if (!status || typeof status.id !== 'string' || !['sent','delivered','read','failed'].includes(String(status.status))) continue;
          const errors = Array.isArray(status.errors) ? object(status.errors[0]) : null;
          statuses.push({ eventKey: `status:${status.id}:${String(status.status)}:${String(status.timestamp ?? '')}`,
            externalMessageId: status.id, businessAccountId: rawEntry.id, phoneNumberId,
            status: status.status as ParsedStatusEvent['status'], occurredAt: timestamp(status.timestamp),
            failureCode: errors?.code === undefined ? undefined : String(errors.code),
            failureMessage: typeof errors?.title === 'string' ? errors.title : undefined,
            payload: { id: status.id, status: status.status, timestamp: status.timestamp,
              error_code: errors?.code, error_title: errors?.title } });
        }
        continue;
      }
      if (field === 'account_update') {
        const details = object(change.value?.disconnection_info);
        const event = typeof change.value?.event === 'string' ? change.value.event : 'UNKNOWN';
        accountUpdates.push({ eventKey: `account:${businessAccountId}:${event}:${String(rawEntry.time ?? '')}`,
          businessAccountId, event,
          businessPhoneNumber: digits(change.value?.phone_number) ?? undefined,
          occurredAt: timestamp(rawEntry.time),
          disconnectionReason: typeof details?.reason === 'string' ? details.reason : undefined,
          initiatedBy: typeof details?.initiated_by === 'string' ? details.initiated_by : undefined,
          payload: { field, event, reason: details?.reason, initiated_by: details?.initiated_by, timestamp: rawEntry.time } });
        continue;
      }
      if (field === 'history' && phoneNumberId) {
        const businessPhone = digits(change.value?.metadata?.display_phone_number);
        const valueError = Array.isArray(change.value?.errors) ? object(change.value.errors[0]) : null;
        if (valueError) {
          const failureCode = valueError.code === undefined ? undefined : String(valueError.code);
          const batch = `history:${phoneNumberId}:error:${String(rawEntry.time ?? changeIndex)}`;
          syncProgress.push({ eventKey: `sync:${batch}`, businessAccountId: rawEntry.id, phoneNumberId,
            syncType: 'history', externalBatchId: batch, state: 'failed', itemsProcessed: 0, failureCode,
            failureMessage: typeof valueError.message === 'string' ? valueError.message : undefined,
            payload: { field, error_code: failureCode, timestamp: rawEntry.time } });
        }
        for (const [historyIndex, rawHistory] of (change.value?.history ?? []).entries()) {
          const history = object(rawHistory); const meta = object(history?.metadata);
          const errors = Array.isArray(history?.errors) ? object(history.errors[0]) : null;
          const phase = meta?.phase === undefined ? undefined : String(meta.phase);
          const chunk = meta?.chunk_order === undefined ? historyIndex : Number(meta.chunk_order);
          const parsedProgress = typeof meta?.progress === 'number' ? meta.progress
            : typeof meta?.progress === 'string' && /^\d+$/.test(meta.progress) ? Number(meta.progress) : undefined;
          const progress = parsedProgress !== undefined && parsedProgress >= 0 && parsedProgress <= 100 ? parsedProgress : undefined;
          const batch = `history:${phoneNumberId}:${String(rawEntry.time ?? 'no-time')}:${phase ?? 'error'}:${chunk}`;
          let itemCount = 0;
          for (const rawThread of Array.isArray(history?.threads) ? history.threads : []) {
            const thread = object(rawThread); const threadWaId = digits(thread?.id);
            if (!threadWaId) continue;
            for (const rawMessage of Array.isArray(thread?.messages) ? thread.messages : []) {
              const message = object(rawMessage); const from = digits(message?.from);
              if (!message || typeof message.id !== 'string' || !from) continue;
              const to = digits(message.to);
              const direction = businessPhone ? (from === businessPhone ? 'outbound' : 'inbound')
                : from === threadWaId ? 'inbound' : to === threadWaId ? 'outbound' : 'inbound';
              const waId = direction === 'outbound' ? to ?? threadWaId : threadWaId;
              if (!waId) continue;
              const type = messageType(message.type); const context = object(message.history_context);
              passiveMessages.push({ eventKey: `history-message:${message.id}`, externalMessageId: message.id,
                businessAccountId: rawEntry.id, phoneNumberId, waId, phoneE164: `+${waId}`, direction,
                origin: 'history', messageType: type, contentText: messageText(message),
                status: historyStatus(context?.status, direction), occurredAt: timestamp(message.timestamp),
                payload: { id: message.id, type, timestamp: message.timestamp, history_status: context?.status,
                  phase, chunk_order: chunk } });
              itemCount += 1;
            }
          }
          const failureCode = errors?.code === undefined ? undefined : String(errors.code);
          syncProgress.push({ eventKey: `sync:${batch}`, businessAccountId: rawEntry.id, phoneNumberId,
            syncType: 'history', externalBatchId: batch,
            state: failureCode ? 'failed' : progress === 100 ? 'completed' : 'processing', phase, progress,
            itemsProcessed: itemCount, failureCode,
            failureMessage: typeof errors?.message === 'string' ? errors.message : undefined,
            payload: { field, phase, chunk_order: chunk, progress, error_code: failureCode } });
        }
        for (const rawMessage of change.value?.messages ?? []) {
          const message = object(rawMessage); const from = digits(message?.from);
          if (!message || typeof message.id !== 'string' || !from) continue;
          const direction = businessPhone && from === businessPhone ? 'outbound' : 'inbound';
          const waId = direction === 'outbound' ? digits(message.to) : from;
          if (!waId) continue;
          const type = messageType(message.type);
          passiveMessages.push({ eventKey: `history-media:${message.id}`, externalMessageId: message.id,
            businessAccountId: rawEntry.id, phoneNumberId, waId, phoneE164: `+${waId}`, direction,
            origin: 'history', messageType: type, contentText: messageText(message),
            status: historyStatus(undefined,direction), occurredAt: timestamp(message.timestamp),
            payload: { id: message.id, type, timestamp: message.timestamp, media_asset: true } });
        }
        continue;
      }
      if (field === 'smb_message_echoes' && phoneNumberId) {
        for (const rawEcho of change.value?.message_echoes ?? []) {
          const message = object(rawEcho); const waId = digits(message?.to);
          if (!message || typeof message.id !== 'string' || !waId) continue;
          const type = messageType(message.type);
          passiveMessages.push({ eventKey: `business-app-message:${message.id}`, externalMessageId: message.id,
            businessAccountId: rawEntry.id, phoneNumberId, waId, phoneE164: `+${waId}`, direction: 'outbound',
            origin: 'business_app', messageType: type, contentText: messageText(message), status: 'sent',
            occurredAt: timestamp(message.timestamp), payload: { id: message.id, type, timestamp: message.timestamp } });
        }
        continue;
      }
      if (field === 'smb_app_state_sync' && phoneNumberId) {
        let itemCount = 0;
        for (const rawState of change.value?.state_sync ?? []) {
          const state = object(rawState); const contact = object(state?.contact); const meta = object(state?.metadata);
          if (state?.type !== 'contact') continue;
          const waId = digits(contact?.phone_number); const action = state.action === 'remove' ? 'remove' : ['add','update'].includes(String(state.action)) ? 'add' : null;
          if (!waId || !action) continue;
          const occurredAt = timestamp(meta?.timestamp);
          contacts.push({ eventKey: `contact:${phoneNumberId}:${waId}:${action}:${String(meta?.timestamp ?? '')}`,
            businessAccountId: rawEntry.id, phoneNumberId, waId, phoneE164: `+${waId}`,
            displayName: typeof contact?.full_name === 'string' ? contact.full_name : typeof contact?.first_name === 'string' ? contact.first_name : undefined,
            action, occurredAt, payload: { field, action, wa_id: waId, timestamp: meta?.timestamp } });
          itemCount += 1;
        }
        syncProgress.push({ eventKey: `sync:contacts:${phoneNumberId}:${String(rawEntry.time ?? changeIndex)}`,
          businessAccountId: rawEntry.id, phoneNumberId, syncType: 'contacts',
          externalBatchId: `contacts:${phoneNumberId}:${String(rawEntry.time ?? changeIndex)}`, state: 'completed', itemsProcessed: itemCount,
          payload: { field, items: itemCount, timestamp: rawEntry.time } });
        continue;
      }
      unknown.push({ eventKey: `unknown:${rawEntry.id}:${field.slice(0,80)}:${String(rawEntry.time ?? '')}:${entryIndex}:${changeIndex}`,
        businessAccountId: rawEntry.id, phoneNumberId, field,
        payload: { field, timestamp: rawEntry.time, has_metadata: Boolean(change.value?.metadata) } });
    }
  }
  return empty;
}

export function validateWebhookIdentity(identities: ParsedChangeIdentity[], expectedBusinessAccountId: string, expectedPhoneNumberId: string): boolean {
  if (expectedBusinessAccountId && identities.some(identity => identity.businessAccountId !== expectedBusinessAccountId)) return false;
  if (expectedPhoneNumberId && identities.some(identity => identity.phoneNumberId && identity.phoneNumberId !== expectedPhoneNumberId)) return false;
  return true;
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
