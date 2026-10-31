import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { LiquidacionesService } from './liquidaciones.service';
import { PdfService } from './pdf.service';

const PdfPrinter = require('pdfmake/src/printer');

/**
 * CP-137 (DEF-17): el PDF de la liquidación imprime la propiedad del
 * contrato. Antes leía `property.address`/`property.name`, campos que no
 * existen, y siempre mostraba "—".
 */
describe('LiquidacionesService.generatePdf: propiedad del contrato', () => {
  let docDefinitions: any[];

  const buildService = (property: Record<string, unknown> | null) => {
    const liquidacion = {
      id: 'liq-1',
      period: new Date('2025-03-01T00:00:00.000Z'),
      subtotal: '100000.00',
      total: '100000.00',
      currency: 'ARS',
      dueDate: new Date('2025-03-10T00:00:00.000Z'),
      lineItems: [{ type: 'Alquiler', description: 'Alquiler marzo', amount: '100000.00' }],
      payments: [],
      contract: { property },
    };
    const client = {
      liquidacion: { findFirst: jest.fn().mockResolvedValue(liquidacion) },
      tenant: { findFirst: jest.fn().mockResolvedValue({ name: 'Inmobiliaria Demo' }) },
    };
    const tenantContext = { getTenantId: jest.fn().mockReturnValue('tenant-1') };
    return new LiquidacionesService(
      { client } as unknown as PrismaService,
      tenantContext as unknown as TenantContextService,
      new PdfService(),
      {} as any,
    );
  };

  const propertyLine = () =>
    docDefinitions[0].content
      .map((c: any) => c.text)
      .find((t: any) => String(t).startsWith('Propiedad:'));

  beforeEach(() => {
    docDefinitions = [];
    const original = PdfPrinter.prototype.createPdfKitDocument;
    jest
      .spyOn(PdfPrinter.prototype, 'createPdfKitDocument')
      .mockImplementation(function (this: any, def: any) {
        docDefinitions.push(def);
        return original.call(this, def);
      });
  });

  afterEach(() => jest.restoreAllMocks());

  it('imprime el título de la propiedad', async () => {
    const service = buildService({ title: 'Depto Palermo', street: 'Av. Santa Fe', number: '1234' });
    await service.generatePdf('liq-1');
    expect(propertyLine()).toBe('Propiedad: Depto Palermo');
  });

  it('sin título imprime calle, número y unidad', async () => {
    const service = buildService({
      title: '',
      street: 'Av. Santa Fe',
      number: '1234',
      floor: '3',
      apartment: 'B',
    });
    await service.generatePdf('liq-1');
    expect(propertyLine()).toBe('Propiedad: Av. Santa Fe 1234, piso 3 B');
  });

  it('sin propiedad imprime el guion', async () => {
    const service = buildService(null);
    await service.generatePdf('liq-1');
    expect(propertyLine()).toBe('Propiedad: —');
  });
});
