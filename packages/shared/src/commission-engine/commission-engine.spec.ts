import Decimal from 'decimal.js';
import { CommissionType } from '../enums';
import { calculateCommission } from './index';

/**
 * Valores esperados calculados a mano antes de correr la prueba (ver el
 * cálculo en el comentario de cada caso): el motor no puede ser su propio
 * oráculo. Se compara con toFixed(2) para que la igualdad sea exacta y no
 * dependa de la representación interna del Decimal.
 */
const fmt = (r: ReturnType<typeof calculateCommission>) => ({
  commission: r.commissionAmount.toFixed(2),
  adminFee: r.adminFeeAmount.toFixed(2),
  total: r.totalDeducted.toFixed(2),
});

describe('commission-engine — porcentaje fijo', () => {
  it('5 % de 100000 es 5000,00 y sin gastos el total coincide', () => {
    // 100000 × 0,05 = 5000
    const r = calculateCommission('100000', { type: CommissionType.FixedPercent, percentage: 5 });

    expect(fmt(r)).toEqual({ commission: '5000.00', adminFee: '0.00', total: '5000.00' });
  });

  it('suma los gastos administrativos al total', () => {
    // 85000 × 0,035 = 2975 ; 2975 + 1500,50 = 4475,50
    const r = calculateCommission('85000', {
      type: CommissionType.FixedPercent,
      percentage: '3.5',
      adminFee: '1500.50',
    });

    expect(fmt(r)).toEqual({ commission: '2975.00', adminFee: '1500.50', total: '4475.50' });
  });

  it('porcentaje con muchos decimales: 7,125 % de 12345,67 redondea a 879,63', () => {
    // 12345,67 × 0,07125 = 879,6289875 -> 879,63
    const r = calculateCommission('12345.67', {
      type: CommissionType.FixedPercent,
      percentage: '7.125',
    });

    expect(r.commissionAmount.toFixed(2)).toBe('879.63');
  });

  it('porcentaje periódico: 8,3333 % de 90000 da 7499,97 exacto', () => {
    // 90000 × 0,083333 = 7499,97
    const r = calculateCommission(90000, {
      type: CommissionType.FixedPercent,
      percentage: 8.3333,
    });

    expect(r.commissionAmount.toFixed(2)).toBe('7499.97');
  });

  describe('frontera de 0,005 (redondeo half-up)', () => {
    it('100,10 × 5 % = 5,005 sube a 5,01', () => {
      const r = calculateCommission('100.10', { type: CommissionType.FixedPercent, percentage: 5 });
      expect(r.commissionAmount.toFixed(2)).toBe('5.01');
    });

    it('0,10 × 5 % = 0,005 sube a 0,01', () => {
      const r = calculateCommission('0.10', { type: CommissionType.FixedPercent, percentage: 5 });
      expect(r.commissionAmount.toFixed(2)).toBe('0.01');
    });

    it('0,09 × 5 % = 0,0045 baja a 0,00', () => {
      const r = calculateCommission('0.09', { type: CommissionType.FixedPercent, percentage: 5 });
      expect(r.commissionAmount.toFixed(2)).toBe('0.00');
    });

    it('un monto negativo redondea alejándose del cero: -100,10 × 5 % = -5,005 da -5,01', () => {
      const r = calculateCommission('-100.10', { type: CommissionType.FixedPercent, percentage: 5 });
      expect(r.commissionAmount.toFixed(2)).toBe('-5.01');
    });
  });

  it('100 % se queda con todo y un porcentaje mayor a 100 no se valida', () => {
    // 100 × 1 = 100 ; 100 × 1,5 = 150
    expect(
      calculateCommission('100', { type: CommissionType.FixedPercent, percentage: 100 })
        .commissionAmount.toFixed(2),
    ).toBe('100.00');
    expect(
      calculateCommission('100', { type: CommissionType.FixedPercent, percentage: 150 })
        .commissionAmount.toFixed(2),
    ).toBe('150.00');
  });
});

describe('commission-engine — monto fijo', () => {
  it('ignora el alquiler y el porcentaje', () => {
    const r = calculateCommission('999999', {
      type: CommissionType.FixedAmount,
      fixedAmount: '25000',
      percentage: 50,
    });

    expect(fmt(r)).toEqual({ commission: '25000.00', adminFee: '0.00', total: '25000.00' });
  });

  it('redondea el monto fijo a 2 decimales: 25000,555 sube y 12,344 baja', () => {
    expect(
      calculateCommission(1, { type: CommissionType.FixedAmount, fixedAmount: '25000.555' })
        .commissionAmount.toFixed(2),
    ).toBe('25000.56');
    expect(
      calculateCommission(1, { type: CommissionType.FixedAmount, fixedAmount: '12.344' })
        .commissionAmount.toFixed(2),
    ).toBe('12.34');
  });

  it('se cobra aunque no haya alquiler cobrado', () => {
    const r = calculateCommission(0, { type: CommissionType.FixedAmount, fixedAmount: 100 });

    expect(fmt(r)).toEqual({ commission: '100.00', adminFee: '0.00', total: '100.00' });
  });
});

