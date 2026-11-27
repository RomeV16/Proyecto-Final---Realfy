import { describe, expect, it } from 'vitest';
import { EmitNotaCreditoDtoSchema } from '@realfy/shared';
import {
  buildCreditNotePayload,
  creditableAmount,
  creditNoteType,
  localToday,
  type OriginalVoucher,
} from './credit-note-payload';

const ISSUER = '506bf2a6-1397-42e1-ac08-d585e18912dc';
const REQUEST = '7f1f3b0e-6a52-4f0c-9d43-0c1f4f4f9a11';

function facturaC(overrides: Partial<OriginalVoucher> = {}): OriginalVoucher {
  return {
    id: 'edf0b9cf-6e2d-447e-98e3-aa059f9e343c',
    type: 'FacturaC',
    puntoDeVenta: 1,
    numero: 2,
    cbteTipo: 11,
    concepto: 2,
    issuerId: ISSUER,
    impTotal: '634047.39',
    impNeto: '634047.39',
    impIva: '0',
    impTotConc: '0',
    impOpEx: '0',
    impTrib: '0',
    monId: 'PES',
    monCotiz: '1',
    ivaArray: null,
    receptorName: 'Diego Sosa',
    receptorFiscalCondition: 'ConsumidorFinal',
    docNro: '23319273964',
    docTipo: 80,
    condicionIVAReceptorId: 5,
    ...overrides,
  };
}

const input = { amount: 634047.39, description: 'Anulación', clientRequestId: REQUEST, today: '2026-11-27' };

