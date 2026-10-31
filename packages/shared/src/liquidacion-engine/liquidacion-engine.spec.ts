import Decimal from 'decimal.js';
import { LineItemType } from '../enums';
import {
  calculateLineItemsTotal,
  calculateRemainingBalance,
  isFullyPaid,
} from './index';

/**
 * Valores esperados calculados a mano antes de correr la prueba (ver el
 * cálculo en el comentario de cada caso).
 */
const totals = (items: Parameters<typeof calculateLineItemsTotal>[0]) => {
  const r = calculateLineItemsTotal(items);
  return {
    subtotal: r.subtotal.toFixed(2),
    discounts: r.discounts.toFixed(2),
    total: r.total.toFixed(2),
  };
};

describe('liquidacion-engine — total de ítems', () => {
  it('suma Alquiler, Ajuste, Extra y Multa y resta Descuento', () => {
    // subtotal = 100000 + 5060 + 1500,25 + 300,10 = 106860,35
    // total    = 106860,35 - 2000 = 104860,35
    expect(
      totals([
        { type: LineItemType.Alquiler, amount: '100000.00' },
        { type: LineItemType.Ajuste, amount: '5060.00' },
        { type: LineItemType.Extra, amount: '1500.25' },
        { type: LineItemType.Multa, amount: '300.10' },
        { type: LineItemType.Descuento, amount: '2000.00' },
      ]),
    ).toEqual({ subtotal: '106860.35', discounts: '2000.00', total: '104860.35' });
  });

  it('una lista vacía da todo en 0,00', () => {
    expect(totals([])).toEqual({ subtotal: '0.00', discounts: '0.00', total: '0.00' });
  });

  it('acumula varios descuentos', () => {
    // 1000 - (100 + 50,50) = 849,50
    expect(
      totals([
        { type: LineItemType.Alquiler, amount: 1000 },
        { type: LineItemType.Descuento, amount: '100' },
        { type: LineItemType.Descuento, amount: '50.50' },
      ]),
    ).toEqual({ subtotal: '1000.00', discounts: '150.50', total: '849.50' });
  });

  it('el total no baja de cero cuando los descuentos superan al subtotal', () => {
    // 1000 - 1500 = -500 -> 0
    expect(
      totals([
        { type: LineItemType.Alquiler, amount: 1000 },
        { type: LineItemType.Descuento, amount: 1500 },
      ]),
    ).toEqual({ subtotal: '1000.00', discounts: '1500.00', total: '0.00' });
  });

  it('solo descuentos: subtotal 0 y total 0', () => {
    expect(totals([{ type: LineItemType.Descuento, amount: 10 }])).toEqual({
      subtotal: '0.00',
      discounts: '10.00',
      total: '0.00',
    });
  });

  describe('redondeo (half-up, sobre la suma sin redondear)', () => {
    it('suma 10,005 + 10,004 = 20,009 y redondea a 20,01', () => {
      expect(
        totals([
          { type: LineItemType.Alquiler, amount: '10.005' },
          { type: LineItemType.Extra, amount: '10.004' },
        ]),
      ).toEqual({ subtotal: '20.01', discounts: '0.00', total: '20.01' });
    });

    it('0,005 de subtotal sube a 0,01', () => {
      expect(totals([{ type: LineItemType.Alquiler, amount: '0.005' }]).subtotal).toBe('0.01');
    });

    it('el total es subtotal redondeado menos descuentos redondeados: 0,005 - 0,004 da 0,01 - 0,00 = 0,01 (DEF-13)', () => {
      // subtotal 0,005 -> 0,01 ; descuentos 0,004 -> 0,00 ; total = 0,01 - 0,00 = 0,01
      expect(
        totals([
          { type: LineItemType.Alquiler, amount: '0.005' },
          { type: LineItemType.Descuento, amount: '0.004' },
        ]),
      ).toEqual({ subtotal: '0.01', discounts: '0.00', total: '0.01' });
    });

    it('el total coincide con lo que se muestra: 20,005 - 10,004 muestra 20,01 - 10,00 y da 10,01 (DEF-13)', () => {
      const r = totals([
        { type: LineItemType.Alquiler, amount: '20.005' },
        { type: LineItemType.Descuento, amount: '10.004' },
      ]);
      expect(r).toEqual({ subtotal: '20.01', discounts: '10.00', total: '10.01' });
    });
  });

  describe('montos negativos (DEF-13)', () => {
    const codeOf = (fn: () => unknown): unknown => {
      try {
        fn();
      } catch (e) {
        return (e as { code?: string }).code ?? 'sin código';
      }
      return 'no lanzó';
    };

    it('un Descuento negativo se rechaza con INVALID_LINE_AMOUNT en vez de sumar', () => {
      expect(
        codeOf(() =>
          calculateLineItemsTotal([
            { type: LineItemType.Alquiler, amount: 1000 },
            { type: LineItemType.Descuento, amount: -100 },
          ]),
        ),
      ).toBe('INVALID_LINE_AMOUNT');
    });

    it.each([
      LineItemType.Alquiler,
      LineItemType.Ajuste,
      LineItemType.Extra,
      LineItemType.Multa,
    ])('un %s negativo también se rechaza', (type) => {
      expect(codeOf(() => calculateLineItemsTotal([{ type, amount: '-0.01' }]))).toBe(
        'INVALID_LINE_AMOUNT',
      );
    });

    it('el monto cero es válido', () => {
      expect(
        totals([
          { type: LineItemType.Alquiler, amount: 0 },
          { type: LineItemType.Descuento, amount: 0 },
        ]),
      ).toEqual({ subtotal: '0.00', discounts: '0.00', total: '0.00' });
    });
  });

  it('acepta string, number y Decimal', () => {
    expect(
      totals([
        { type: LineItemType.Alquiler, amount: '1.10' },
        { type: LineItemType.Extra, amount: 2.2 },
        { type: LineItemType.Ajuste, amount: new Decimal('3.30') },
      ]).subtotal,
    ).toBe('6.60');
  });
});

