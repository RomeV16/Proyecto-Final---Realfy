import { randomUUID } from 'node:crypto';
import type { MessageChannel } from '@realfy/shared';
import type { MessageProvider, OutgoingMessage, ProviderResult } from './message-provider';

/**
 * Proveedor de prueba: no sale nada de la máquina. Guarda lo que "mandó" para
 * que las pruebas lo revisen y puede programarse para fallar. Es el que usa la
 * API con NODE_ENV=test, así las pruebas e2e nunca llaman a Resend ni a Meta.
 */
export class FakeProvider implements MessageProvider {
  readonly name = 'fake';
  readonly sent: OutgoingMessage[] = [];
  private readonly failures: Omit<Extract<ProviderResult, { ok: false }>, 'ok'>[] = [];
  configured = true;

  constructor(readonly channel: MessageChannel) {}

  isConfigured(): boolean {
    return this.configured;
  }

  /** El próximo envío falla con este error. */
  failNext(error: string, retryable: boolean): void {
    this.failures.push({ error, retryable });
  }

  reset(): void {
    this.sent.length = 0;
    this.failures.length = 0;
    this.configured = true;
  }

  async send(message: OutgoingMessage): Promise<ProviderResult> {
    const failure = this.failures.shift();
    if (failure) return { ok: false, ...failure };
    this.sent.push(message);
    return { ok: true, providerMsgId: `fake-${this.channel.toLowerCase()}-${randomUUID()}` };
  }
}
