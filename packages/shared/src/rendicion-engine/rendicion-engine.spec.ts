import Decimal from 'decimal.js';
import { CommissionType, RendicionLineItemType as T } from '../enums';
import { buildRendicionFromPayments } from './index';

/**
 * Valores esperados calculados a mano antes de correr la prueba (ver el
 * cálculo en el comentario de cada caso).
 */
const resumen = (r: ReturnType<typeof buildRendicionFromPayments>) => ({
  rent: r.rentCollected.toFixed(2),
  commission: r.commissionAmount.toFixed(2),
  adminFee: r.adminFeeAmount.toFixed(2),
  deductions: r.deductionTotal.toFixed(2),
  net: r.netDeposit.toFixed(2),
});
const lineas = (r: ReturnType<typeof buildRendicionFromPayments>) =>
  r.lineItems.map((l) => [l.type, l.description, l.amount.toFixed(2)]);

const porcentaje = (p: number | string) => ({ type: CommissionType.FixedPercent, percentage: p });

describe('rendicion-engine — rendición completa', () => {
  it('un pago, comisión porcentual, gastos y una deducción', () => {
    // comisión 100000 × 5 % = 5000
    // neto = 100000 - 5000 - 1000 - 2500 = 91500
    const r = buildRendicionFromPayments(
      [{ amount: '100000', description: 'Alquiler octubre' }],
      { ...porcentaje(5), adminFee: '1000' },
      [{ amount: '2500', description: 'Reparación de canilla' }],
    );

    expect(resumen(r)).toEqual({
      rent: '100000.00',
      commission: '5000.00',
      adminFee: '1000.00',
      deductions: '2500.00',
      net: '91500.00',
    });
    expect(lineas(r)).toEqual([
      [T.Alquiler, 'Alquiler octubre', '100000.00'],
      [T.Comision, 'Comisión', '5000.00'],
      [T.AdminFee, 'Gastos administrativos', '1000.00'],
      [T.Deduccion, 'Reparación de canilla', '2500.00'],
    ]);
  });

  it('varios pagos se suman y generan una línea cada uno, en orden', () => {
    // 60000,50 + 39999,50 = 100000 ; comisión 4 % = 4000 ; neto 96000
    const r = buildRendicionFromPayments(
      [
        { amount: '60000.50', description: 'Pago 1' },
        { amount: '39999.50', description: 'Pago 2' },
      ],
      porcentaje(4),
    );

    expect(resumen(r)).toEqual({
      rent: '100000.00',
      commission: '4000.00',
      adminFee: '0.00',
      deductions: '0.00',
      net: '96000.00',
    });
    expect(lineas(r)).toEqual([
      [T.Alquiler, 'Pago 1', '60000.50'],
      [T.Alquiler, 'Pago 2', '39999.50'],
      [T.Comision, 'Comisión', '4000.00'],
    ]);
  });

  it('comisión mixta: fijo 500 + 2 % de 50000 y gastos 250', () => {
    // comisión = 500 + 1000 = 1500 ; neto = 50000 - 1500 - 250 = 48250
    const r = buildRendicionFromPayments(
      [{ amount: 50000, description: 'Alquiler' }],
      { type: CommissionType.Mixed, fixedAmount: 500, percentage: 2, adminFee: 250 },
    );

    expect(resumen(r)).toEqual({
      rent: '50000.00',
      commission: '1500.00',
      adminFee: '250.00',
      deductions: '0.00',
      net: '48250.00',
    });
  });

  it('comisión de monto fijo no depende del alquiler', () => {
    // neto = 20000 - 3000
    const r = buildRendicionFromPayments(
      [{ amount: 20000, description: 'Alquiler' }],
      { type: CommissionType.FixedAmount, fixedAmount: 3000 },
    );

    expect(resumen(r).net).toBe('17000.00');
  });
});