describe('liquidacion-engine — saldo pendiente', () => {
  it('sin pagos el saldo es el total', () => {
    expect(calculateRemainingBalance('1000', []).toFixed(2)).toBe('1000.00');
  });

  it('pago parcial: 1000 - 250,25 = 749,75', () => {
    expect(calculateRemainingBalance(1000, [{ amount: '250.25' }]).toFixed(2)).toBe('749.75');
  });

  it('pagos que suman el total exacto dejan saldo 0,00', () => {
    // 60000,50 + 39999,50 = 100000
    expect(
      calculateRemainingBalance('100000', [{ amount: '60000.50' }, { amount: '39999.50' }]).toFixed(2),
    ).toBe('0.00');
  });

  it('un sobrepago da saldo negativo: 1000 - 1200 = -200', () => {
    expect(calculateRemainingBalance(1000, [{ amount: 1200 }]).toFixed(2)).toBe('-200.00');
  });

  it('redondea el saldo a 2 decimales: 0,005 sube a 0,01 y 0,004 baja a 0,00', () => {
    // 100 - 99,995 = 0,005 ; 100 - 99,996 = 0,004
    expect(calculateRemainingBalance(100, [{ amount: '99.995' }]).toFixed(2)).toBe('0.01');
    expect(calculateRemainingBalance(100, [{ amount: '99.996' }]).toFixed(2)).toBe('0.00');
  });

  it('devuelve un Decimal', () => {
    expect(calculateRemainingBalance(1, [])).toBeInstanceOf(Decimal);
  });
});

describe('liquidacion-engine — pago completo', () => {
  it('está pagada cuando el saldo es exactamente 0', () => {
    expect(isFullyPaid('500', [{ amount: '200' }, { amount: '300' }])).toBe(true);
  });

  it('está pagada con sobrepago', () => {
    expect(isFullyPaid(500, [{ amount: 600 }])).toBe(true);
  });

  it('no está pagada con saldo pendiente', () => {
    expect(isFullyPaid(500, [{ amount: '499.99' }])).toBe(false);
  });

  it('un total 0 sin pagos cuenta como pagado', () => {
    expect(isFullyPaid(0, [])).toBe(true);
  });

  it('un total positivo sin pagos no está pagado', () => {
    expect(isFullyPaid(1, [])).toBe(false);
  });

  it('el saldo redondeado decide: faltante de 0,004 cuenta como pagado y de 0,005 no', () => {
    // 100 - 99,996 = 0,004 -> 0,00 ; 100 - 99,995 = 0,005 -> 0,01
    expect(isFullyPaid(100, [{ amount: '99.996' }])).toBe(true);
    expect(isFullyPaid(100, [{ amount: '99.995' }])).toBe(false);
  });
});
