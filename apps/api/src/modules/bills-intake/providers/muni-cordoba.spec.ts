import { muniCordoba, normalizeMuniAccount } from './muni-cordoba';
import { muniCurrentLines, muniLegacyLines } from './bill-text.testing';

const read = (lines: string[]) => muniCordoba.parse(lines.join('\n'));

describe('lector de la Municipalidad de Córdoba', () => {
  it('lee el cedulón actual: cuenta, período, importe, vencimiento y código de pago', () => {
    const data = read(muniCurrentLines())!;
    expect(data.providerKey).toBe('muni-cordoba');
    expect(data.accountNumbers).toEqual(['I0000001', '012345678901200']);
    expect(data.issueDate).toBe('2026-11-02');
    expect(data.lines).toEqual([
      expect.objectContaining({
        period: '2026-11-01',
        amount: '12345.67',
        dueDate: '2026-12-14',
        secondDueDate: null,
        paymentCode: '0123456789012345',
      }),
    ]);
    expect(data.confidence).toBe(1);
    expect(data.warnings).toEqual([]);
  });

  it('con dos vencimientos toma el primero como principal y el segundo con su importe', () => {
    const data = read(
      muniCurrentLines({
        venc: [
          { date: '30/12/2026', amount: '$13.000,00' },
          { date: '14/12/2026', amount: '$12.345,67' },
        ],
      }),
    )!;
    expect(data.lines[0]).toMatchObject({ dueDate: '2026-12-14', amount: '12345.67', secondDueDate: '2026-12-30', secondAmount: '13000.00' });
  });

  it('lee el importe con descuento y punto decimal ("Venc. fecha 0.00 34,499.00")', () => {
    const data = read(muniCurrentLines({ venc: [{ date: '06/10/2026', amount: '0.00 34,499.00' }] }))!;
    expect(data.lines[0]).toMatchObject({ amount: '34499.00', dueDate: '2026-10-06' });
  });

  it('lee el cedulón anterior (tabla de períodos y total)', () => {
    const data = read(muniLegacyLines())!;
    expect(data.accountNumbers).toEqual(['012345678901200']);
    expect(data.lines).toEqual([expect.objectContaining({ period: '2026-10-01', amount: '490.00', dueDate: '2026-11-10' })]);
    expect(data.confidence).toBe(1);
  });

  it('lee las fechas y el total del cedulón anterior en las dos disposiciones del formulario', () => {
    const lines = [
      'Contribución sobre',
      'INMUEBLES',
      'ITEM',
      '1.01.01.01 IDENTIFICACION TRIBUTARIA',
      'NUMERO DE CONTROL',
      '012345678901200/1 123456789012',
      'CUIT: 00-00000000-0 Ident. Tributaria: 012345678901200/1',
      'EMISION',
      'VENCIMIENTO',
      'TOTAL A PAGAR $ 1.710,00',
      '25/02/2026',
      '12/08/2026',
      'PERIODO DEUDA RECARGO DEDUCCION NETO',
      '2026/007 $ 1.710,00 $ 0,00 $ 1.710,00',
    ];
    const data = read(lines)!;
    expect(data.accountNumbers).toEqual(['012345678901200']);
    expect(data.lines[0]).toMatchObject({ period: '2026-07-01', amount: '1710.00', dueDate: '2026-08-12' });
  });

  it('un cedulón con varias cuotas (deuda) baja la confianza para que lo vea una persona', () => {
    const lines = muniLegacyLines();
    lines.splice(8, 0, '2026/011', '2026/012');
    const data = read(lines)!;
    expect(data.warnings).toContain('MULTIPLE_PERIODS');
    expect(data.confidence).toBeLessThanOrEqual(0.5);
  });

  it('sin la cuenta o sin cuota la confianza baja; sin nada que leer no hay lectura', () => {
    const noAccount = read(muniCurrentLines({ objeto: 'X', identificador: 'sin dato' }).filter((l) => !/Part\.Muni|NC:|Inmueble:/.test(l)))!;
    expect(noAccount.accountNumbers).toEqual([]);
    expect(noAccount.warnings).toContain('NO_ACCOUNT');
    expect(noAccount.confidence).toBeLessThan(0.8);

    const noPeriod = read(muniCurrentLines().filter((l) => !/^Año Cuota|^2026 11$/.test(l)))!;
    expect(noPeriod.lines).toEqual([]);
    expect(noPeriod.warnings).toContain('NO_BILL_LINE');

    expect(read(['Un texto cualquiera sin nada de una boleta'])).toBeNull();
  });

  describe('identificador de cuenta', () => {
    it.each([
      ['I0529520', 'I0529520'],
      ['i0529520', 'I0529520'],
      ['12-14-009-028', '121400902800000'],
      ['12-14-009-028-00007', '121400902800007'],
      ['121400902800007', '121400902800007'],
      ['121400902800007/4', '121400902800007'],
    ])('normaliza %s a %s', (raw, expected) => {
      expect(normalizeMuniAccount(raw)).toBe(expected);
      expect(muniCordoba.accountSchema.parse(raw)).toBe(expected);
    });

    it.each(['', '123', 'I12', '12345678901234567890'])('rechaza %j', (raw) => {
      expect(normalizeMuniAccount(raw)).toBeNull();
      expect(muniCordoba.accountSchema.safeParse(raw).success).toBe(false);
    });
  });

  it('se reconoce por el texto del cedulón y no por cualquier página de la Municipalidad', () => {
    const matches = (text: string) => muniCordoba.signatures.some((re) => re.test(text));
    expect(matches('Contribución sobre los Inmuebles')).toBe(true);
    expect(matches('CONTRIBUCION SOBRE INMUEBLES')).toBe(true);
    expect(matches('Municipalidad de Córdoba - Informe de deuda')).toBe(false);
  });
});
