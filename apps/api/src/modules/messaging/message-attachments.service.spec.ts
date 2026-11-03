import { MessageAttachmentsService } from './message-attachments.service';
import { FakeProvider } from './providers/fake.provider';
import { MessageChannel } from '@realfy/shared';

describe('MessageAttachmentsService', () => {
  const receipts = { pdf: jest.fn().mockResolvedValue({ buffer: Buffer.from('r'), filename: 'recibo-00000001.pdf' }) };
  const statements = { pdf: jest.fn().mockResolvedValue({ buffer: Buffer.from('s'), filename: 'estado-de-cuenta-ana-2026-10-ARS.pdf' }) };
  const liquidaciones = { generatePdf: jest.fn().mockResolvedValue(Buffer.from('l')) };
  const service = new MessageAttachmentsService(receipts as any, statements as any, liquidaciones as any);

  it('sabe qué documento lleva cada plantilla', () => {
    expect(service.kindFor('receipt')).toBe('Receipt');
    expect(service.kindFor('owner_statement')).toBe('OwnerStatement');
    expect(service.kindFor('liquidacion')).toBe('Liquidacion');
    expect(service.kindFor('ticket_status')).toBeUndefined();
    expect(service.kindFor('desconocida')).toBeUndefined();
  });

  it('genera el PDF de cada documento al despachar', async () => {
    expect(await service.resolve('Receipt', 'r-1')).toEqual({
      filename: 'recibo-00000001.pdf',
      content: Buffer.from('r'),
      mimeType: 'application/pdf',
    });
    expect((await service.resolve('OwnerStatement', 's-1')).filename).toBe('estado-de-cuenta-ana-2026-10-ARS.pdf');
    expect((await service.resolve('Liquidacion', 'l-1')).filename).toBe('liquidacion-l-1.pdf');
    expect(receipts.pdf).toHaveBeenCalledWith('r-1');
    expect(statements.pdf).toHaveBeenCalledWith('s-1');
    expect(liquidaciones.generatePdf).toHaveBeenCalledWith('l-1');
  });
});

describe('FakeProvider', () => {
  it('guarda lo enviado, puede fallar a pedido y se reinicia', async () => {
    const p = new FakeProvider(MessageChannel.Email);
    p.failNext('boom', false);
    const msg = { id: 'm', channel: MessageChannel.Email, to: 'a@example.com', templateKey: 'receipt', vars: {}, idempotencyKey: 'k' };
    expect(await p.send(msg)).toEqual({ ok: false, error: 'boom', retryable: false });
    expect((await p.send(msg)).ok).toBe(true);
    expect(p.sent).toHaveLength(1);
    p.configured = false;
    p.reset();
    expect(p.sent).toHaveLength(0);
    expect(p.isConfigured()).toBe(true);
  });
});
