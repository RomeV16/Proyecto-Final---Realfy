import { rentasCordoba, normalizeRentasAccount } from './rentas-cordoba';
import { rentasCurrentLines, rentasLegacyLines } from './bill-text.testing';

const read = (lines: string[]) => rentasCordoba.parse(lines.join('\n'));

describe('lector de Rentas de Córdoba', () => {
  it('lee el cedulón actual: cuenta, cuota, total de impuestos provinciales y vencimiento', () => {
    const data = read(rentasCurrentLines())!;
    expect(data.providerKey).toBe('rentas-cordoba');
    expect(data.accountNumbers).toEqual(['110000000001']);
    expect(data.issueDate).toBe('2026-11-10');
    expect(data.lines).toEqual([
      expect.objectContaining({ period: '2026-11-01', amount: '18303.87', dueDate: '2026-11-19', paymentCode: '0640050000000000001' }),
    ]);
    expect(data.confidence).toBe(1);
  });

  it('lee el cedulón anterior (Mis Impuestos): cuenta tras "N", importe con ".-" y vencimiento después de la etiqueta', () => {
    const data = read(rentasLegacyLines())!;
    expect(data.accountNumbers).toEqual(['110000000001']);
    expect(data.lines).toEqual([
      expect.objectContaining({ period: '2026-11-01', amount: '1273.60', dueDate: '2026-11-17', paymentCode: '0640050000000000002' }),
    ]);
  });

  it('una liquidación de deuda con varias cuotas baja la confianza para que la vea una persona', () => {
    const lines = rentasLegacyLines();
    lines.splice(9, 0, '2026/12 $100,00', '2027/01 $100,00');
    const data = read(lines)!;
    expect(data.warnings).toContain('MULTIPLE_PERIODS');
    expect(data.confidence).toBeLessThanOrEqual(0.5);
  });

  it('sin cuenta baja la confianza; sin importe no hay boleta; sin nada no hay lectura', () => {
    const noAccount = read(rentasCurrentLines().filter((l) => !l.startsWith('Número de cuenta')))!;
    expect(noAccount.accountNumbers).toEqual([]);
    expect(noAccount.confidence).toBeLessThan(0.8);

    const noAmount = read(['Cedulón F-1010', 'Número de cuenta 110000000001'])!;
    expect(noAmount.lines).toEqual([]);
    expect(noAmount.warnings).toContain('NO_BILL_LINE');

    expect(read(['nada de una boleta'])).toBeNull();
  });

  it.each([
    ['110000000001', '110000000001'],
    ['1100-00000001', '110000000001'],
    [' 1100 0000 0001 ', '110000000001'],
  ])('normaliza la cuenta %s', (raw, expected) => {
    expect(normalizeRentasAccount(raw)).toBe(expected);
    expect(rentasCordoba.accountSchema.parse(raw)).toBe(expected);
  });

  it.each(['', '12345', '1100000000012', 'abc'])('rechaza la cuenta %j', (raw) => {
    expect(rentasCordoba.accountSchema.safeParse(raw).success).toBe(false);
  });
});
