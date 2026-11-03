import { NotFoundException } from '@nestjs/common';
import { BillChannel } from '@realfy/shared';
import { AsyncLocalStorage } from 'async_hooks';
import { ClsService } from 'nestjs-cls';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { BillMailService, tenantSlugFromAddress } from './bill-mail.service';
import { simplePdf } from './bill-pdf.testing';

const b64 = (b: Buffer) => b.toString('base64');

function build(tenant: { id: string } | null = { id: 'tenant-1' }) {
  const cls = new ClsService(new AsyncLocalStorage());
  const tenantContext = new TenantContextService(cls);
  const prisma = { baseClient: { tenant: { findFirst: jest.fn().mockResolvedValue(tenant) } } };
  const seen: (string | undefined)[] = [];
  const intake = {
    intake: jest.fn(async (..._args: unknown[]) => {
      seen.push(tenantContext.getTenantId());
      return { duplicate: false, document: { id: 'doc-1', status: 'Procesada', reason: null, billIds: [] } };
    }),
    intakeWithoutAttachment: jest.fn(async () => ({ duplicate: false, document: { id: 'doc-2', status: 'RequiereRevision', reason: 'NO_ATTACHMENT', billIds: [] } })),
  };
  const service = new BillMailService(prisma as never, cls, tenantContext, intake as never);
  return { service, prisma, intake, seen };
}

const mail = (extra: Record<string, unknown> = {}) => ({
  tenantSlug: 'demo',
  messageId: '<m1@demo.test>',
  from: 'facturas@proveedor.test',
  subject: 'Su factura',
  attachments: [],
  ...extra,
});

describe('tenantSlugFromAddress', () => {
  it.each([
    ['boletas+demo@realfy.test', 'demo'],
    ['Boletas+Demo-2@realfy.test', 'demo-2'],
    [' boletas+demo@x.test ', 'demo'],
  ])('%s -> %s', (address, slug) => expect(tenantSlugFromAddress(address)).toBe(slug));

  it.each(['consultas@realfy.test', 'boletas@realfy.test', '', undefined])('%s no trae inmobiliaria', (address) => {
    expect(tenantSlugFromAddress(address)).toBeNull();
  });
});

describe('BillMailService', () => {
  it('cada PDF adjunto entra al circuito con canal Mail, dentro del contexto de la inmobiliaria de la casilla', async () => {
    const { service, intake, seen, prisma } = build();
    const result = await service.ingest(mail({ attachments: [{ filename: 'f1.pdf', contentBase64: b64(simplePdf(['a'])) }, { filename: 'f2.pdf', contentBase64: b64(simplePdf(['b'])) }] }));
    expect(result).toMatchObject({ received: true, documents: [{ id: 'doc-1' }, { id: 'doc-1' }] });
    expect(intake.intake).toHaveBeenCalledTimes(2);
    expect(intake.intake.mock.calls[0][0]).toMatchObject({ channel: BillChannel.Mail, origin: 'facturas@proveedor.test', fileName: 'f1.pdf' });
    expect(seen).toEqual(['tenant-1', 'tenant-1']);
    expect(prisma.baseClient.tenant.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { slug: 'demo', isActive: true } }));
  });

  it('la inmobiliaria también sale de la dirección de destino boletas+slug@', async () => {
    const { service, prisma } = build();
    await service.ingest(mail({ tenantSlug: undefined, to: 'boletas+demo@realfy.test' }));
    expect(prisma.baseClient.tenant.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { slug: 'demo', isActive: true } }));
  });

  it('sin PDF (sin adjuntos, adjuntos que no son PDF, vacíos o enormes) queda un documento para revisión', async () => {
    const { service, intake } = build();
    const big = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(10 * 1024 * 1024)]);
    await service.ingest(
      mail({
        attachments: [
          { filename: 'foto.png', contentBase64: b64(Buffer.from('PNG')) },
          { filename: 'vacio.pdf', contentBase64: 'AAAA' },
          { filename: 'enorme.pdf', contentBase64: b64(big) },
        ],
      }),
    );
    expect(intake.intake).not.toHaveBeenCalled();
    expect(intake.intakeWithoutAttachment).toHaveBeenCalledWith({
      channel: BillChannel.Mail,
      origin: 'facturas@proveedor.test',
      messageKey: 'tenant-1:<m1@demo.test>',
      subject: 'Su factura',
    });
  });

  it('inmobiliaria desconocida o inactiva: 404', async () => {
    await expect(build(null).service.ingest(mail())).rejects.toBeInstanceOf(NotFoundException);
    await expect(build().service.ingest(mail({ tenantSlug: undefined, to: 'otra@x.test' }))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('un remitente inválido o automático se ignora sin tocar el circuito', async () => {
    const { service, intake } = build();
    await expect(service.ingest(mail({ from: 'sin-arroba' }))).resolves.toEqual({ received: true, ignored: 'invalid-sender', documents: [] });
    await expect(service.ingest(mail({ from: 'no-reply@proveedor.test' }))).resolves.toEqual({ received: true, ignored: 'automatic', documents: [] });
    expect(intake.intake).not.toHaveBeenCalled();
    expect(intake.intakeWithoutAttachment).not.toHaveBeenCalled();
  });

  it('un cuerpo inválido es 400', async () => {
    await expect(build().service.ingest({ messageId: 'x' })).rejects.toMatchObject({ status: 400 });
  });
});
