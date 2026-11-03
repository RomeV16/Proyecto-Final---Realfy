import { MESSAGE_TEMPLATES, MessageChannel, type MessageTemplateKey } from '@realfy/shared';
import type { MessagingConfigService } from '../../../common/messaging/messaging-config.service';
import { whatsappFreeText, whatsappParams } from '../../../common/messaging/message-templates';
import type { MessageProvider, OutgoingMessage, ProviderResult } from './message-provider';

/** Códigos de la Cloud API que indican un límite de envío: se reintenta más tarde. */
const RATE_LIMIT_CODES = new Set([4, 80007, 130429, 131048, 131056]);

/** Corte de cada llamada a la Graph API. */
const TIMEOUT_MS = 15_000;

type Fetch = typeof fetch;

interface GraphError {
  error?: { message?: string; code?: number; error_subcode?: number; type?: string };
}

/**
 * WhatsApp Business Cloud API (Graph API de Meta). Fuera de la ventana de 24
 * horas de una conversación solo se pueden mandar plantillas aprobadas: cada
 * mensaje es una plantilla de utilidad por nombre e idioma, con los parámetros
 * del cuerpo en orden y, si lleva PDF, el documento como encabezado (se sube
 * antes a /media).
 * https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates
 */
export class WhatsAppCloudProvider implements MessageProvider {
  readonly channel = MessageChannel.WhatsApp;
  readonly name = 'whatsapp-cloud';

  constructor(
    private readonly config: MessagingConfigService,
    private readonly http: Fetch = fetch,
  ) {}

  isConfigured(): boolean {
    return this.config.whatsappConfigured();
  }

  async send(message: OutgoingMessage): Promise<ProviderResult> {
    const info = MESSAGE_TEMPLATES[message.templateKey as MessageTemplateKey];
    if (info?.freeForm) return this.sendText(message);
    const template = info?.whatsapp;
    if (!template) return { ok: false, error: `WHATSAPP_TEMPLATE_MISSING: ${message.templateKey}`, retryable: false };

    try {
      const components: unknown[] = [];
      if (message.attachment) {
        const upload = await this.uploadMedia(message.attachment.content, message.attachment.mimeType, message.attachment.filename);
        if (!upload.ok) return upload;
        components.push({
          type: 'header',
          parameters: [{ type: 'document', document: { id: upload.providerMsgId, filename: message.attachment.filename } }],
        });
      }
      components.push({
        type: 'body',
        parameters: whatsappParams(message.templateKey, message.vars).map((text) => ({ type: 'text', text })),
      });

      const res = await this.call('messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: message.to,
          type: 'template',
          template: { name: template.name, language: { code: template.language }, components },
        }),
      });
      if (!res.ok) return res;
      const id = (res.body as { messages?: { id?: string }[] }).messages?.[0]?.id;
      return id ? { ok: true, providerMsgId: id } : { ok: false, error: 'WhatsApp did not return a message id', retryable: true };
    } catch (err) {
      return { ok: false, error: `NETWORK: ${(err as Error).message}`, retryable: true };
    }
  }

  /**
   * Mensaje de texto libre: solo vale dentro de la ventana de 24 horas desde el último
   * mensaje de la persona (la bandeja lo verifica al encolar); fuera de ella Meta lo
   * rechaza (131047) y queda fallido, sin reintentos.
   */
  private async sendText(message: OutgoingMessage): Promise<ProviderResult> {
    try {
      const res = await this.call('messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: message.to,
          type: 'text',
          text: { preview_url: false, body: whatsappFreeText(message.vars) },
        }),
      });
      if (!res.ok) return res;
      const id = (res.body as { messages?: { id?: string }[] }).messages?.[0]?.id;
      return id ? { ok: true, providerMsgId: id } : { ok: false, error: 'WhatsApp did not return a message id', retryable: true };
    } catch (err) {
      return { ok: false, error: `NETWORK: ${(err as Error).message}`, retryable: true };
    }
  }

  /** Sube el PDF y devuelve el id del medio (en `providerMsgId`). */
  private async uploadMedia(content: Buffer, mimeType: string, filename: string): Promise<ProviderResult> {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', mimeType);
    form.append('file', new Blob([new Uint8Array(content)], { type: mimeType }), filename);
    const res = await this.call('media', { method: 'POST', body: form });
    if (!res.ok) return res;
    const id = (res.body as { id?: string }).id;
    return id ? { ok: true, providerMsgId: id } : { ok: false, error: 'WhatsApp did not return a media id', retryable: true };
  }

  private async call(
    path: 'messages' | 'media',
    init: { method: string; headers?: Record<string, string>; body: string | FormData },
  ): Promise<{ ok: true; body: unknown } | { ok: false; error: string; retryable: boolean }> {
    const { token, phoneNumberId, graphVersion } = this.config.whatsapp;
    const res = await this.http(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => ({}))) as GraphError;
    if (res.ok) return { ok: true, body };
    const code = body.error?.code;
    const error = `WHATSAPP_${res.status}${code ? `_${code}` : ''}: ${body.error?.message ?? res.statusText}`;
    const retryable = res.status >= 500 || res.status === 429 || (code !== undefined && RATE_LIMIT_CODES.has(code));
    return { ok: false, error, retryable };
  }
}
