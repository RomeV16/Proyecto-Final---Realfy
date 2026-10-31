import { PdfService } from '../../../src/modules/liquidaciones/pdf.service';
import { RenditionPdfService } from '../../../src/modules/renditions/rendition-pdf.service';
import { ReportPdfService } from '../../../src/modules/reports/report-pdf.service';
import { FiscalPdfService } from '../../../src/modules/invoices/fiscal-pdf.service';
import { ContractPdfService } from '../../../src/modules/contract-templates/contract-pdf.service';
import { captureDocDefinition, freezeDate } from './helpers';

/**
 * Caracterización: fija la definición de documento que cada servicio le pasa a
 * pdfmake. Las fechas usan el mediodía UTC para que el día no cambie de zona.
 */
describe('Caracterización de PDF', () => {
  beforeAll(freezeDate);
  afterAll(() => jest.useRealTimers());

  it('liquidación', async () => {
    const service = new PdfService();
    const doc = await captureDocDefinition(() =>
      service.generateReceipt(
        {
          id: 'liq-1',
          period: '2025-03-15T12:00:00.000Z',
          subtotal: '150000.5',
          total: 152500,
          currency: 'ARS',
          dueDate: '2025-03-20T12:00:00.000Z',
        },
        { name: 'Inmobiliaria Demo', cuit: '30-11111111-1' },
        { property: { street: 'Calle Falsa', number: '123', floor: '2', apartment: 'B' } },
        [
          { type: 'Alquiler', description: 'Alquiler marzo', amount: '150000.5' },
          { type: 'Multa', description: 'Mora de 5 días de mora', amount: '2499.5' },
          { type: 'Multa', description: 'Recargo', amount: '1000', meta: { daysOverdue: 3 } },
        ],
        [{ method: 'Transferencia', amount: '152500', paidAt: '2025-03-18T12:00:00.000Z', reference: null }],
      ),
    );
    expect(doc).toMatchSnapshot();
  });

  it('liquidación sin CUIT ni pagos', async () => {
    const service = new PdfService();
    const doc = await captureDocDefinition(() =>
      service.generateReceipt(
        {
          id: 'liq-2',
          period: '2025-04-15T12:00:00.000Z',
          subtotal: '1000',
          total: '1000',
          currency: 'USD',
          dueDate: '2025-04-20T12:00:00.000Z',
        },
        { name: 'Inmobiliaria Demo' },
        {},
        [{ type: 'Alquiler', description: 'Alquiler abril', amount: '1000' }],
        [],
      ),
    );
    expect(doc).toMatchSnapshot();
  });

  it('rendición', async () => {
    const service = new RenditionPdfService();
    const doc = await captureDocDefinition(() =>
      service.generateRenditionPdf(
        {
          id: 'rend-1',
          period: '2025-03-15T12:00:00.000Z',
          owner: { firstName: 'Ana', lastName: 'Pérez' },
          contract: {
            id: 'abcdef12-0000-0000-0000-000000000000',
            property: { title: 'Depto Centro', street: 'Calle Falsa', number: '123' },
          },
          lineItems: [
            { type: 'Alquiler', description: 'Alquiler marzo', amount: '150000' },
            { type: 'Comision', description: 'Comisión 5%', amount: '-7500' },
          ],
          rentCollected: '150000',
          commissionAmount: '7500',
          adminFeeAmount: '1000',
          deductionTotal: '500.25',
          netDeposit: '140999.75',
          notes: 'Sin novedades',
        },
        { name: 'Inmobiliaria Demo', cuit: '30-11111111-1' },
      ),
    );
    expect(doc).toMatchSnapshot();
  });

  it('rendición sin propietario, contrato ni notas', async () => {
    const service = new RenditionPdfService();
    const doc = await captureDocDefinition(() =>
      service.generateRenditionPdf(
        {
          id: 'rend-2',
          period: '2025-04-15T12:00:00.000Z',
          lineItems: [],
          rentCollected: 0,
          commissionAmount: 0,
          adminFeeAmount: 0,
          deductionTotal: 0,
          netDeposit: 0,
        },
        { name: 'Inmobiliaria Demo' },
      ),
    );
    expect(doc).toMatchSnapshot();
  });

  const reports = [
    {
      type: 'ownerStatement',
      title: 'Estado de Cuenta del Propietario',
      columns: ['Período', 'Propiedad', 'Cobrado', 'Comisión', 'Honorarios', 'Deducciones', 'Depósito Neto'],
      rows: [
        { periodo: '03/2025', propiedad: 'Depto Centro', cobrado: '150000.00', comision: '7500.00', honorarios: '1000.00', deducciones: '0.00', depositoNeto: '141500.00' },
      ],
      summary: { cobrado: '150000.00', comision: '7500.00', honorarios: '1000.00', deducciones: '0.00', depositoNeto: '141500.00' },
    },
    {
      type: 'cashFlow',
      title: 'Flujo de Caja Mensual',
      columns: ['Mes', 'Ingresos', 'Egresos', 'Facturado', 'Saldo Neto'],
      rows: [{ mes: 'marzo 2025', ingresos: '1000.00', egresos: '200.00', facturado: '900.00', saldoNeto: '800.00' }],
    },
    {
      type: 'morosidad',
      title: 'Reporte de Morosidad',
      columns: ['Propiedad', 'Inquilino', 'Período', 'Vencimiento', 'Días Vencidos', 'Monto', 'Moneda'],
      rows: [{ propiedad: 'Depto Centro', inquilino: 'Juan Gómez', periodo: '03/2025', vencimiento: '10/03/2025', diasVencidos: 12, monto: '150000.00', moneda: 'ARS' }],
    },
    {
      type: 'pipelineAnalytics',
      title: 'Analítica de Pipeline',
      columns: ['Etapa', 'Leads Actuales', 'Convertidos', 'Perdidos', 'Tasa Conversión', 'Promedio Conversión (días)'],
      rows: [{ etapa: 'Nuevo', leadsActuales: 3, convertidos: 1, perdidos: 0, tasaConversion: '25%', promedioConversionDias: '4.5' }],
    },
    {
      type: 'propertyProfitability',
      title: 'Rentabilidad por Propiedad',
      columns: ['Propiedad', 'Cobrado', 'Facturado', 'Comisiones', 'Ingreso Neto'],
      rows: [{ propiedad: 'Depto Centro', cobrado: '100.00', facturado: '90.00', comisiones: '5.00', ingresoNeto: '85.00' }],
    },
    {
      type: 'commissionSummary',
      title: 'Resumen de Comisiones',
      columns: ['Propiedad', 'Propietario', 'Período', 'Tipo Comisión', 'Comisión', 'Honorarios', 'Total'],
      rows: [{ propiedad: 'Depto Centro', propietario: 'Ana Pérez', periodo: '03/2025', tipoComision: 'Porcentaje', comision: '7500.00', honorarios: '1000.00', total: '8500.00' }],
    },
  ];

  it.each(reports)('reporte $type', async (report) => {
    const service = new ReportPdfService();
    const doc = await captureDocDefinition(() =>
      service.generatePdf({ ...report, generatedAt: '2025-06-15T12:00:00.000Z', filters: {} } as never),
    );
    expect(doc).toMatchSnapshot();
  });

  it('comprobante fiscal', async () => {
    const service = Object.create(FiscalPdfService.prototype) as FiscalPdfService;
    (service as unknown as { logger: unknown }).logger = { error: jest.fn(), warn: jest.fn() };
    const doc = await captureDocDefinition(() =>
      service.generateInvoicePdf(
        {
          id: 'comp-1',
          cbteTipo: 11,
          puntoDeVenta: 3,
          numero: 45,
          impTotal: '121000.00',
          impNeto: '100000.00',
          impIva: '21000.00',
          impExento: '0.00',
          currency: 'ARS',
          cae: '75123456789012',
          caeFchVto: '2025-07-10T12:00:00.000Z',
          emittedAt: '2025-06-10T12:00:00.000Z',
          docTipo: 80,
          docNro: '20-22222222-2',
          receptorName: 'Receptor Demo SA',
          receptorFiscalCondition: 'ConsumidorFinal',
        },
        { name: 'Inmobiliaria Demo', cuit: '30-11111111-1', address: 'Calle 1', fiscalCondition: 'ResponsableInscripto' },
      ),
    );
    expect(doc).toMatchSnapshot();
  });

  it('contrato', async () => {
    const service = new ContractPdfService();
    const doc = await captureDocDefinition(() =>
      service.generatePdf('Primera línea\n\n  Segunda línea  \nTercera', {
        title: 'Contrato de locación',
        contractType: 'Locacion',
        tenantName: 'Inmobiliaria Demo',
      }),
    );
    expect(doc).toMatchSnapshot();
  });

  it('contrato sin nombre de inmobiliaria', async () => {
    const service = new ContractPdfService();
    const doc = await captureDocDefinition(() =>
      service.generatePdf('Texto', { title: 'Sin nombre', contractType: 'Locacion' }),
    );
    expect(doc).toMatchSnapshot();
  });
});
