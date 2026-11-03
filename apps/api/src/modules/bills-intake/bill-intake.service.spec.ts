import { BillChannel, BillDocumentStatus } from '@realfy/shared';
import { Prisma } from '@prisma/client';
import { BillIntakeService, toBillInput, toStoredData } from './bill-intake.service';
import { simplePdf } from './bill-pdf.testing';
import { NodePdfTextService } from './bill-pdf.testing';
import {
  aguasStatementLines,
  epecLines,
  muniCurrentLines,
  rentasCurrentLines,
  unknownLines,
} from './providers/bill-text.testing';
import type { FetchedBillData } from '@realfy/shared';

const NOW = new Date('2026-11-03T12:00:00Z');
const TENANT = 'tenant-1';

interface Doc {
  id: string;
  tenantId: string;
  sha256: string;
  status: string;
  reason: string | null;
  serviceId: string | null;
  data?: unknown;
  providerKey?: string | null;
  confidence?: unknown;
  bills: { id: string }[];
}

/** Base en memoria con lo justo que usa el circuito. */
function build(opts: { services?: { id: string; providerKey: string; accountNumber: string }[]; bills?: { id: string; serviceId: string; period: Date; installmentLabel: string; amount: string }[] } = {}) {
  const docs: Doc[] = [];
  const services = opts.services ?? [{ id: 'svc-1', providerKey: 'muni-cordoba', accountNumber: 'I0000001' }];
  const existingBills = opts.bills ?? [];
  const created: unknown[] = [];

  const client: any = {
    billDocument: {
      findFirst: jest.fn(async ({ where }: any) => docs.find((d) => (where.sha256 ? d.sha256 === where.sha256 : d.id === where.id)) ?? null),
      create: jest.fn(async ({ data }: any) => {
        const doc: Doc = { id: `doc-${docs.length + 1}`, status: 'Recibida', reason: null, serviceId: null, bills: [], ...data };
        docs.push(doc);
        return doc;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const doc = docs.find((d) => d.id === where.id)!;
        Object.assign(doc, data);
        return doc;
      }),
    },
    service: {
      findMany: jest.fn(async ({ where }: any) =>
        services.filter(
          (s) =>
            where.accountNumber.in.includes(s.accountNumber) && (!where.providerKey || s.providerKey === where.providerKey),
        ),
      ),
    },
    serviceBill: {
      findFirst: jest.fn(async ({ where }: any) =>
        existingBills.find((b) => b.serviceId === where.serviceId && b.period.getTime() === where.period.getTime() && b.installmentLabel === where.installmentLabel) ?? null,
      ),
    },
    $transaction: jest.fn(async (fn: any) => fn(client)),
  };
  const prisma = { client };
  const tenantContext = { getTenantId: () => TENANT, getUserId: () => 'user-1' };
  const storage = { keyFor: jest.fn((t: string, sha: string) => `bill-documents/${t}/${sha}.pdf`), put: jest.fn().mockResolvedValue(undefined) };
  const bills = {
    createAutomatic: jest.fn(async (_tx: unknown, input: any) => {
      created.push(input);
      const doc = docs.find((d) => d.id === input.documentId)!;
      const bill = { id: `bill-${created.length}` };
      doc.bills.push(bill);
      return bill;
    }),
  };
  const service = new BillIntakeService(prisma as never, tenantContext as never, storage as never, new NodePdfTextService(), bills as never);
  return { service, docs, created, storage, bills, client };
}

const upload = (lines: string[], extra: Partial<Parameters<BillIntakeService['intake']>[0]> = {}) => ({
  channel: BillChannel.Archivo,
  origin: 'boleta.pdf',
  fileName: 'boleta.pdf',
  content: simplePdf(lines),
  ...extra,
});