describe('rendicion-engine — líneas', () => {
  it('sin gastos administrativos no hay línea AdminFee', () => {
    const r = buildRendicionFromPayments([{ amount: 1000, description: 'A' }], porcentaje(10));

    expect(r.lineItems.map((l) => l.type)).toEqual([T.Alquiler, T.Comision]);
  });

  it('gastos de 0,004 se redondean a 0 y tampoco generan línea', () => {
    const r = buildRendicionFromPayments(
      [{ amount: 1000, description: 'A' }],
      { ...porcentaje(10), adminFee: '0.004' },
    );

    expect(r.lineItems.map((l) => l.type)).toEqual([T.Alquiler, T.Comision]);
  });

  it('gastos de 0,005 se redondean a 0,01 y sí generan línea', () => {
    const r = buildRendicionFromPayments(
      [{ amount: 1000, description: 'A' }],
      { ...porcentaje(10), adminFee: '0.005' },
    );

    expect(lineas(r)[2]).toEqual([T.AdminFee, 'Gastos administrativos', '0.01']);
  });

  it('la línea de comisión se emite aunque sea 0,00', () => {
    const r = buildRendicionFromPayments([{ amount: 1000, description: 'A' }], porcentaje(0));

    expect(lineas(r)[1]).toEqual([T.Comision, 'Comisión', '0.00']);
  });

  it('las deducciones van al final, una línea por cada una', () => {
    const r = buildRendicionFromPayments(
      [{ amount: 1000, description: 'A' }],
      porcentaje(0),
      [
        { amount: 10, description: 'D1' },
        { amount: 20, description: 'D2' },
      ],
    );

    expect(r.lineItems.slice(-2).map((l) => [l.type, l.description])).toEqual([
      [T.Deduccion, 'D1'],
      [T.Deduccion, 'D2'],
    ]);
  });

  it('los montos de las líneas son Decimal', () => {
    const r = buildRendicionFromPayments([{ amount: 1, description: 'A' }], porcentaje(1));

    for (const l of r.lineItems) expect(l.amount).toBeInstanceOf(Decimal);
  });
});

describe('rendicion-engine — redondeo', () => {
  it('3 pagos de 33,333: las líneas suman 99,99 y el cobrado es 99,99 (DEF-12)', () => {
    // cada línea 33,33 ; cobrado = suma de las líneas = 99,99
    // comisión 3,5 % de 99,99 = 3,49965 -> 3,50 ; neto 99,99 - 3,50 = 96,49
    const r = buildRendicionFromPayments(
      [
        { amount: '33.333', description: 'P1' },
        { amount: '33.333', description: 'P2' },
        { amount: '33.333', description: 'P3' },
      ],
      porcentaje('3.5'),
    );

    expect(resumen(r)).toEqual({
      rent: '99.99',
      commission: '3.50',
      adminFee: '0.00',
      deductions: '0.00',
      net: '96.49',
    });
    expect(lineas(r).slice(0, 3).map((l) => l[2])).toEqual(['33.33', '33.33', '33.33']);
  });

  it('la comisión se calcula sobre el cobrado ya redondeado', () => {
    // pago 100,005 -> cobrado 100,01 ; 5 % = 5,0005 -> 5,00 ; neto 95,01
    const r = buildRendicionFromPayments([{ amount: '100.005', description: 'P' }], porcentaje(5));

    expect(resumen(r)).toMatchObject({ rent: '100.01', commission: '5.00', net: '95.01' });
  });

  it('dos deducciones de 10,005: las líneas suman 20,02 y el total es 20,02 (DEF-12)', () => {
    // cada línea 10,01 ; total = suma de las líneas = 20,02 ; neto = 1000 - 20,02 = 979,98
    const r = buildRendicionFromPayments(
      [{ amount: 1000, description: 'A' }],
      porcentaje(0),
      [
        { amount: '10.005', description: 'D1' },
        { amount: '10.005', description: 'D2' },
      ],
    );

    expect(resumen(r)).toMatchObject({ deductions: '20.02', net: '979.98' });
    expect(lineas(r).slice(-2).map((l) => l[2])).toEqual(['10.01', '10.01']);
  });

  it('frontera: 0,10 cobrado con 5 % da comisión 0,01 y neto 0,09', () => {
    // 0,10 × 0,05 = 0,005 -> 0,01
    const r = buildRendicionFromPayments([{ amount: '0.10', description: 'A' }], porcentaje(5));

    expect(resumen(r)).toMatchObject({ commission: '0.01', net: '0.09' });
  });
});

describe('rendicion-engine — el documento suma (DEF-12)', () => {
  it('cobrado y deducciones son la suma de las líneas redondeadas', () => {
    const r = buildRendicionFromPayments(
      [
        { amount: '10.004', description: 'P1' },
        { amount: '10.004', description: 'P2' },
        { amount: '10.004', description: 'P3' },
        { amount: '0.006', description: 'P4' },
      ],
      porcentaje(0),
      [
        { amount: '1.005', description: 'D1' },
        { amount: '2.005', description: 'D2' },
      ],
    );

    const sum = (type: T) =>
      r.lineItems
        .filter((l) => l.type === type)
        .reduce((acc, l) => acc.plus(l.amount), new Decimal(0))
        .toFixed(2);

    expect(r.rentCollected.toFixed(2)).toBe(sum(T.Alquiler));
    expect(r.deductionTotal.toFixed(2)).toBe(sum(T.Deduccion));
    // 10,00 x 3 + 0,01 = 30,01 ; 1,01 + 2,01 = 3,02 (sin redondear sumarían 30,02 y 3,01) ; neto = 30,01 - 3,02
    expect(resumen(r)).toMatchObject({ rent: '30.01', deductions: '3.02', net: '26.99' });
  });
});

