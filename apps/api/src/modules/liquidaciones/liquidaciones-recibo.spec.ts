import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { PdfRendererService } from '../../common/pdf/pdf-renderer.service';
import { LiquidacionesService } from './liquidaciones.service';
import { PdfService } from './pdf.service';

const PdfPrinter = require('pdfmake/src/printer');

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function liquidacion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'liq-1',
    tenantId: 'tenant-1',
    contractId: 'c-1',
    status: 'Revision',
    period: d('2026-11-01'),
    dueDate: d('2026-11-10'),
    subtotal: '312000.00',
    total: '312000.00',
    currency: 'ARS',
    kind: 'Mensual',
    isProvisional: false,
    receiptSeq: null,
    lineItems: [
      { id: 'li-1', type: 'Alquiler', description: 'Alquiler 11/2026', amount: '300000.00', beneficiary: 'Locador', commissionable: true },
      { id: 'li-2', type: 'Servicio', description: 'Gas 10/2026', amount: '4200.00', beneficiary: 'Ente', commissionable: false },
      { id: 'li-3', type: 'Honorario', description: 'Gestión de reparación', amount: '7800.00', beneficiary: 'Inmobiliaria', commissionable: false },
    ],
    payments: [],
    contract: {
      property: { title: 'Depto Palermo' },
      persons: [],
      lessors: [
        { validFrom: d('2025-01-01'), validTo: null, person: { firstName: 'Ana', lastName: 'Pérez' } },
        { validFrom: d('2025-01-01'), validTo: null, person: { firstName: 'Luis', lastName: 'Gómez' } },
        { validFrom: d('2020-01-01'), validTo: d('2024-12-31'), person: { firstName: 'Vieja', lastName: 'Titular' } },
      ],
    },
    ...overrides,
  };
}

function build(liq: any, nextSeq = 6) {
  const tx: any = {
    $queryRaw: jest.fn().mockResolvedValue([{ next: nextSeq + 1 }]),
    liquidacion: { update: jest.fn().mockResolvedValue({}) },
  };
  const client: any = {
    liquidacion: {
      findFirst: jest.fn().mockResolvedValue(liq),
      update: jest.fn().mockResolvedValue({}),
    },
    liquidacionLineItem: {
      findFirst: jest.fn().mockResolvedValue({ id: 'li-1', liquidacionId: 'liq-1', type: 'Extra' }),
      create: jest.fn().mockResolvedValue({ id: 'li-new' }),
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    tenant: { findFirst: jest.fn().mockResolvedValue({ name: 'Inmobiliaria Demo', cuit: '30-00000000-1' }) },
    $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)),
  };
  const tenantContext = { getTenantId: jest.fn().mockReturnValue('tenant-1'), getUserId: jest.fn() };
  const service = new LiquidacionesService(
    { client } as unknown as PrismaService,
    tenantContext as unknown as TenantContextService,
    new PdfService(new PdfRendererService()),
    { sendLiquidacionEmail: jest.fn().mockResolvedValue({ status: 'sent' }) } as any,
    {} as any,
    {} as any,
  );
  return { service, client, tx };
}

