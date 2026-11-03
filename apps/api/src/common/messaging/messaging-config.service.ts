import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseAllowlist, parseMessagingMode, type MessagingMode } from '@realfy/shared';

/** Remitente por defecto si el ambiente no define RESEND_FROM. */
const DEFAULT_FROM = 'noreply@realfy.com.ar';
const DEFAULT_GRAPH_VERSION = 'v21.0';

/**
 * Configuración de la mensajería de un ambiente (ADR-0013). Se lee en cada
 * consulta: cambiar una variable y reiniciar alcanza, y las pruebas pueden
 * cambiarla sin rearmar el módulo.
 *
 * El modo por defecto es `off`: sin MESSAGING_MODE, o con un valor que no se
 * reconoce, no sale ningún mensaje (falla cerrado).
 */
@Injectable()
export class MessagingConfigService {
  constructor(private readonly config: ConfigService) {}

  private read(key: string): string | undefined {
    const value = this.config.get<string>(key);
    return value?.trim() ? value.trim() : undefined;
  }

  get mode(): MessagingMode {
    return parseMessagingMode(this.read('MESSAGING_MODE'));
  }

  get allowlist(): Set<string> {
    return parseAllowlist(this.read('MESSAGING_ALLOWLIST'));
  }

  /**
   * Si el modo deja mandar a esta dirección (ya normalizada): `live` a todas,
   * `allowlist` solo a las de la lista, `off` a ninguna. El consentimiento se
   * revisa aparte.
   */
  allowsAddress(address: string): boolean {
    const mode = this.mode;
    if (mode === 'live') return true;
    if (mode === 'allowlist') return this.allowlist.has(address);
    return false;
  }

  get resend() {
    return {
      apiKey: this.read('RESEND_API_KEY'),
      from: this.read('RESEND_FROM') ?? this.read('RESEND_FROM_ADDRESS') ?? DEFAULT_FROM,
      webhookSecret: this.read('RESEND_WEBHOOK_SECRET'),
    };
  }

  get whatsapp() {
    return {
      token: this.read('WHATSAPP_TOKEN'),
      phoneNumberId: this.read('WHATSAPP_PHONE_NUMBER_ID'),
      appSecret: this.read('WHATSAPP_APP_SECRET'),
      verifyToken: this.read('WHATSAPP_VERIFY_TOKEN'),
      graphVersion: this.read('WHATSAPP_GRAPH_VERSION') ?? DEFAULT_GRAPH_VERSION,
    };
  }

  /** Bandeja de consultas: secreto con que se firma el mail reenviado y inmobiliaria dueña del número de WhatsApp. */
  get inbox() {
    return {
      emailIngestSecret: this.read('INBOX_EMAIL_INGEST_SECRET'),
      whatsappTenantSlug: this.read('WHATSAPP_TENANT_SLUG'),
    };
  }

  /** Hay credenciales para mandar por WhatsApp (token y número). */
  whatsappConfigured(): boolean {
    const w = this.whatsapp;
    return Boolean(w.token && w.phoneNumberId);
  }
}