describe('rendicion-engine — bordes', () => {
  it('sin pagos y comisión porcentual: todo en cero y solo la línea de comisión', () => {
    const r = buildRendicionFromPayments([], porcentaje(5));

    expect(resumen(r)).toEqual({
      rent: '0.00',
      commission: '0.00',
      adminFee: '0.00',
      deductions: '0.00',
      net: '0.00',
    });
    expect(lineas(r)).toEqual([[T.Comision, 'Comisión', '0.00']]);
  });

  it('sin pagos y comisión fija: el neto es negativo', () => {
    // 0 - 100 = -100
    const r = buildRendicionFromPayments([], { type: CommissionType.FixedAmount, fixedAmount: 100 });

    expect(resumen(r).net).toBe('-100.00');
    expect(lineas(r)).toEqual([[T.Comision, 'Comisión', '100.00']]);
  });

  it('las deducciones son opcionales', () => {
    const r = buildRendicionFromPayments([{ amount: 100, description: 'A' }], porcentaje(0));

    expect(r.deductionTotal.toFixed(2)).toBe('0.00');
    expect(r.lineItems.some((l) => l.type === T.Deduccion)).toBe(false);
  });

  it('deducciones mayores al cobrado dejan neto negativo', () => {
    // comisión 10 % de 1000 = 100 ; neto = 1000 - 100 - 1200 = -300
    const r = buildRendicionFromPayments(
      [{ amount: 1000, description: 'A' }],
      porcentaje(10),
      [{ amount: 1200, description: 'Obra' }],
    );

    expect(resumen(r).net).toBe('-300.00');
  });

  it('acepta montos como string, number y Decimal', () => {
    // 10 + 20 + 30 = 60
    const r = buildRendicionFromPayments(
      [
        { amount: '10', description: 'a' },
        { amount: 20, description: 'b' },
        { amount: new Decimal(30), description: 'c' },
      ],
      porcentaje(0),
    );

    expect(r.rentCollected.toFixed(2)).toBe('60.00');
  });
});

describe('rendicion-engine — montos negativos (CP-243, DEF-23)', () => {
  const capturar = (fn: () => unknown): { code?: string; message?: string } | undefined => {
    try {
      fn();
    } catch (err) {
      return err as { code?: string; message?: string };
    }
    return undefined;
  };

  it('una deducción negativa se rechaza en lugar de subir el neto', () => {
    // sin validar: 100000 - 0 - (-5000) = 105000 de neto
    const error = capturar(() =>
      buildRendicionFromPayments(
        [{ amount: 100000, description: 'Alquiler' }],
        porcentaje(0),
        [{ amount: -5000, description: 'Descuento falso' }],
      ),
    );

    expect(error?.code).toBe('INVALID_LINE_AMOUNT');
  });

  it('un pago negativo se rechaza aunque el cobrado total siga siendo positivo', () => {
    // 100000 + (-20000) = 80000: la comisión no lo detecta
    const error = capturar(() =>
      buildRendicionFromPayments(
        [
          { amount: 100000, description: 'Alquiler' },
          { amount: -20000, description: 'Reverso' },
        ],
        porcentaje(5),
      ),
    );

    expect(error?.code).toBe('INVALID_LINE_AMOUNT');
  });

  it('el mensaje indica qué renglón es inválido', () => {
    const error = capturar(() =>
      buildRendicionFromPayments([{ amount: 100, description: 'Alquiler' }], porcentaje(0), [
        { amount: -1, description: 'Ajuste' },
      ]),
    );

    expect(error?.message).toContain('Ajuste');
  });

  it('el cero es un monto válido', () => {
    const r = buildRendicionFromPayments(
      [{ amount: 0, description: 'Sin cobro' }],
      porcentaje(0),
      [{ amount: 0, description: 'Nada' }],
    );

    expect(r.netDeposit.toFixed(2)).toBe('0.00');
  });
});