describe('recibo: numeración al aprobar', () => {
  it('asigna el número de la serie de la inmobiliaria al aprobar', async () => {
    const { service, tx, client } = build(liquidacion());
    await service.transition('liq-1', { status: 'Aprobada' });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const sql = tx.$queryRaw.mock.calls[0][0];
    expect(sql.values).toEqual([expect.any(String), 'tenant-1', 'RECIBO_LIQUIDACION']);
    expect(tx.liquidacion.update).toHaveBeenCalledWith({
      where: { id: 'liq-1' },
      data: expect.objectContaining({ status: 'Aprobada', receiptSeq: 6 }),
    });
    expect(client.liquidacion.update).not.toHaveBeenCalled();
  });

  it('el número no se reasigna si ya lo tiene', async () => {
    const { service, tx, client } = build(liquidacion({ status: 'Aprobada', receiptSeq: 3 }));
    await service.transition('liq-1', { status: 'Anulada' }).catch(() => undefined);
    await service.transition('liq-1', { status: 'Enviada' });

    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(client.liquidacion.update).toHaveBeenCalledWith({
      where: { id: 'liq-1' },
      data: expect.not.objectContaining({ receiptSeq: expect.anything() }),
    });
  });

  it('los pasos que no son aprobar ni enviar no numeran', async () => {
    const { service, tx } = build(liquidacion({ status: 'Borrador' }));
    await service.transition('liq-1', { status: 'Revision' });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('el detalle muestra el número con ceros', async () => {
    const { service } = build(liquidacion({ receiptSeq: 42 }));
    expect((await service.findOne('liq-1')).receiptNumber).toBe('00000042');
    const { service: sinNumero } = build(liquidacion());
    expect((await sinNumero.findOne('liq-1')).receiptNumber).toBeNull();
  });
});

describe('renglones manuales: destino y comisión por defecto', () => {
  it('un renglón nuevo toma el destino y la comisión del tipo', async () => {
    const { service, client } = build(liquidacion());
    await service.addLineItem('liq-1', { type: 'Honorario', description: 'Gestión', amount: '1000' });
    expect(client.liquidacionLineItem.create.mock.calls[0][0].data).toMatchObject({
      commissionable: false,
      beneficiary: 'Inmobiliaria',
    });

    await service.addLineItem('liq-1', { type: 'Multa', description: 'Punitorio', amount: '500' });
    expect(client.liquidacionLineItem.create.mock.calls[1][0].data).toMatchObject({
      commissionable: true,
      beneficiary: 'Locador',
    });
  });

  it('se puede indicar el destino y la comisión', async () => {
    const { service, client } = build(liquidacion());
    await service.addLineItem('liq-1', {
      type: 'Extra',
      description: 'Reparación',
      amount: '1000',
      commissionable: false,
      beneficiary: 'Ente',
    });
    expect(client.liquidacionLineItem.create.mock.calls[0][0].data).toMatchObject({
      commissionable: false,
      beneficiary: 'Ente',
    });
  });

  it('al cambiar el tipo sin indicar destino rigen los del tipo nuevo', async () => {
    const { service, client } = build(liquidacion());
    await service.updateLineItem('li-1', { type: 'Servicio' });
    expect(client.liquidacionLineItem.update.mock.calls[0][0].data).toMatchObject({
      type: 'Servicio',
      commissionable: false,
      beneficiary: 'Ente',
    });
  });
});

describe('recibo: PDF', () => {
  let docs: any[];

  beforeEach(() => {
    docs = [];
    const original = PdfPrinter.prototype.createPdfKitDocument;
    jest.spyOn(PdfPrinter.prototype, 'createPdfKitDocument').mockImplementation(function (this: any, def: any) {
      docs.push(def);
      return original.call(this, def);
    });
  });
  afterEach(() => jest.restoreAllMocks());

  const texts = (def: any): string[] =>
    def.content.flatMap((c: any) => (typeof c.text === 'string' ? [c.text] : []));

  it('lleva el número, el monto en letras y por cuenta y orden de los locadores vigentes', async () => {
    const { service } = build(liquidacion({ receiptSeq: 42 }));
    await service.generatePdf('liq-1');
    const all = texts(docs[0]);
    expect(all).toContain('RECIBO Nº 00000042');
    expect(all).toContain('Son: Trescientos doce mil pesos.');
    expect(all).toContain('Cobrado por cuenta y orden de Ana Pérez y Luis Gómez.');
    const columns = docs[0].content.find((c: any) => Array.isArray(c.columns));
    expect(columns.columns.map((c: any) => c.text)).toEqual(['Período: noviembre de 2026', 'Vencimiento: 10/11/2026']);
  });

  it('agrupa los renglones por destino con su título', async () => {
    const { service } = build(liquidacion({ receiptSeq: 42 }));
    await service.generatePdf('liq-1');
    const table = docs[0].content.find((c: any) => c.table?.widths?.length === 3);
    const rows: any[][] = table.table.body;
    const titles = rows.filter((r) => r[0]?.colSpan === 3).map((r) => r[0].text);
    expect(titles).toEqual(['A favor del locador', 'A favor de entes y proveedores', 'A favor de la inmobiliaria']);
    expect(rows[1][0].text).toBe('A favor del locador');
    expect(rows[2][1].text).toBe('Alquiler 11/2026');
  });

  it('sin número todavía se titula liquidación y sin títulos de grupo si todo va al locador', async () => {
    const simple = liquidacion({
      lineItems: [{ type: 'Alquiler', description: 'Alquiler 11/2026', amount: '300000.00', beneficiary: 'Locador' }],
      total: '300000.00',
    });
    const { service } = build(simple);
    await service.generatePdf('liq-1');
    expect(texts(docs[0])).toContain('LIQUIDACIÓN');
    const table = docs[0].content.find((c: any) => c.table?.widths?.length === 3);
    expect(table.table.body.some((r: any[]) => r[0]?.colSpan === 3)).toBe(false);
  });

  it('un pago a cuenta lo dice en el recibo', async () => {
    const { service } = build(liquidacion({ isProvisional: true, kind: 'PagoACuenta', receiptSeq: 7 }));
    await service.generatePdf('liq-1');
    expect(texts(docs[0]).some((t) => t.startsWith('PAGO A CUENTA'))).toBe(true);
  });

  it('con centavos escribe pesos con centavos', async () => {
    const { service } = build(liquidacion({ total: '1234.50', subtotal: '1234.50', receiptSeq: 1 }));
    await service.generatePdf('liq-1');
    expect(texts(docs[0])).toContain('Son: Mil doscientos treinta y cuatro pesos con cincuenta centavos.');
  });
});
