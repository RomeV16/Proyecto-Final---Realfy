import type { MessageChannel } from '@realfy/shared';
import type { MessageVars } from '../../../common/messaging/message-templates';

/** Documento adjunto, ya generado al despachar. */
export interface MessageAttachment {
  filename: string;
  content: Buffer;
  mimeType: string;
}

/** Lo que el despacho le pasa a un proveedor. */
export interface OutgoingMessage {
  id: string;
  channel: MessageChannel;
  to: string;
  templateKey: string;
  vars: MessageVars;
  idempotencyKey: string;
  attachment?: MessageAttachment;
}

/**
 * Resultado de un envío. Un proveedor no lanza: un error de red o un 5xx es
 * `retryable` y el despacho lo reintenta con espera creciente; un rechazo del
 * proveedor (dirección inválida, plantilla inexistente) no se reintenta.
 */
export type ProviderResult =
  | { ok: true; providerMsgId: string }
  | { ok: false; error: string; retryable: boolean };

export interface MessageProvider {
  readonly channel: MessageChannel;
  /** Nombre corto para el log y la pantalla (resend, whatsapp-cloud, fake). */
  readonly name: string;
  /** Hay credenciales: sin ellas el despacho deja los mensajes pendientes. */
  isConfigured(): boolean;
  send(message: OutgoingMessage): Promise<ProviderResult>;
}

/** Token de inyección de la lista de proveedores, uno por canal. */
export const MESSAGE_PROVIDERS = Symbol('MESSAGE_PROVIDERS');