describe('buildCreditNotePayload', () => {
  it('a cada factura le corresponde su nota de crédito', () => {
    expect(creditNoteType(1)).toBe(3);
    expect(creditNoteType(6)).toBe(8);
    expect(creditNoteType(11)).toBe(13);
  });

  it('la nota de crédito total de una factura C cumple el contrato de la API y no lleva IVA', () => {
    const payload = buildCreditNotePayload(facturaC(), input);
    const parsed = EmitNotaCreditoDtoSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    expect(payload).toMatchObject({
      issuerId: ISSUER,
      ptoVta: 1,
      cbteTipo: 13,
      concepto: 2,
      cbteFch: '2026-11-27',
      impTotal: '634047.39',
      impNeto: '634047.39',
      impIVA: '0.00',
      fchServDesde: '2026-11-27',
      fchServHasta: '2026-11-27',
      fchVtoPago: '2026-11-27',
      cbtesAsoc: [{ tipo: 11, ptoVta: 1, nro: 2 }],
      receptor: { docTipo: 80, docNro: '23319273964', businessName: 'Diego Sosa', fiscalCondition: 'ConsumidorFinal' },
    });
    expect(payload).not.toHaveProperty('iva');
  });

  it('una nota parcial de una factura A guarda la proporción de IVA y la suma cierra', () => {
    const original = facturaC({
      type: 'FacturaA',
      cbteTipo: 1,
      impTotal: '121000',
      impNeto: '100000',
      impIva: '21000',
      receptorFiscalCondition: 'ResponsableInscripto',
      condicionIVAReceptorId: 1,
      ivaArray: [{ Id: 5, BaseImp: 100000, Importe: 21000 }],
      fchServDesde: '2026-10-01T00:00:00.000Z',
      fchServHasta: '2026-10-31T00:00:00.000Z',
    });
    const payload = buildCreditNotePayload(original, { ...input, amount: 1000.01 });
    expect(EmitNotaCreditoDtoSchema.safeParse(payload).success).toBe(true);
    expect(payload).toMatchObject({
      cbteTipo: 3,
      impTotal: '1000.01',
      impIVA: '173.56',
      impNeto: '826.45',
      iva: [{ id: 5, baseImp: '826.45', importe: '173.56' }],
      fchServDesde: '2026-10-01',
      fchServHasta: '2026-10-31',
    });
  });

  it('las fechas de servicio que se cargan pisan las del original', () => {
    const payload = buildCreditNotePayload(facturaC(), { ...input, serviceFrom: '2026-09-01', serviceTo: '2026-09-30' });
    expect(payload).toMatchObject({ fchServDesde: '2026-09-01', fchServHasta: '2026-09-30' });
  });

  it('una factura de productos no manda período de servicio', () => {
    const payload = buildCreditNotePayload(facturaC({ concepto: 1 }), input);
    expect(EmitNotaCreditoDtoSchema.safeParse(payload).success).toBe(true);
    expect(payload).not.toHaveProperty('fchServDesde');
    expect(payload).not.toHaveProperty('fchVtoPago');
  });

  it('una nota de débito se acredita con la nota de crédito de su misma letra', () => {
    expect(creditNoteType(2)).toBe(3);
    expect(creditNoteType(7)).toBe(8);
    expect(creditNoteType(12)).toBe(13);
  });

  it('una factura B al 0 % manda su alícuota para que no se le discrimine IVA', () => {
    const original = facturaC({
      type: 'FacturaB',
      cbteTipo: 6,
      impTotal: '50000',
      impNeto: '50000',
      impIva: '0',
      ivaArray: [{ Id: 3, BaseImp: 50000, Importe: 0 }],
    });
    const payload = buildCreditNotePayload(original, { ...input, amount: 12345.67 });
    expect(EmitNotaCreditoDtoSchema.safeParse(payload).success).toBe(true);
    expect(payload).toMatchObject({
      cbteTipo: 8,
      impTotal: '12345.67',
      impNeto: '12345.67',
      impIVA: '0.00',
      iva: [{ id: 3, baseImp: '12345.67', importe: '0.00' }],
    });
  });

  it('con varias alícuotas las bases suman el neto y los importes el IVA, al centavo', () => {
    const original = facturaC({
      type: 'FacturaA',
      cbteTipo: 1,
      impTotal: '331.50',
      impNeto: '300',
      impIva: '31.50',
      ivaArray: [
        { Id: 5, BaseImp: 100, Importe: 21 },
        { Id: 4, BaseImp: 100, Importe: 10.5 },
        { Id: 3, BaseImp: 100, Importe: 0 },
      ],
    });
    for (const amount of [331.5, 100, 0.05, 33.33, 211.11]) {
      const payload = buildCreditNotePayload(original, { ...input, amount }) as {
        impTotal: string;
        impNeto: string;
        impIVA: string;
        iva: { baseImp: string; importe: string }[];
      };
      expect(EmitNotaCreditoDtoSchema.safeParse(payload).success).toBe(true);
      const cents = (values: string[]) => values.reduce((sum, v) => sum + Math.round(Number(v) * 100), 0);
      expect(cents(payload.iva.map((i) => i.baseImp))).toBe(cents([payload.impNeto]));
      expect(cents(payload.iva.map((i) => i.importe))).toBe(cents([payload.impIVA]));
      expect(cents([payload.impNeto, payload.impIVA])).toBe(cents([payload.impTotal]));
    }
  });

  it('lo acreditable descuenta las notas de crédito que el comprobante ya tiene', () => {
    expect(creditableAmount({ impTotal: '634047.39' })).toBe(634047.39);
    expect(creditableAmount({ impTotal: '634047.39', creditNotes: [] })).toBe(634047.39);
    expect(creditableAmount({ impTotal: '1000.10', creditNotes: [{ impTotal: '400.05' }, { impTotal: '100' }] })).toBe(500.05);
    expect(creditableAmount({ impTotal: '1000', creditNotes: [{ impTotal: '1000' }] })).toBe(0);
    expect(creditableAmount({ impTotal: '1000', creditNotes: [{ impTotal: '1200' }] })).toBe(0);
  });

  it('localToday da la fecha local en AAAA-MM-DD', () => {
    expect(localToday(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});