describe('commission-engine — mixta', () => {
  it('suma el monto fijo y el porcentaje del alquiler', () => {
    // 1000 + 100000 × 0,025 = 3500
    const r = calculateCommission('100000', {
      type: CommissionType.Mixed,
      fixedAmount: '1000',
      percentage: '2.5',
    });

    expect(r.commissionAmount.toFixed(2)).toBe('3500.00');
  });

  it('redondea una sola vez sobre la suma: 10,00 + 5,005 = 15,01', () => {
    // 100,10 × 0,05 = 5,005 ; 10 + 5,005 = 15,005 -> 15,01
    const r = calculateCommission('100.10', {
      type: CommissionType.Mixed,
      fixedAmount: '10.00',
      percentage: 5,
    });

    expect(r.commissionAmount.toFixed(2)).toBe('15.01');
  });

  it('el redondeo único difiere de redondear cada parte: 0,004 + 0,004 da 0,01', () => {
    // fijo 0,004 + 0,10 × 0,04 = 0,004 -> 0,008 -> 0,01 (por partes serían 0,00 + 0,00)
    const r = calculateCommission('0.10', {
      type: CommissionType.Mixed,
      fixedAmount: '0.004',
      percentage: 4,
    });

    expect(r.commissionAmount.toFixed(2)).toBe('0.01');
  });
});

describe('commission-engine — gastos administrativos y total', () => {
  it('redondea cada componente antes de sumar: 5,005 + 0,005 da 5,01 + 0,01 = 5,02', () => {
    // comisión 100,10 × 5 % = 5,005 -> 5,01 ; gastos 0,005 -> 0,01 ; total 5,02
    // (sumar sin redondear daría 5,010 -> 5,01)
    const r = calculateCommission('100.10', {
      type: CommissionType.FixedPercent,
      percentage: 5,
      adminFee: '0.005',
    });

    expect(fmt(r)).toEqual({ commission: '5.01', adminFee: '0.01', total: '5.02' });
  });

  it('gastos de 0,004 se redondean a 0,00', () => {
    const r = calculateCommission(0, { type: CommissionType.FixedAmount, fixedAmount: 0, adminFee: '0.004' });

    expect(r.adminFeeAmount.toFixed(2)).toBe('0.00');
  });

  it('los gastos se suman también con monto fijo y mixta', () => {
    // fijo 500 + 100 ; mixta 500 + 1000 + 100
    expect(
      calculateCommission('50000', { type: CommissionType.FixedAmount, fixedAmount: 500, adminFee: 100 })
        .totalDeducted.toFixed(2),
    ).toBe('600.00');
    expect(
      calculateCommission('50000', { type: CommissionType.Mixed, fixedAmount: 500, percentage: 2, adminFee: 100 })
        .totalDeducted.toFixed(2),
    ).toBe('1600.00');
  });
});

describe('commission-engine — entradas vacías y tipos', () => {
  it('alquiler cero da todo en 0,00', () => {
    const r = calculateCommission(0, { type: CommissionType.FixedPercent, percentage: 5 });

    expect(fmt(r)).toEqual({ commission: '0.00', adminFee: '0.00', total: '0.00' });
  });

  it.each([undefined, null])('trata %s como cero en porcentaje, monto fijo y gastos', (vacio) => {
    const base = { percentage: vacio, fixedAmount: vacio, adminFee: vacio };
    for (const type of [CommissionType.FixedPercent, CommissionType.FixedAmount, CommissionType.Mixed]) {
      expect(fmt(calculateCommission('1000', { type, ...base }))).toEqual({
        commission: '0.00',
        adminFee: '0.00',
        total: '0.00',
      });
    }
  });

  it('acepta string, number y Decimal con el mismo resultado', () => {
    const config = { type: CommissionType.FixedPercent, percentage: '4' } as const;
    // 2500 × 0,04 = 100
    expect(calculateCommission('2500', config).commissionAmount.toFixed(2)).toBe('100.00');
    expect(calculateCommission(2500, config).commissionAmount.toFixed(2)).toBe('100.00');
    expect(calculateCommission(new Decimal('2500'), config).commissionAmount.toFixed(2)).toBe('100.00');
  });

  it('devuelve instancias de Decimal', () => {
    const r = calculateCommission(1, { type: CommissionType.FixedPercent, percentage: 1 });

    expect(r.commissionAmount).toBeInstanceOf(Decimal);
    expect(r.adminFeeAmount).toBeInstanceOf(Decimal);
    expect(r.totalDeducted).toBeInstanceOf(Decimal);
  });

  it('lanza error con un tipo de comisión desconocido', () => {
    expect(() => calculateCommission(1, { type: 'Otro' as CommissionType })).toThrow(
      'Unknown commission type: Otro',
    );
  });
});
