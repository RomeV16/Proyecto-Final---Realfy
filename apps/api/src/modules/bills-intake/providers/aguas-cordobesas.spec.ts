import { aguasCordobesas, normalizeAguasAccount } from './aguas-cordobesas';
import { aguasInvoiceLines, aguasStatementLines } from './bill-text.testing';

const read = (lines: string[]) => aguasCordobesas.parse(lines.join('\n'));

describe('lector de Aguas Cordobesas', () => {
  it('lee la factura: UF, período comercial, total, vencimientos y clave de pago', () => {
    const data = read(aguasInvoiceLines())!;
    expect(data.providerKey).toBe('aguas-cordobesas');
    expect(data.accountNumbers).toEqual(['100001']);
    expect(data.issueDate).toBe('2026-11-02');
    expect(data.lines).toEqual([
      expect.objectContaining({
        period: '2026-11-01',
        amount: '22238.93',
        dueDate: '2026-11-12',
        secondDueDate: '2026-11-20',
        secondAmount: '22900.10',
        paymentCode: '123456',
      }),
    ]);
    expect(data.confidence).toBe(1);
  });

  it('lee la factura con guiones tipográficos y sin la tabla de vencimientos (usa "Fecha Vto.")', () => {
    const lines = aguasInvoiceLines({ venc: [] }).map((l) => l.replace('FC 0010 - 00000001', 'FC 0010 − 00000001'));
    const data = read(lines)!;
    expect(data.lines[0]).toMatchObject({ dueDate: '2026-11-12', secondDueDate: null });
  });

  it('lee el resumen de cuenta: una boleta por comprobante, con el importe histórico', () => {
    const data = read(
      aguasStatementLines([
        { num: 'FC-0010-00000001', periodo: '10/2026', venc: '12/10/2026', amount: '463,07' },
        { num: 'FC-0010-00000002', periodo: '11/2026', venc: '12/11/2026', amount: '470,10' },
      ]),
    )!;
    expect(data.accountNumbers).toEqual(['100001']);
    expect(data.lines).toEqual([
      expect.objectContaining({ period: '2026-10-01', amount: '463.07', dueDate: '2026-10-12', paymentCode: 'FC-0010-00000001' }),
      expect.objectContaining({ period: '2026-11-01', amount: '470.10', dueDate: '2026-11-12' }),
    ]);
  });

  it('un resumen sin comprobantes pendientes da la cuenta y ninguna boleta, con confianza baja', () => {
    const data = read(['RESUMEN DE COMPROBANTES VIGENTES', 'UNIDAD DE FACTURACIÓN: 100001', 'Su cuenta no posee comprobantes pendientes de pago.'])!;
    expect(data.lines).toEqual([]);
    expect(data.warnings).toContain('NO_BILL_LINE');
    expect(data.confidence).toBeLessThan(0.8);
  });

  it('sin UF baja la confianza; sin nada que leer no hay lectura', () => {
    const data = read(aguasInvoiceLines().filter((l) => l !== 'UNIDAD DE FACTURACIÓN' && l !== '100001'))!;
    expect(data.accountNumbers).toEqual([]);
    expect(data.confidence).toBeLessThan(0.8);
    expect(read(['nada de una boleta'])).toBeNull();
  });

  it.each([
    ['100001', '100001'],
    ['UF 100001', '100001'],
    ['1234', '001234'],
    ['  000012 ', '000012'],
  ])('normaliza la UF %s a %s', (raw, expected) => {
    expect(normalizeAguasAccount(raw)).toBe(expected);
    expect(aguasCordobesas.accountSchema.parse(raw)).toBe(expected);
  });

  it.each(['', 'abc', '1234567'])('rechaza la UF %j', (raw) => {
    expect(aguasCordobesas.accountSchema.safeParse(raw).success).toBe(false);
  });
});