describe('BillIntakeService: circuito único', () => {
  it('alta: una boleta que cierra da de alta el ServiceBill por el servicio de boletas y deja el documento Procesada', async () => {
    const { service, docs, created, storage } = build();
    const result = await service.intake(upload(muniCurrentLines()), NOW);

    expect(result.duplicate).toBe(false);
    expect(result.document).toMatchObject({ status: BillDocumentStatus.Procesada, reason: null, billIds: ['bill-1'] });
    expect(created).toEqual([
      expect.objectContaining({ serviceId: 'svc-1', documentId: 'doc-1', period: '2026-11-01', amount: '12345.67', dueDate: '2026-12-14' }),
    ]);
    expect(storage.put).toHaveBeenCalledWith(expect.stringMatching(/^bill-documents\/tenant-1\/[0-9a-f]{64}\.pdf$/), expect.any(Buffer));
    expect(docs[0]).toMatchObject({
      providerKey: 'muni-cordoba',
      accountNumber: 'I0000001',
      serviceId: 'svc-1',
      confidence: 1,
      processedAt: expect.any(Date),
    });
    expect((docs[0].data as { lines: unknown[] }).lines).toHaveLength(1);
  });

  it('idempotente por contenido: el mismo PDF no se guarda ni se procesa dos veces', async () => {
    const { service, created, storage, client } = build();
    const first = await service.intake(upload(muniCurrentLines()), NOW);
    const second = await service.intake(upload(muniCurrentLines()), NOW);

    expect(second.duplicate).toBe(true);
    expect(second.document).toEqual(first.document);
    expect(created).toHaveLength(1);
    expect(storage.put).toHaveBeenCalledTimes(1);
    expect(client.billDocument.create).toHaveBeenCalledTimes(1);
  });

  it('dos pedidos simultáneos con el mismo PDF: el que pierde la carrera devuelve el documento del ganador', async () => {
    const { service, client, docs } = build();
    const winner: Doc = { id: 'doc-w', tenantId: TENANT, sha256: 'x', status: 'Procesada', reason: null, serviceId: null, bills: [{ id: 'b' }] };
    client.billDocument.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
    client.billDocument.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }));
    const result = await service.intake(upload(muniCurrentLines()), NOW);
    expect(result).toMatchObject({ duplicate: true, document: { id: 'doc-w', billIds: ['b'] } });
    expect(docs).toHaveLength(0);
  });

  it('otro error al guardar el documento se propaga', async () => {
    const { service, client } = build();
    client.billDocument.create.mockRejectedValueOnce(new Error('db caída'));
    await expect(service.intake(upload(muniCurrentLines()), NOW)).rejects.toThrow('db caída');
  });

  it('la boleta ya cargada con el mismo importe deja el documento Duplicada y no crea nada', async () => {
    const { service, created } = build({
      bills: [{ id: 'bill-old', serviceId: 'svc-1', period: new Date('2026-11-01T00:00:00Z'), installmentLabel: '11/2026', amount: '12345.67' }],
    });
    const result = await service.intake(upload(muniCurrentLines()), NOW);
    expect(result.document).toMatchObject({ status: BillDocumentStatus.Duplicada, reason: null });
    expect(created).toHaveLength(0);
  });

  it('una boleta existente con otro importe nunca se pisa: va a revisión', async () => {
    const { service, created } = build({
      bills: [{ id: 'bill-old', serviceId: 'svc-1', period: new Date('2026-11-01T00:00:00Z'), installmentLabel: '11/2026', amount: '999.00' }],
    });
    const result = await service.intake(upload(muniCurrentLines()), NOW);
    expect(result.document).toMatchObject({ status: BillDocumentStatus.RequiereRevision, reason: 'BILL_EXISTS_DIFFERENT_AMOUNT' });
    expect(created).toHaveLength(0);
  });

  it('sin servicio coincidente (otra cuenta o inactivo) va a revisión', async () => {
    const { service, created } = build({ services: [{ id: 'svc-2', providerKey: 'muni-cordoba', accountNumber: 'I9999999' }] });
    const result = await service.intake(upload(muniCurrentLines()), NOW);
    expect(result.document).toMatchObject({ status: BillDocumentStatus.RequiereRevision, reason: 'NO_MATCHING_SERVICE' });
    expect(created).toHaveLength(0);
  });

  it('la cuenta puede coincidir por cualquiera de los identificadores del documento', async () => {
    const { service } = build({ services: [{ id: 'svc-3', providerKey: 'muni-cordoba', accountNumber: '012345678901200' }] });
    const result = await service.intake(upload(muniCurrentLines()), NOW);
    expect(result.document.status).toBe(BillDocumentStatus.Procesada);
  });

  it('dos servicios con la misma cuenta es ambiguo: va a revisión', async () => {
    const { service } = build({
      services: [
        { id: 'svc-1', providerKey: 'muni-cordoba', accountNumber: 'I0000001' },
        { id: 'svc-2', providerKey: 'muni-cordoba', accountNumber: 'I0000001' },
      ],
    });
    const result = await service.intake(upload(muniCurrentLines()), NOW);
    expect(result.document).toMatchObject({ status: BillDocumentStatus.RequiereRevision, reason: 'AMBIGUOUS_SERVICE' });
  });

  it('confianza baja (EPEC y Ecogas están topados en 0,6) va a revisión con el servicio sugerido', async () => {
    const { service, docs, created } = build({ services: [{ id: 'svc-e', providerKey: 'epec', accountNumber: '1234567' }] });
    const result = await service.intake(upload(epecLines()), NOW);
    expect(result.document).toMatchObject({ status: BillDocumentStatus.RequiereRevision, reason: 'LOW_CONFIDENCE' });
    expect(docs[0].serviceId).toBe('svc-e');
    expect(created).toHaveLength(0);
  });

  it('un documento que ningún proveedor reconoce nunca se da de alta, aunque la cuenta coincida; se sugiere el servicio', async () => {
    const { service, docs } = build({ services: [{ id: 'svc-x', providerKey: 'otro', accountNumber: 'ABC1234' }] });
    const result = await service.intake(upload(unknownLines()), NOW);
    expect(result.document).toMatchObject({ status: BillDocumentStatus.RequiereRevision, reason: 'UNKNOWN_PROVIDER' });
    expect(docs[0].serviceId).toBe('svc-x');
    expect(docs[0].providerKey).toBeNull();
  });

  it('un documento desconocido sin cuenta ni servicio va a revisión sin sugerencia', async () => {
    const { service, docs } = build();
    const result = await service.intake(upload(['Nada de una boleta']), NOW);
    expect(result.document.reason).toBe('UNKNOWN_PROVIDER');
    expect(docs[0].serviceId).toBeNull();
  });

  it('un PDF sin texto (escaneo) o ilegible va a revisión como UNREADABLE', async () => {
    const { service } = build();
    expect((await service.intake(upload([]), NOW)).document).toMatchObject({ status: BillDocumentStatus.RequiereRevision, reason: 'UNREADABLE' });
    const broken = await service.intake(upload([], { content: Buffer.from('%PDF-1.4 roto') }), NOW);
    expect(broken.document.reason).toBe('UNREADABLE');
  });

  it('un proveedor reconocido del que no se pudo leer ninguna boleta va a revisión como UNREADABLE', async () => {
    const { service } = build();
    const result = await service.intake(upload(['Contribución sobre los Inmuebles', 'sin nada más']), NOW);
    expect(result.document.reason).toBe('UNREADABLE');
  });

  it('un proveedor reconocido sin cuenta legible va a revisión como NO_ACCOUNT', async () => {
    const { service } = build();
    const lines = rentasCurrentLines().filter((l) => !l.startsWith('Número de cuenta'));
    expect((await service.intake(upload(lines), NOW)).document.reason).toBe('NO_ACCOUNT');
  });

  describe('validaciones', () => {
    const services = [
      { id: 'svc-1', providerKey: 'muni-cordoba', accountNumber: 'I0000001' },
      { id: 'svc-a', providerKey: 'aguas-cordobesas', accountNumber: '100001' },
    ];

    it('un período fuera de ±3 meses de hoy va a revisión', async () => {
      const { service } = build({ services });
      const old = await service.intake(upload(muniCurrentLines({ year: 2026, cuota: 6, venc: [{ date: '14/07/2026', amount: '$100,00' }] })), NOW);
      expect(old.document.reason).toBe('PERIOD_OUT_OF_RANGE');
      const edge = await service.intake(upload(muniCurrentLines({ year: 2026, cuota: 8, venc: [{ date: '14/09/2026', amount: '$100,00' }] })), NOW);
      expect(edge.document.status).toBe(BillDocumentStatus.Procesada);
    });

    it('un vencimiento anterior al período o muy posterior va a revisión', async () => {
      const { service } = build({ services });
      const before = await service.intake(upload(muniCurrentLines({ venc: [{ date: '14/10/2026', amount: '$100,00' }] })), NOW);
      expect(before.document.reason).toBe('DUE_DATE_INCONSISTENT');
      const late = await service.intake(upload(muniCurrentLines({ venc: [{ date: '14/07/2027', amount: '$101,00' }] })), NOW);
      expect(late.document.reason).toBe('DUE_DATE_INCONSISTENT');
    });

    it('un segundo vencimiento anterior al primero va a revisión', async () => {
      const { service } = build({ services });
      const data: FetchedBillData = {
        providerKey: 'aguas-cordobesas',
        accountNumbers: ['100001'],
        issueDate: null,
        lines: [
          { period: '2026-11-01', installmentLabel: null, amount: '10.00', nominalAmount: null, dueDate: '2026-11-20', secondDueDate: '2026-11-12', secondAmount: '11.00', paymentCode: null, consumption: null },
        ],
        confidence: 1,
        warnings: [],
      };
      expect((service as any).validate(data, NOW)).toBe('DUE_DATE_INCONSISTENT');
    });

    it('un importe en cero va a revisión', async () => {
      const { service } = build({ services });
      const data: FetchedBillData = {
        providerKey: 'muni-cordoba',
        accountNumbers: ['I0000001'],
        issueDate: null,
        lines: [{ period: '2026-11-01', installmentLabel: null, amount: '0.00', nominalAmount: null, dueDate: null, secondDueDate: null, secondAmount: null, paymentCode: null, consumption: null }],
        confidence: 1,
        warnings: [],
      };
      expect((service as any).validate(data, NOW)).toBe('INVALID_AMOUNT');
    });

    it('un resumen de cuenta con varias boletas en rango las da de alta todas; con una vieja, ninguna', async () => {
      const { service, created } = build({ services });
      const ok = await service.intake(
        upload(aguasStatementLines([
          { num: 'FC-0010-00000001', periodo: '10/2026', venc: '12/11/2026', amount: '463,07' },
          { num: 'FC-0010-00000002', periodo: '11/2026', venc: '12/12/2026', amount: '470,10' },
        ])),
        NOW,
      );
      expect(ok.document).toMatchObject({ status: BillDocumentStatus.Procesada, billIds: ['bill-1', 'bill-2'] });
      expect(created).toHaveLength(2);

      const mixed = await service.intake(
        upload(aguasStatementLines([
          { num: 'FC-0010-00000003', periodo: '03/2026', venc: '12/04/2026', amount: '400,00' },
          { num: 'FC-0010-00000004', periodo: '11/2026', venc: '12/12/2026', amount: '471,00' },
        ])),
        NOW,
      );
      expect(mixed.document.reason).toBe('PERIOD_OUT_OF_RANGE');
      expect(created).toHaveLength(2);
    });

    it('de un resumen con una boleta ya cargada, da de alta sólo la nueva', async () => {
      const { service, created } = build({
        services,
        bills: [{ id: 'bill-old', serviceId: 'svc-a', period: new Date('2026-10-01T00:00:00Z'), installmentLabel: '10/2026', amount: '463.07' }],
      });
      const result = await service.intake(
        upload(aguasStatementLines([
          { num: 'FC-0010-00000001', periodo: '10/2026', venc: '12/11/2026', amount: '463,07' },
          { num: 'FC-0010-00000002', periodo: '11/2026', venc: '12/12/2026', amount: '470,10' },
        ])),
        NOW,
      );
      expect(result.document.status).toBe(BillDocumentStatus.Procesada);
      expect(created).toHaveLength(1);
    });
  });

  it('si el alta falla por una carrera con otra alta de la misma boleta, el documento queda en revisión', async () => {
    const { service, bills } = build();
    bills.createAutomatic.mockRejectedValueOnce(
      Object.assign(new Error('exists'), { getResponse: () => ({ error: 'BILL_ALREADY_EXISTS' }) }),
    );
    const result = await service.intake(upload(muniCurrentLines()), NOW);
    expect(result.document).toMatchObject({ status: BillDocumentStatus.RequiereRevision, reason: 'BILL_EXISTS_DIFFERENT_AMOUNT' });
  });

  it('un fallo inesperado al dar de alta deja el documento en revisión en lugar de perderlo', async () => {
    const { service, bills } = build();
    bills.createAutomatic.mockRejectedValueOnce(new Error('boom'));
    const result = await service.intake(upload(muniCurrentLines()), NOW);
    expect(result.document).toMatchObject({ status: BillDocumentStatus.RequiereRevision, reason: 'UNREADABLE' });
  });

  describe('mensaje sin adjunto', () => {
    it('queda para revisión como NO_ATTACHMENT, una sola vez por mensaje', async () => {
      const { service, docs } = build();
      const input = { channel: BillChannel.Mail, origin: 'remitente@demo.test', messageKey: `${TENANT}:<m1@demo>`, subject: 'Su factura' };
      const first = await service.intakeWithoutAttachment(input);
      const again = await service.intakeWithoutAttachment(input);
      expect(first.document).toMatchObject({ status: BillDocumentStatus.RequiereRevision, reason: 'NO_ATTACHMENT' });
      expect(first.duplicate).toBe(false);
      expect(again.duplicate).toBe(true);
      expect(docs).toHaveLength(1);
      expect(docs[0].data).toEqual({ subject: 'Su factura' });
    });

    it('la carrera entre dos entregas del mismo mensaje devuelve el documento ganador', async () => {
      const { service, client } = build();
      const winner = { id: 'doc-w', status: 'RequiereRevision', reason: 'NO_ATTACHMENT', bills: [] };
      client.billDocument.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
      client.billDocument.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }));
      const result = await service.intakeWithoutAttachment({ channel: BillChannel.Mail, origin: 'a@b.test', messageKey: 'k', subject: null });
      expect(result).toMatchObject({ duplicate: true, document: { id: 'doc-w' } });
    });

    it('otro error se propaga', async () => {
      const { service, client } = build();
      client.billDocument.create.mockRejectedValueOnce(new Error('db caída'));
      await expect(service.intakeWithoutAttachment({ channel: BillChannel.Mail, origin: 'a@b.test', messageKey: 'k', subject: null })).rejects.toThrow('db caída');
    });
  });

  it('toBillInput y toStoredData dejan sólo lo que alimenta la boleta, sin datos personales', () => {
    const line = { period: '2026-11-01', installmentLabel: null, amount: '1.00', nominalAmount: null, dueDate: '2026-11-12', secondDueDate: null, secondAmount: null, paymentCode: 'x', consumption: null };
    expect(toBillInput(line)).toEqual({ period: '2026-11-01', installmentLabel: null, amount: '1.00', nominalAmount: null, dueDate: '2026-11-12', consumption: null });
    expect(Object.keys(toStoredData({ providerKey: 'epec', accountNumbers: ['1'], issueDate: null, lines: [line], confidence: 0.5, warnings: [] }))).toEqual([
      'providerKey',
      'accountNumbers',
      'issueDate',
      'lines',
      'warnings',
    ]);
  });
});
