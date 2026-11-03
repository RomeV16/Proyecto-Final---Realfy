import { normalizeText, parseAmount, parseDate, periodOf, pickDueDates, scoreConfidence, valueAfter } from './text-utils';

describe('text-utils', () => {
  describe('parseAmount', () => {
    it.each([
      ['$ 1.234,56', '1234.56'],
      ['$6.254,00', '6254.00'],
      ['34,499.00', '34499.00'],
      ['$1.273,60.-', '1273.60'],
      ['1710.00', '1710.00'],
      ['$ 490.00', '490.00'],
      ['12.345', '12345.00'],
      ['7', '7.00'],
      ['$-1.563,60', '-1563.60'],
    ])('lee %s como %s', (raw, expected) => {
      expect(parseAmount(raw)).toBe(expected);
    });

    it.each(['', 'abc', '$', '1.2.x'])('rechaza %j', (raw) => {
      expect(parseAmount(raw)).toBeNull();
    });
  });

  describe('parseDate', () => {
    it.each([
      ['14/02/2026', '2026-02-14'],
      ['4/2/2026', '2026-02-04'],
      ['12/11/26', '2026-11-12'],
      ['2026/11/02', '2026-11-02'],
    ])('lee %s como %s', (raw, expected) => {
      expect(parseDate(raw)).toBe(expected);
    });

    it.each(['31/02/2026', '00/01/2026', '12/13/2026', 'hoy', '2026/13/01'])('rechaza %s', (raw) => {
      expect(parseDate(raw)).toBeNull();
    });
  });

  it('periodOf arma el primer día del mes y rechaza meses o años imposibles', () => {
    expect(periodOf(2026, 5)).toBe('2026-05-01');
    expect(periodOf(2026, 13)).toBeNull();
    expect(periodOf(2026, 0)).toBeNull();
    expect(periodOf(1999, 5)).toBeNull();
  });

  it('normalizeText unifica guiones, espacios duros y espacios repetidos sin tocar los saltos de línea', () => {
    expect(normalizeText('FC 0010 − 123   x \n  y')).toBe('FC 0010 - 123 x\ny');
  });

  it('valueAfter toma el valor que sigue a la etiqueta dentro de la ventana y no más lejos', () => {
    const text = 'Total a pagar\n\n$ 99,00 y más abajo Vencimiento 12/11/2026';
    expect(valueAfter(text, /Total a pagar/i, /\$\s*([\d.,]+)/, 20)).toBe('99,00');
    expect(valueAfter(text, /Total a pagar/i, /(12\/11\/2026)/, 20)).toBeNull();
  });

  it('pickDueDates ordena los vencimientos, descarta repetidos y separa el primero del segundo', () => {
    const due = pickDueDates([
      { date: '2026-11-20', amount: '110.00' },
      { date: '2026-11-12', amount: '100.00' },
      { date: '2026-11-12', amount: '100.00' },
    ]);
    expect(due).toEqual({
      dueDate: '2026-11-12',
      firstAmount: '100.00',
      secondDueDate: '2026-11-20',
      secondAmount: '110.00',
    });
    expect(pickDueDates([])).toEqual({ dueDate: null, firstAmount: null, secondDueDate: null, secondAmount: null });
  });

  it('scoreConfidence suma lo encontrado, descuenta cada aviso y respeta el tope', () => {
    const all = { account: true, amount: true, dueDate: true, period: true };
    expect(scoreConfidence(all, 0)).toBe(1);
    expect(scoreConfidence(all, 1)).toBe(0.9);
    expect(scoreConfidence(all, 0, 0.6)).toBe(0.6);
    expect(scoreConfidence({ ...all, dueDate: false }, 0)).toBe(0.75);
    expect(scoreConfidence({ account: false, amount: false, dueDate: false, period: false }, 3)).toBe(0);
  });
});
