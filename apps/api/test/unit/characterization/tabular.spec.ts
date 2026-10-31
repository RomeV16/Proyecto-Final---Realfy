import { ExportService } from '../../../src/modules/import-export/export.service';
import { ReportExcelService } from '../../../src/modules/reports/report-excel.service';
import { FiscalScheduler } from '../../../src/modules/invoices/fiscal.scheduler';
import { dumpWorkbook } from './helpers';

/** Caracterización de las planillas: hojas, encabezados, filas y formato. */

const properties = [
  { title: 'Depto Centro', type: 'Departamento', street: 'Calle Falsa', number: '123', floor: '2', apartment: 'B', city: 'CABA', province: 'Buenos Aires', zipCode: '1000', country: 'AR', area: '55.5', rooms: 3, bedrooms: 2, bathrooms: 1, garages: 0, age: 10, price: '120000', currency: 'ARS' },
  { title: 'Casa, "Norte"', type: 'Casa', street: null, number: null, floor: null, apartment: null, city: null, province: null, zipCode: null, country: null, area: null, rooms: null, bedrooms: null, bathrooms: null, garages: null, age: null, price: null, currency: null },
];

const persons = [
  { firstName: 'Ana', lastName: 'Pérez', email: 'ana@example.com', phone: '1111', phone2: null, cuit: '27-11111111-1', fiscalCondition: 'Monotributista', notes: 'línea 1\nlínea 2', bankAccounts: [{ currency: 'USD', bankName: 'Banco U', cbu: '1', alias: 'u.alias' }, { currency: 'ARS', bankName: 'Banco A', cbu: '2', alias: 'a.alias' }] },
  { firstName: 'Luis', lastName: 'Gómez', email: null, phone: null, phone2: null, cuit: null, fiscalCondition: null, notes: null, bankAccounts: [] },
];

function exportService(): ExportService {
  const prisma = {
    client: {
      property: { findMany: jest.fn().mockResolvedValue(properties) },
      person: { findMany: jest.fn().mockResolvedValue(persons) },
    },
  };
  return new ExportService(prisma as never, {} as never);
}

describe('Caracterización de exportaciones', () => {
  it('propiedades CSV', async () => {
    const { buffer } = await exportService().exportPropertiesCsv();
    expect(JSON.stringify(buffer.toString('utf-8'))).toMatchSnapshot();
  });

  it('personas CSV', async () => {
    const { buffer } = await exportService().exportPersonsCsv();
    expect(JSON.stringify(buffer.toString('utf-8'))).toMatchSnapshot();
  });

  it('propiedades Excel', async () => {
    const { buffer } = await exportService().exportPropertiesExcel();
    expect(await dumpWorkbook(buffer)).toMatchSnapshot();
  });

  it('personas Excel', async () => {
    const { buffer } = await exportService().exportPersonsExcel();
    expect(await dumpWorkbook(buffer)).toMatchSnapshot();
  });
});

describe('Caracterización de Excel de reportes', () => {
  const base = { generatedAt: '2025-06-15T12:00:00.000Z', filters: {} };

  it('con resumen y columnas numéricas', async () => {
    const buffer = await new ReportExcelService().generateExcel({
      ...base,
      type: 'ownerStatement',
      title: 'Estado de Cuenta del Propietario',
      columns: [],
      rows: [
        { periodo: '03/2025', propiedad: 'Depto Centro', cobrado: '150000.50', comision: '7500', honorarios: 'x', deducciones: '', depositoNeto: '141500.5' },
      ],
      summary: { cobrado: '150000.50', comision: '7500.00', depositoNeto: '141500.50' },
    } as never);
    expect(await dumpWorkbook(buffer)).toMatchSnapshot();
  });

  it('sin resumen', async () => {
    const buffer = await new ReportExcelService().generateExcel({
      ...base,
      type: 'pipelineAnalytics',
      title: 'Analítica de Pipeline',
      columns: [],
      rows: [{ etapa: 'Nuevo', leadsActuales: 3, convertidos: 1, perdidos: 0, tasaConversion: '25%', promedioConversionDias: '4.5' }],
    } as never);
    expect(await dumpWorkbook(buffer)).toMatchSnapshot();
  });

  it.each(['cashFlow', 'morosidad', 'propertyProfitability', 'commissionSummary'])('encabezados de %s', async (type) => {
    const buffer = await new ReportExcelService().generateExcel({
      ...base,
      type,
      title: `Reporte ${type}`,
      columns: [],
      rows: [],
    } as never);
    expect(await dumpWorkbook(buffer)).toMatchSnapshot();
  });

  it('rechaza un tipo desconocido', async () => {
    await expect(
      new ReportExcelService().generateExcel({ ...base, type: 'nada', title: 'x', columns: [], rows: [] } as never),
    ).rejects.toThrow('Unknown report type for Excel export: nada');
  });
});

describe('Caracterización del Libro IVA', () => {
  const scheduler = Object.create(FiscalScheduler.prototype) as unknown as {
    buildLibroIvaExcel(c: unknown[], period: string, name: string): Promise<Buffer>;
  };

  it('con comprobantes', async () => {
    const buffer = await scheduler.buildLibroIvaExcel(
      [
        { createdAt: '2025-06-10T12:00:00.000Z', cbteTipo: 11, puntoDeVenta: 3, numero: 45, docTipo: 80, docNro: '20222222222', issuer: { businessName: 'Locador SA' }, impTotal: '121000', impNeto: '100000', impIva: '21000', impTrib: '0', impExento: '0', ivaArray: [{ BaseImp: 100000, Importe: 21000 }], cae: '75123456789012', monId: 'PES', monCotiz: '1' },
        { createdAt: null, cbteTipo: 6, puntoDeVenta: 3, numero: 46, docTipo: 99, docNro: null, issuer: null, impTotal: '500.555', impNeto: '500.555', impIva: '0', impExento: '10', cae: null, monId: null },
      ],
      '2025-06',
      'Inmobiliaria Demo',
    );
    expect(await dumpWorkbook(buffer)).toMatchSnapshot();
  });

  it('sin comprobantes', async () => {
    expect(await dumpWorkbook(await scheduler.buildLibroIvaExcel([], '2025-07', 'Inmobiliaria Demo'))).toMatchSnapshot();
  });
});
