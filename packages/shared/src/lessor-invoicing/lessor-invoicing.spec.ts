import { OperationalDefaultsSchema } from '../schemas/operational-defaults.schema';
import {
  DEFAULT_INVOICING_SETTINGS,
  LessorInvoiceScope,
  LessorInvoiceWhen,
  LessorInvoicingOverrideSchema,
  InvoicingSettingsSchema,
  lessorInvoiceAmount,
  lessorInvoiceKey,
  resolveInvoicingSettings,
  splitVatIncluded,
} from './index';

describe('lessor-invoicing', () => {
  it('los valores de fábrica son los conservadores: solo alquiler, sin IVA y a pedido', () => {
    expect(DEFAULT_INVOICING_SETTINGS).toEqual({ scope: 'Alquiler', when: 'Manual', vatPct: 0 });
    expect(OperationalDefaultsSchema.parse({}).invoicing).toEqual(DEFAULT_INVOICING_SETTINGS);
  });

  it('solo admite las alícuotas de ARCA y rechaza campos desconocidos', () => {
    expect(InvoicingSettingsSchema.safeParse({ vatPct: 21 }).success).toBe(true);
    expect(InvoicingSettingsSchema.safeParse({ vatPct: 13 }).success).toBe(false);
    expect(InvoicingSettingsSchema.safeParse({ other: 1 }).success).toBe(false);
    expect(LessorInvoicingOverrideSchema.safeParse({ scope: null, when: null, vatPct: null }).success).toBe(true);
  });

  describe('resolveInvoicingSettings', () => {
    const agency = { scope: LessorInvoiceScope.AlquilerPunitorios, when: LessorInvoiceWhen.AlPagar, vatPct: 21 };

    it('cada campo del locador pisa el de la inmobiliaria; el vacío lo hereda', () => {
      expect(resolveInvoicingSettings(agency, { when: LessorInvoiceWhen.Manual })).toEqual({
        scope: 'AlquilerPunitorios',
        when: 'Manual',
        vatPct: 21,
      });
      expect(resolveInvoicingSettings(agency, { vatPct: 0, scope: null })).toEqual({ scope: 'AlquilerPunitorios', when: 'AlPagar', vatPct: 0 });
    });

    it('sin nada guardado rige lo de fábrica', () => {
      expect(resolveInvoicingSettings(null, null)).toEqual(DEFAULT_INVOICING_SETTINGS);
      expect(resolveInvoicingSettings(undefined, undefined)).toEqual(DEFAULT_INVOICING_SETTINGS);
    });
  });

  describe('lessorInvoiceAmount', () => {
    const entries = [
      { type: 'Alquiler', amount: '100000.00' },
      { type: 'Punitorio', amount: '1500.50' },
      { type: 'ReintegroImpuesto', amount: '2000.00' },
      { type: 'Ajuste', amount: '10.00' },
      { type: 'Comision', amount: '-7000.00' },
      { type: 'Honorario', amount: '-500.00' },
      { type: 'CobroDirecto', amount: '-100000.00' },
    ];

    it('suma solo los conceptos del alcance, sin comisiones ni descuentos', () => {
      expect(lessorInvoiceAmount(entries, LessorInvoiceScope.Alquiler).toFixed(2)).toBe('100000.00');
      expect(lessorInvoiceAmount(entries, LessorInvoiceScope.AlquilerPunitorios).toFixed(2)).toBe('101500.50');
      expect(lessorInvoiceAmount(entries, LessorInvoiceScope.TodoLocador).toFixed(2)).toBe('103510.50');
    });

    it('nunca es negativo ni tiene decimales de más', () => {
      expect(lessorInvoiceAmount([{ type: 'Alquiler', amount: '-5' }], LessorInvoiceScope.Alquiler).toFixed(2)).toBe('0.00');
      expect(lessorInvoiceAmount([], LessorInvoiceScope.Alquiler).toFixed(2)).toBe('0.00');
      expect(
        lessorInvoiceAmount([{ type: 'Alquiler', amount: '0.1' }, { type: 'Alquiler', amount: '0.2' }], LessorInvoiceScope.Alquiler).toFixed(2),
      ).toBe('0.30');
    });
  });

  describe('splitVatIncluded', () => {
    it('separa el IVA incluido y el neto más el IVA da el total exacto', () => {
      const { neto, iva, vatPct } = splitVatIncluded('121000.00', 21, 'A');
      expect(neto.toFixed(2)).toBe('100000.00');
      expect(iva.toFixed(2)).toBe('21000.00');
      expect(vatPct).toBe(21);
      const odd = splitVatIncluded('100.00', 21, 'B');
      expect(odd.neto.plus(odd.iva).toFixed(2)).toBe('100.00');
    });

    it('una factura C o un IVA de 0 no discriminan nada', () => {
      expect(splitVatIncluded('100', 21, 'C')).toMatchObject({ vatPct: 0 });
      expect(splitVatIncluded('100', 21, 'C').iva.toFixed(2)).toBe('0.00');
      expect(splitVatIncluded('100', 0, 'A').neto.toFixed(2)).toBe('100.00');
    });
  });

  it('la clave de un origen y un locador es estable', () => {
    expect(lessorInvoiceKey('Factura', 'Payment', 'x', 'p')).toBe('lessor:Factura:Payment:x:p');
    expect(lessorInvoiceKey('NotaCredito', 'OwnerStatement', 'x', 'p')).not.toBe(lessorInvoiceKey('Factura', 'OwnerStatement', 'x', 'p'));
  });
});
